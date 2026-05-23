const sharedRequired = [
  'CLICKHOUSE_URL',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'REPORTS_CDN_BASE_URL',
  'REPORTS_OBJECT_KEY_SECRET',
  'REPORTS_CDN_SIGNING_SECRET'
];

const apiRequired = [
  ...sharedRequired,
  'KEYCLOAK_JWKS_URL'
];

function assertRequired(env, required) {
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function readSharedConfig(env) {
  return {
    port: Number(env.PORT || 8001),
    clickHouse: {
      url: env.CLICKHOUSE_URL.replace(/\/+$/, ''),
      database: env.CLICKHOUSE_DATABASE || 'bionicpro',
      user: env.CLICKHOUSE_USER || '',
      password: env.CLICKHOUSE_PASSWORD || ''
    },
    s3: {
      endpoint: env.S3_ENDPOINT.replace(/\/+$/, ''),
      region: env.S3_REGION || 'us-east-1',
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
      cdnBaseUrl: env.REPORTS_CDN_BASE_URL.replace(/\/+$/, ''),
      objectKeySecret: env.REPORTS_OBJECT_KEY_SECRET,
      cdnSigningSecret: env.REPORTS_CDN_SIGNING_SECRET,
      cdnUrlTtlSeconds: Number(env.REPORTS_CDN_URL_TTL_SECONDS || 900)
    },
    pipelineName: env.REPORTS_PIPELINE_NAME || 'bionicpro_reports_daily'
  };
}

function readConfig(env = process.env) {
  assertRequired(env, apiRequired);

  return {
    ...readSharedConfig(env),
    jwt: {
      jwksUrl: env.KEYCLOAK_JWKS_URL,
      issuer: env.KEYCLOAK_EXPECTED_ISSUER || '',
      audience: env.KEYCLOAK_EXPECTED_AUDIENCE || ''
    }
  };
}

function readVersionerConfig(env = process.env) {
  assertRequired(env, sharedRequired);
  return readSharedConfig(env);
}

module.exports = { readConfig, readVersionerConfig };
