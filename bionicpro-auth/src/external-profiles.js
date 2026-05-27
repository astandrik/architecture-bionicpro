const { Pool } = require('pg');

class ExternalProfileRepository {
  constructor(databaseUrl) {
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
  }

  async init() {
    if (!this.pool) {
      return;
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS external_profiles (
        provider TEXT NOT NULL,
        provider_subject TEXT NOT NULL,
        keycloak_subject TEXT NOT NULL,
        email TEXT,
        display_name TEXT,
        raw_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (provider, provider_subject)
      )
    `);
  }

  async upsert(profile) {
    if (!this.pool || !profile.providerSubject || !profile.keycloakSubject) {
      return;
    }

    await this.pool.query(
      `
        INSERT INTO external_profiles (
          provider,
          provider_subject,
          keycloak_subject,
          email,
          display_name,
          raw_profile,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (provider, provider_subject)
        DO UPDATE SET
          keycloak_subject = EXCLUDED.keycloak_subject,
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          raw_profile = EXCLUDED.raw_profile,
          updated_at = now()
      `,
      [
        profile.provider,
        profile.providerSubject,
        profile.keycloakSubject,
        profile.email || null,
        profile.displayName || null,
        profile.rawProfile || {}
      ]
    );
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

async function fetchYandexProfile({ keycloakClient, keycloakAccessToken, yandexInfoUrl }) {
  const brokerToken = await keycloakClient.brokerToken(keycloakAccessToken);
  const yandexAccessToken = brokerToken?.access_token || brokerToken?.token;

  if (!yandexAccessToken) {
    return null;
  }

  const response = await fetch(yandexInfoUrl, {
    headers: { Authorization: `OAuth ${yandexAccessToken}` }
  });

  if (!response.ok) {
    return null;
  }

  return response.json().catch(() => null);
}

async function persistYandexProfile({
  repository,
  keycloakClient,
  keycloakAccessToken,
  keycloakUser,
  userInfo,
  yandexInfoUrl
}) {
  const identityProvider = userInfo?.identity_provider || userInfo?.idp || userInfo?.kc_idp_hint;
  if (identityProvider && identityProvider !== 'yandex') {
    return;
  }

  const yandexProfile = await fetchYandexProfile({
    keycloakClient,
    keycloakAccessToken,
    yandexInfoUrl
  });

  if (!yandexProfile && identityProvider !== 'yandex') {
    return;
  }

  const rawProfile = yandexProfile || userInfo || {};
  await repository.upsert({
    provider: 'yandex',
    providerSubject: String(rawProfile.id || rawProfile.sub || keycloakUser.subject),
    keycloakSubject: keycloakUser.subject,
    email: rawProfile.default_email || rawProfile.email || keycloakUser.email,
    displayName: rawProfile.display_name || rawProfile.real_name || rawProfile.name || keycloakUser.name,
    rawProfile
  });
}

module.exports = {
  ExternalProfileRepository,
  persistYandexProfile
};
