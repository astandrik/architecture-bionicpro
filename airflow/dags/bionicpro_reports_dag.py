import json
import os
import re
from datetime import datetime

import boto3
import psycopg2
import psycopg2.extras
import requests
from airflow import DAG
from airflow.operators.python import PythonOperator


PIPELINE_NAME = "bionicpro_reports_daily"


def clickhouse_url():
    return os.environ.get("CLICKHOUSE_URL", "http://clickhouse:8123").rstrip("/")


def clickhouse_database():
    return os.environ.get("CLICKHOUSE_DATABASE", "bionicpro")


def clickhouse_auth_params():
    user = os.environ.get("CLICKHOUSE_USER")
    if not user:
        return {}

    return {
        "user": user,
        "password": os.environ.get("CLICKHOUSE_PASSWORD", ""),
    }


def clickhouse_query(sql, data=None):
    params = {
        "database": clickhouse_database(),
        "query": sql,
    }
    params.update(clickhouse_auth_params())

    response = requests.post(
        clickhouse_url(),
        params=params,
        data=data,
        headers={"Content-Type": "text/plain"},
        timeout=30,
    )
    response.raise_for_status()
    return response.text


def sanitize_key_part(value):
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "unknown")).strip("-")
    return sanitized or "unknown"


def report_data_version(processed_until, processed_at):
    return sanitize_key_part(f"{processed_until}_{processed_at or 'unknown'}")


def report_version_key():
    return f"reports/_versions/{sanitize_key_part(PIPELINE_NAME)}.json"


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"].rstrip("/"),
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("S3_REGION", "us-east-1"),
    )


def write_report_version_marker(processed_until, processed_at):
    marker = {
        "pipeline": PIPELINE_NAME,
        "processedUntil": processed_until,
        "processedAt": processed_at,
        "dataVersion": report_data_version(processed_until, processed_at),
    }
    s3_client().put_object(
        Bucket=os.environ["S3_BUCKET"],
        Key=report_version_key(),
        Body=json.dumps(marker, indent=2).encode("utf-8"),
        ContentType="application/json",
        CacheControl="no-store",
    )
    return marker


def create_schema():
    clickhouse_query("CREATE DATABASE IF NOT EXISTS bionicpro")
    clickhouse_query(
        """
        CREATE TABLE IF NOT EXISTS bionicpro.report_user_daily (
          period_start Date,
          period_end Date,
          username String,
          user_email String,
          customer_name String,
          prosthesis_id String,
          prosthesis_model String,
          samples_count UInt64,
          movements_count UInt64,
          avg_signal_strength Float64,
          max_temperature Float64,
          low_battery_events UInt64,
          error_events UInt64,
          active_minutes UInt64,
          processed_at DateTime
        ) ENGINE = MergeTree
        PARTITION BY toYYYYMM(period_start)
        ORDER BY (username, prosthesis_id, period_start)
        """
    )
    clickhouse_query(
        """
        CREATE TABLE IF NOT EXISTS bionicpro.etl_watermarks (
          pipeline String,
          processed_until Date,
          processed_at DateTime
        ) ENGINE = ReplacingMergeTree(processed_at)
        ORDER BY pipeline
        """
    )


def pg_rows(dsn, sql):
    with psycopg2.connect(dsn) as connection:
        with connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
            cursor.execute(sql)
            return [dict(row) for row in cursor.fetchall()]


def extract_crm_telemetry():
    crm_records = pg_rows(
        os.environ["CRM_DSN"],
        """
        SELECT
          c.username,
          c.email AS user_email,
          c.full_name AS customer_name,
          p.prosthesis_id,
          p.model AS prosthesis_model
        FROM customers c
        JOIN prostheses p ON p.username = c.username
        ORDER BY c.username, p.prosthesis_id
        """,
    )
    telemetry_records = pg_rows(
        os.environ["TELEMETRY_DSN"],
        """
        SELECT
          date_trunc('day', event_time)::date AS period_start,
          prosthesis_id,
          count(*)::bigint AS samples_count,
          sum(CASE WHEN movement_detected THEN 1 ELSE 0 END)::bigint AS movements_count,
          avg(signal_strength)::float AS avg_signal_strength,
          max(temperature)::float AS max_temperature,
          sum(CASE WHEN battery_level < 20 THEN 1 ELSE 0 END)::bigint AS low_battery_events,
          sum(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END)::bigint AS error_events,
          ceil(sum(active_seconds)::numeric / 60)::bigint AS active_minutes
        FROM prosthesis_telemetry
        GROUP BY date_trunc('day', event_time)::date, prosthesis_id
        ORDER BY period_start, prosthesis_id
        """,
    )

    for record in telemetry_records:
        record["period_start"] = record["period_start"].isoformat()
        for key in (
            "samples_count",
            "movements_count",
            "low_battery_events",
            "error_events",
            "active_minutes",
        ):
            record[key] = int(record[key])
        record["avg_signal_strength"] = float(record["avg_signal_strength"])
        record["max_temperature"] = float(record["max_temperature"])

    return {
        "crm": crm_records,
        "telemetry": telemetry_records,
    }


def transform_daily_aggregates(ti):
    source = ti.xcom_pull(task_ids="extract_crm_telemetry")
    prostheses = {
        row["prosthesis_id"]: row
        for row in source["crm"]
    }
    processed_at = datetime.utcnow().replace(microsecond=0).isoformat(sep=" ")
    rows = []

    for telemetry in source["telemetry"]:
        prosthesis = prostheses.get(telemetry["prosthesis_id"])
        if not prosthesis:
            continue

        period_start = telemetry["period_start"]
        rows.append({
            "period_start": period_start,
            "period_end": period_start,
            "username": prosthesis["username"],
            "user_email": prosthesis["user_email"],
            "customer_name": prosthesis["customer_name"],
            "prosthesis_id": prosthesis["prosthesis_id"],
            "prosthesis_model": prosthesis["prosthesis_model"],
            "samples_count": telemetry["samples_count"],
            "movements_count": telemetry["movements_count"],
            "avg_signal_strength": round(telemetry["avg_signal_strength"], 2),
            "max_temperature": telemetry["max_temperature"],
            "low_battery_events": telemetry["low_battery_events"],
            "error_events": telemetry["error_events"],
            "active_minutes": telemetry["active_minutes"],
            "processed_at": processed_at,
        })

    return rows


def load_clickhouse(ti):
    rows = ti.xcom_pull(task_ids="transform_daily_aggregates")
    clickhouse_query("TRUNCATE TABLE IF EXISTS bionicpro.report_user_daily")

    if not rows:
        return {"loaded_rows": 0, "processed_until": None}

    payload = "\n".join(json.dumps(row) for row in rows)
    clickhouse_query(
        "INSERT INTO bionicpro.report_user_daily FORMAT JSONEachRow",
        data=payload,
    )

    return {
        "loaded_rows": len(rows),
        "processed_until": max(row["period_end"] for row in rows),
    }


def update_watermark(ti):
    load_result = ti.xcom_pull(task_ids="load_clickhouse")
    processed_until = load_result.get("processed_until")
    if not processed_until:
        return

    processed_at = datetime.utcnow().replace(microsecond=0).isoformat(sep=" ")
    payload = json.dumps({
        "pipeline": PIPELINE_NAME,
        "processed_until": processed_until,
        "processed_at": processed_at,
    })
    clickhouse_query(
        "INSERT INTO bionicpro.etl_watermarks FORMAT JSONEachRow",
        data=payload,
    )
    return write_report_version_marker(processed_until, processed_at)


with DAG(
    dag_id=PIPELINE_NAME,
    description="Builds BionicPRO per-user daily report datamart in ClickHouse",
    start_date=datetime(2026, 1, 1),
    schedule="@daily",
    catchup=False,
    tags=["bionicpro", "reports"],
) as dag:
    create_schema_task = PythonOperator(
        task_id="create_schema",
        python_callable=create_schema,
    )
    extract_task = PythonOperator(
        task_id="extract_crm_telemetry",
        python_callable=extract_crm_telemetry,
        show_return_value_in_logs=False,
    )
    transform_task = PythonOperator(
        task_id="transform_daily_aggregates",
        python_callable=transform_daily_aggregates,
        show_return_value_in_logs=False,
    )
    load_task = PythonOperator(
        task_id="load_clickhouse",
        python_callable=load_clickhouse,
        show_return_value_in_logs=False,
    )
    watermark_task = PythonOperator(
        task_id="update_watermark",
        python_callable=update_watermark,
    )

    create_schema_task >> extract_task >> transform_task >> load_task >> watermark_task
