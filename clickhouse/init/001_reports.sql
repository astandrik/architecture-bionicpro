CREATE DATABASE IF NOT EXISTS bionicpro;

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
ORDER BY (username, prosthesis_id, period_start);

CREATE TABLE IF NOT EXISTS bionicpro.report_telemetry_daily (
  period_start Date,
  period_end Date,
  prosthesis_id String,
  samples_count UInt64,
  movements_count UInt64,
  avg_signal_strength Float64,
  max_temperature Float64,
  low_battery_events UInt64,
  error_events UInt64,
  active_minutes UInt64,
  processed_at DateTime,
  record_version DateTime64(3)
) ENGINE = ReplacingMergeTree(record_version)
PARTITION BY toYYYYMM(period_start)
ORDER BY (prosthesis_id, period_start);

CREATE TABLE IF NOT EXISTS bionicpro.crm_customers_kafka (
  username String,
  email String,
  full_name String,
  `__deleted` Nullable(Bool),
  `__op` Nullable(String),
  `__source_ts_ms` Nullable(Int64)
) ENGINE = Kafka
SETTINGS
  kafka_broker_list = 'kafka:9092',
  kafka_topic_list = 'bionicpro_crm.public.customers',
  kafka_group_name = 'bionicpro-clickhouse-customers',
  kafka_format = 'JSONEachRow',
  kafka_num_consumers = 1,
  input_format_skip_unknown_fields = 1,
  input_format_null_as_default = 1;

CREATE TABLE IF NOT EXISTS bionicpro.crm_prostheses_kafka (
  prosthesis_id String,
  username String,
  model String,
  `__deleted` Nullable(Bool),
  `__op` Nullable(String),
  `__source_ts_ms` Nullable(Int64)
) ENGINE = Kafka
SETTINGS
  kafka_broker_list = 'kafka:9092',
  kafka_topic_list = 'bionicpro_crm.public.prostheses',
  kafka_group_name = 'bionicpro-clickhouse-prostheses',
  kafka_format = 'JSONEachRow',
  kafka_num_consumers = 1,
  input_format_skip_unknown_fields = 1,
  input_format_null_as_default = 1;

CREATE TABLE IF NOT EXISTS bionicpro.crm_customers_cdc_events (
  username String,
  user_email String,
  customer_name String,
  is_deleted UInt8,
  operation String,
  record_version DateTime64(3),
  ingested_at DateTime64(3)
) ENGINE = ReplacingMergeTree(record_version)
ORDER BY username;

CREATE TABLE IF NOT EXISTS bionicpro.crm_prostheses_cdc_events (
  prosthesis_id String,
  username String,
  prosthesis_model String,
  is_deleted UInt8,
  operation String,
  record_version DateTime64(3),
  ingested_at DateTime64(3)
) ENGINE = ReplacingMergeTree(record_version)
ORDER BY prosthesis_id;

DROP VIEW IF EXISTS bionicpro.report_user_daily_current;
DROP VIEW IF EXISTS bionicpro.report_user_daily_from_customers_mv;
DROP VIEW IF EXISTS bionicpro.report_user_daily_from_prostheses_mv;
DROP VIEW IF EXISTS bionicpro.report_user_daily_from_telemetry_mv;
DROP VIEW IF EXISTS bionicpro.crm_prostheses_current;
DROP VIEW IF EXISTS bionicpro.crm_customers_current;
DROP VIEW IF EXISTS bionicpro.crm_prostheses_cdc_events_mv;
DROP VIEW IF EXISTS bionicpro.crm_customers_cdc_events_mv;

CREATE MATERIALIZED VIEW IF NOT EXISTS bionicpro.crm_customers_cdc_events_mv
TO bionicpro.crm_customers_cdc_events AS
SELECT
  username,
  email AS user_email,
  full_name AS customer_name,
  toUInt8(ifNull(`__deleted`, 0)) AS is_deleted,
  ifNull(`__op`, '') AS operation,
  if(
    isNull(`__source_ts_ms`),
    now64(3),
    fromUnixTimestamp64Milli(assumeNotNull(`__source_ts_ms`))
  ) AS record_version,
  now64(3) AS ingested_at
FROM bionicpro.crm_customers_kafka;

CREATE MATERIALIZED VIEW IF NOT EXISTS bionicpro.crm_prostheses_cdc_events_mv
TO bionicpro.crm_prostheses_cdc_events AS
SELECT
  prosthesis_id,
  username,
  model AS prosthesis_model,
  toUInt8(ifNull(`__deleted`, 0)) AS is_deleted,
  ifNull(`__op`, '') AS operation,
  if(
    isNull(`__source_ts_ms`),
    now64(3),
    fromUnixTimestamp64Milli(assumeNotNull(`__source_ts_ms`))
  ) AS record_version,
  now64(3) AS ingested_at
FROM bionicpro.crm_prostheses_kafka;

CREATE VIEW IF NOT EXISTS bionicpro.crm_customers_current AS
SELECT
  username,
  user_email,
  customer_name,
  current_record_version AS record_version
FROM (
  SELECT
    username,
    argMax(user_email, (record_version, ingested_at)) AS user_email,
    argMax(customer_name, (record_version, ingested_at)) AS customer_name,
    max(record_version) AS current_record_version,
    argMax(is_deleted, (record_version, ingested_at)) AS is_deleted
  FROM bionicpro.crm_customers_cdc_events
  GROUP BY username
)
WHERE is_deleted = 0;

CREATE VIEW IF NOT EXISTS bionicpro.crm_prostheses_current AS
SELECT
  prosthesis_id,
  username,
  prosthesis_model,
  current_record_version AS record_version
FROM (
  SELECT
    prosthesis_id,
    argMax(username, (record_version, ingested_at)) AS username,
    argMax(prosthesis_model, (record_version, ingested_at)) AS prosthesis_model,
    max(record_version) AS current_record_version,
    argMax(is_deleted, (record_version, ingested_at)) AS is_deleted
  FROM bionicpro.crm_prostheses_cdc_events
  GROUP BY prosthesis_id
)
WHERE is_deleted = 0;

CREATE TABLE IF NOT EXISTS bionicpro.report_user_daily_cdc (
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
  is_deleted UInt8,
  record_version DateTime64(3),
  processed_at DateTime
) ENGINE = ReplacingMergeTree(record_version)
PARTITION BY toYYYYMM(period_start)
ORDER BY (prosthesis_id, period_start, period_end);

CREATE MATERIALIZED VIEW IF NOT EXISTS bionicpro.report_user_daily_from_telemetry_mv
TO bionicpro.report_user_daily_cdc AS
SELECT
  t.period_start AS period_start,
  t.period_end AS period_end,
  p.username AS username,
  c.user_email AS user_email,
  c.customer_name AS customer_name,
  t.prosthesis_id AS prosthesis_id,
  p.prosthesis_model AS prosthesis_model,
  t.samples_count AS samples_count,
  t.movements_count AS movements_count,
  t.avg_signal_strength AS avg_signal_strength,
  t.max_temperature AS max_temperature,
  t.low_battery_events AS low_battery_events,
  t.error_events AS error_events,
  t.active_minutes AS active_minutes,
  0 AS is_deleted,
  greatest(t.record_version, p.record_version, c.record_version) AS record_version,
  t.processed_at
FROM bionicpro.report_telemetry_daily AS t
INNER JOIN bionicpro.crm_prostheses_current AS p ON p.prosthesis_id = t.prosthesis_id
INNER JOIN bionicpro.crm_customers_current AS c ON c.username = p.username;

CREATE MATERIALIZED VIEW IF NOT EXISTS bionicpro.report_user_daily_from_prostheses_mv
TO bionicpro.report_user_daily_cdc AS
SELECT
  t.period_start AS period_start,
  t.period_end AS period_end,
  p.username AS username,
  ifNull(c.user_email, '') AS user_email,
  ifNull(c.customer_name, '') AS customer_name,
  t.prosthesis_id AS prosthesis_id,
  p.prosthesis_model AS prosthesis_model,
  t.samples_count AS samples_count,
  t.movements_count AS movements_count,
  t.avg_signal_strength AS avg_signal_strength,
  t.max_temperature AS max_temperature,
  t.low_battery_events AS low_battery_events,
  t.error_events AS error_events,
  t.active_minutes AS active_minutes,
  p.is_deleted AS is_deleted,
  greatest(t.record_version, p.record_version, ifNull(c.record_version, p.record_version)) AS record_version,
  t.processed_at
FROM bionicpro.crm_prostheses_cdc_events AS p
INNER JOIN bionicpro.report_telemetry_daily AS t ON t.prosthesis_id = p.prosthesis_id
LEFT JOIN bionicpro.crm_customers_current AS c ON c.username = p.username;

CREATE MATERIALIZED VIEW IF NOT EXISTS bionicpro.report_user_daily_from_customers_mv
TO bionicpro.report_user_daily_cdc AS
SELECT
  t.period_start AS period_start,
  t.period_end AS period_end,
  c.username AS username,
  c.user_email AS user_email,
  c.customer_name AS customer_name,
  t.prosthesis_id AS prosthesis_id,
  p.prosthesis_model AS prosthesis_model,
  t.samples_count AS samples_count,
  t.movements_count AS movements_count,
  t.avg_signal_strength AS avg_signal_strength,
  t.max_temperature AS max_temperature,
  t.low_battery_events AS low_battery_events,
  t.error_events AS error_events,
  t.active_minutes AS active_minutes,
  c.is_deleted AS is_deleted,
  greatest(t.record_version, p.record_version, c.record_version) AS record_version,
  t.processed_at
FROM bionicpro.crm_customers_cdc_events AS c
INNER JOIN bionicpro.crm_prostheses_current AS p ON p.username = c.username
INNER JOIN bionicpro.report_telemetry_daily AS t ON t.prosthesis_id = p.prosthesis_id;

CREATE VIEW IF NOT EXISTS bionicpro.report_user_daily_current AS
SELECT
  period_start,
  period_end,
  prosthesis_id,
  username,
  user_email,
  customer_name,
  prosthesis_model,
  samples_count,
  movements_count,
  avg_signal_strength,
  max_temperature,
  low_battery_events,
  error_events,
  active_minutes,
  current_record_version AS record_version,
  current_processed_at AS processed_at
FROM (
  SELECT
    period_start,
    period_end,
    prosthesis_id,
    argMax(username, (record_version, processed_at)) AS username,
    argMax(user_email, (record_version, processed_at)) AS user_email,
    argMax(customer_name, (record_version, processed_at)) AS customer_name,
    argMax(prosthesis_model, (record_version, processed_at)) AS prosthesis_model,
    argMax(samples_count, (record_version, processed_at)) AS samples_count,
    argMax(movements_count, (record_version, processed_at)) AS movements_count,
    argMax(avg_signal_strength, (record_version, processed_at)) AS avg_signal_strength,
    argMax(max_temperature, (record_version, processed_at)) AS max_temperature,
    argMax(low_battery_events, (record_version, processed_at)) AS low_battery_events,
    argMax(error_events, (record_version, processed_at)) AS error_events,
    argMax(active_minutes, (record_version, processed_at)) AS active_minutes,
    max(record_version) AS current_record_version,
    argMax(processed_at, (record_version, processed_at)) AS current_processed_at,
    argMax(is_deleted, (record_version, processed_at)) AS is_deleted
  FROM bionicpro.report_user_daily_cdc
  GROUP BY prosthesis_id, period_start, period_end
)
WHERE is_deleted = 0;

CREATE TABLE IF NOT EXISTS bionicpro.etl_watermarks (
  pipeline String,
  processed_until Date,
  processed_at DateTime
) ENGINE = ReplacingMergeTree(processed_at)
ORDER BY pipeline;
