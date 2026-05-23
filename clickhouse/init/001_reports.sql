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

CREATE TABLE IF NOT EXISTS bionicpro.etl_watermarks (
  pipeline String,
  processed_until Date,
  processed_at DateTime
) ENGINE = ReplacingMergeTree(processed_at)
ORDER BY pipeline;
