CREATE TABLE IF NOT EXISTS external_profiles (
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  keycloak_subject TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  raw_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_subject)
);
