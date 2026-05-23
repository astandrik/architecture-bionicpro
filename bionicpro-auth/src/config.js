const required = [
  'KEYCLOAK_URL',
  'KEYCLOAK_REALM',
  'KEYCLOAK_CLIENT_ID',
  'KEYCLOAK_CLIENT_SECRET',
  'AUTH_COOKIE_SECRET',
  'AUTH_TOKEN_ENCRYPTION_KEY',
  'FRONTEND_ORIGIN'
];

function durationMs(env, name, fallbackSeconds, { allowZero = false } = {}) {
  const raw = env[name];
  const seconds = raw === undefined || raw === '' ? fallbackSeconds : Number(raw);
  const min = allowZero ? 0 : Number.EPSILON;

  if (!Number.isFinite(seconds) || seconds < min) {
    return fallbackSeconds * 1000;
  }

  return Math.floor(seconds * 1000);
}

function readConfig(env = process.env) {
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const keycloakPublicUrl = (env.KEYCLOAK_PUBLIC_URL || env.KEYCLOAK_URL).replace(/\/+$/, '');
  const keycloakInternalUrl = (env.KEYCLOAK_INTERNAL_URL || env.KEYCLOAK_URL).replace(/\/+$/, '');
  const realm = env.KEYCLOAK_REALM;
  const authBaseUrl = (env.AUTH_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
  const yandexBrokerIssuer = (env.YANDEX_BROKER_ISSUER || `${authBaseUrl}/yandex`).replace(/\/+$/, '');

  return {
    port: Number(env.PORT || 8000),
    frontendOrigin: env.FRONTEND_ORIGIN.replace(/\/+$/, ''),
    authBaseUrl,
    callbackUrl: env.KEYCLOAK_CALLBACK_URL || `${authBaseUrl}/auth/callback`,
    upstreamApiUrl: env.UPSTREAM_API_URL ? env.UPSTREAM_API_URL.replace(/\/+$/, '') : '',
    sessionCookieName: env.AUTH_SESSION_COOKIE_NAME || 'bionicpro_sid',
    loginCookieName: env.AUTH_LOGIN_COOKIE_NAME || 'bionicpro_login',
    cookieSecure: env.AUTH_COOKIE_SECURE !== 'false',
    cookieSecret: env.AUTH_COOKIE_SECRET,
    tokenEncryptionKey: env.AUTH_TOKEN_ENCRYPTION_KEY,
    sessionTtlMs: durationMs(env, 'AUTH_SESSION_TTL_SECONDS', 1800),
    pendingAuthTtlMs: durationMs(env, 'AUTH_PENDING_TTL_SECONDS', 300),
    refreshSkewMs: durationMs(env, 'AUTH_REFRESH_SKEW_SECONDS', 15, { allowZero: true }),
    sessionRotationGraceMs: durationMs(env, 'AUTH_SESSION_ROTATION_GRACE_SECONDS', 5, { allowZero: true }),
    keycloak: {
      publicUrl: keycloakPublicUrl,
      internalUrl: keycloakInternalUrl,
      realm,
      clientId: env.KEYCLOAK_CLIENT_ID,
      clientSecret: env.KEYCLOAK_CLIENT_SECRET,
      issuer: `${keycloakPublicUrl}/realms/${realm}`,
      authUrl: `${keycloakPublicUrl}/realms/${realm}/protocol/openid-connect/auth`,
      tokenUrl: `${keycloakInternalUrl}/realms/${realm}/protocol/openid-connect/token`,
      logoutUrl: `${keycloakInternalUrl}/realms/${realm}/protocol/openid-connect/logout`,
      userInfoUrl: `${keycloakInternalUrl}/realms/${realm}/protocol/openid-connect/userinfo`,
      brokerTokenUrl: `${keycloakInternalUrl}/realms/${realm}/broker/yandex/token`
    },
    databaseUrl: env.DATABASE_URL || '',
    yandexInfoUrl: env.YANDEX_USERINFO_URL || 'https://login.yandex.ru/info',
    yandex: {
      clientId: env.YANDEX_CLIENT_ID || '',
      clientSecret: env.YANDEX_CLIENT_SECRET || '',
      authorizationUrl: env.YANDEX_AUTHORIZATION_URL || 'https://oauth.yandex.ru/authorize',
      tokenUrl: env.YANDEX_TOKEN_URL || 'https://oauth.yandex.ru/token',
      infoUrl: env.YANDEX_USERINFO_URL || 'https://login.yandex.ru/info',
      redirectUrl: env.YANDEX_REDIRECT_URL || `${authBaseUrl}/yandex/callback`,
      scope: env.YANDEX_SCOPE || 'login:info login:email'
    },
    yandexBroker: {
      issuer: yandexBrokerIssuer,
      clientId: env.YANDEX_BROKER_CLIENT_ID || 'bionicpro-yandex-broker',
      clientSecret: env.YANDEX_BROKER_CLIENT_SECRET || 'change-me-yandex-oidc-client-secret',
      privateKeyPem: env.YANDEX_BROKER_PRIVATE_KEY_PEM || '',
      privateKeyFile: env.YANDEX_BROKER_PRIVATE_KEY_FILE || ''
    }
  };
}

module.exports = { readConfig };
