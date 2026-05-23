const required = [
  'CLICKHOUSE_URL',
  'KEYCLOAK_JWKS_URL'
];

function readConfig(env = process.env) {
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    port: Number(env.PORT || 8001),
    jwt: {
      jwksUrl: env.KEYCLOAK_JWKS_URL,
      issuer: env.KEYCLOAK_EXPECTED_ISSUER || '',
      audience: env.KEYCLOAK_EXPECTED_AUDIENCE || ''
    },
    clickHouse: {
      url: env.CLICKHOUSE_URL.replace(/\/+$/, ''),
      database: env.CLICKHOUSE_DATABASE || 'bionicpro',
      user: env.CLICKHOUSE_USER || '',
      password: env.CLICKHOUSE_PASSWORD || ''
    },
    pipelineName: env.REPORTS_PIPELINE_NAME || 'bionicpro_reports_daily'
  };
}

module.exports = { readConfig };
