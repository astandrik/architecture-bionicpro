CREATE TABLE prosthesis_telemetry (
  event_id BIGSERIAL PRIMARY KEY,
  prosthesis_id TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  signal_strength NUMERIC(5, 2) NOT NULL,
  battery_level INTEGER NOT NULL,
  temperature NUMERIC(5, 2) NOT NULL,
  movement_detected BOOLEAN NOT NULL,
  error_code TEXT,
  active_seconds INTEGER NOT NULL
);

CREATE INDEX prosthesis_telemetry_device_time_idx
  ON prosthesis_telemetry (prosthesis_id, event_time);

INSERT INTO prosthesis_telemetry (
  prosthesis_id,
  event_time,
  signal_strength,
  battery_level,
  temperature,
  movement_detected,
  error_code,
  active_seconds
) VALUES
  ('BP-1001', (CURRENT_DATE - INTERVAL '6 days') + TIME '08:10:00', 91.4, 78, 32.1, true, NULL, 640),
  ('BP-1001', (CURRENT_DATE - INTERVAL '6 days') + TIME '12:35:00', 89.8, 64, 33.0, true, NULL, 820),
  ('BP-1001', (CURRENT_DATE - INTERVAL '5 days') + TIME '09:05:00', 87.2, 58, 33.2, false, NULL, 300),
  ('BP-1001', (CURRENT_DATE - INTERVAL '5 days') + TIME '16:45:00', 92.0, 43, 34.1, true, NULL, 910),
  ('BP-1001', (CURRENT_DATE - INTERVAL '4 days') + TIME '10:00:00', 83.1, 18, 35.0, true, 'LOW_BATTERY_RECOVERY', 760),
  ('BP-1001', (CURRENT_DATE - INTERVAL '3 days') + TIME '11:20:00', 88.6, 36, 34.7, true, NULL, 1140),
  ('BP-1001', (CURRENT_DATE - INTERVAL '2 days') + TIME '15:50:00', 85.4, 27, 36.2, true, 'SENSOR_SPIKE', 980),
  ('BP-1001', (CURRENT_DATE - INTERVAL '1 day') + TIME '08:20:00', 94.5, 71, 32.9, true, NULL, 700),
  ('BP-1001', CURRENT_DATE + TIME '13:10:00', 90.2, 62, 33.7, false, NULL, 520),

  ('BP-1002', (CURRENT_DATE - INTERVAL '6 days') + TIME '09:20:00', 81.2, 82, 31.9, true, NULL, 540),
  ('BP-1002', (CURRENT_DATE - INTERVAL '5 days') + TIME '14:10:00', 79.7, 73, 32.4, true, NULL, 620),
  ('BP-1002', (CURRENT_DATE - INTERVAL '4 days') + TIME '17:20:00', 76.5, 61, 33.6, false, NULL, 240),
  ('BP-1002', (CURRENT_DATE - INTERVAL '2 days') + TIME '10:30:00', 78.8, 19, 34.5, true, 'LOW_BATTERY', 690),
  ('BP-1002', CURRENT_DATE + TIME '18:00:00', 84.1, 48, 32.8, true, NULL, 830),

  ('BP-2001', (CURRENT_DATE - INTERVAL '6 days') + TIME '07:45:00', 88.0, 90, 31.2, true, NULL, 900),
  ('BP-2001', (CURRENT_DATE - INTERVAL '5 days') + TIME '18:25:00', 86.9, 85, 32.8, true, NULL, 760),
  ('BP-2001', (CURRENT_DATE - INTERVAL '3 days') + TIME '12:10:00', 80.0, 22, 35.4, false, NULL, 410),
  ('BP-2001', (CURRENT_DATE - INTERVAL '1 day') + TIME '20:15:00', 77.6, 16, 36.0, true, 'LOW_BATTERY', 620),
  ('BP-2001', CURRENT_DATE + TIME '09:40:00', 82.7, 54, 33.3, true, NULL, 870),

  ('BP-3001', (CURRENT_DATE - INTERVAL '6 days') + TIME '08:00:00', 93.3, 88, 31.8, true, NULL, 650),
  ('BP-3001', (CURRENT_DATE - INTERVAL '4 days') + TIME '13:15:00', 91.0, 75, 32.7, false, NULL, 390),
  ('BP-3001', (CURRENT_DATE - INTERVAL '2 days') + TIME '16:45:00', 89.5, 67, 33.1, true, NULL, 720),
  ('BP-3001', CURRENT_DATE + TIME '11:00:00', 92.4, 59, 32.6, true, NULL, 840);
