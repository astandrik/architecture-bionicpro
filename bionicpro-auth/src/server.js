const express = require('express');
const { readConfig } = require('./config');
const {
  clearCookie,
  decodeSigned,
  encodeSigned,
  parseCookies,
  serializeCookie
} = require('./cookies');
const { randomUrlSafe, sha256Base64Url } = require('./crypto-utils');
const { persistYandexProfile, ExternalProfileRepository } = require('./external-profiles');
const { KeycloakClient, userFromTokens } = require('./keycloak-client');
const { SessionStore } = require('./session-store');
const { YandexBroker } = require('./yandex-broker');

function buildCookieOptions(config, maxAgeSeconds) {
  return {
    secure: config.cookieSecure,
    sameSite: 'Lax',
    maxAge: maxAgeSeconds
  };
}

function appendSetCookie(res, value) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', value);
  } else if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, value]);
  } else {
    res.setHeader('Set-Cookie', [current, value]);
  }
}

function sessionCookie(config, sessionId) {
  return serializeCookie(
    config.sessionCookieName,
    encodeSigned(sessionId, config.cookieSecret),
    buildCookieOptions(config, Math.floor(config.sessionTtlMs / 1000))
  );
}

function loginCookie(config, pendingId) {
  return serializeCookie(
    config.loginCookieName,
    encodeSigned(pendingId, config.cookieSecret),
    buildCookieOptions(config, Math.floor(config.pendingAuthTtlMs / 1000))
  );
}

function clearAuthCookies(config, res) {
  appendSetCookie(res, clearCookie(config.sessionCookieName, buildCookieOptions(config, 0)));
  appendSetCookie(res, clearCookie(config.loginCookieName, buildCookieOptions(config, 0)));
}

function readSignedCookie(req, name, config) {
  const cookies = parseCookies(req.headers.cookie);
  return decodeSigned(cookies[name], config.cookieSecret);
}

async function createServer(config = readConfig()) {
  const app = express();
  const keycloakClient = new KeycloakClient({
    ...config.keycloak,
    callbackUrl: config.callbackUrl
  });
  const sessions = new SessionStore(config);
  const profileRepository = new ExternalProfileRepository(config.databaseUrl);
  const yandexBroker = new YandexBroker(config);

  await profileRepository.init();

  app.use(express.json());
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin === config.frontendOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  async function ensureFreshAccessToken(session) {
    if (session.accessTokenExpiresAt - config.refreshSkewMs > Date.now()) {
      return session;
    }

    const refreshToken = sessions.getRefreshToken(session);
    const refreshed = await keycloakClient.refresh(refreshToken);
    return sessions.updateTokens(session.id, {
      accessToken: refreshed.access_token,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      refreshToken: refreshed.refresh_token,
      refreshExpiresAt: refreshed.refreshExpiresAt
    });
  }

  async function requireSession(req, res, next) {
    const sessionId = readSignedCookie(req, config.sessionCookieName, config);
    const session = sessions.getSession(sessionId);
    if (!session) {
      clearAuthCookies(config, res);
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }

    try {
      const fresh = await ensureFreshAccessToken(session);
      const rotated = sessions.rotateSession(fresh.id);
      appendSetCookie(res, sessionCookie(config, rotated.id));
      req.authSession = rotated;
      next();
    } catch (error) {
      sessions.deleteSession(session.id);
      clearAuthCookies(config, res);
      res.status(401).json({ error: 'session_refresh_failed' });
    }
  }

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  yandexBroker.register(app, profileRepository);

  app.get('/auth/login', (req, res) => {
    const state = randomUrlSafe(32);
    const nonce = randomUrlSafe(32);
    const codeVerifier = randomUrlSafe(64);
    const codeChallenge = sha256Base64Url(codeVerifier);
    const pendingId = sessions.createPendingAuth({ state, nonce, codeVerifier });

    const url = new URL(config.keycloak.authUrl);
    url.searchParams.set('client_id', config.keycloak.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('redirect_uri', config.callbackUrl);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    appendSetCookie(res, loginCookie(config, pendingId));
    res.redirect(url.toString());
  });

  app.get('/auth/callback', async (req, res, next) => {
    try {
      const pendingId = readSignedCookie(req, config.loginCookieName, config);
      const pending = sessions.consumePendingAuth(pendingId);
      if (!pending || pending.state !== req.query.state) {
        clearAuthCookies(config, res);
        res.status(400).json({ error: 'invalid_oauth_state' });
        return;
      }

      if (!req.query.code) {
        clearAuthCookies(config, res);
        res.status(400).json({ error: 'missing_authorization_code' });
        return;
      }

      const tokens = await keycloakClient.exchangeCode({
        code: String(req.query.code),
        codeVerifier: pending.codeVerifier
      });
      const user = userFromTokens(tokens);
      const session = sessions.createSession({
        accessToken: tokens.access_token,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshToken: tokens.refresh_token,
        refreshExpiresAt: tokens.refreshExpiresAt,
        user
      });

      const userInfo = await keycloakClient.userInfo(tokens.access_token);
      await persistYandexProfile({
        repository: profileRepository,
        keycloakClient,
        keycloakAccessToken: tokens.access_token,
        keycloakUser: user,
        userInfo,
        yandexInfoUrl: config.yandexInfoUrl
      });

      appendSetCookie(res, clearCookie(config.loginCookieName, buildCookieOptions(config, 0)));
      appendSetCookie(res, sessionCookie(config, session.id));
      res.redirect(config.frontendOrigin);
    } catch (error) {
      next(error);
    }
  });

  app.get('/auth/session', requireSession, (req, res) => {
    res.json({
      authenticated: true,
      user: req.authSession.user,
      sessionExpiresAt: new Date(req.authSession.expiresAt).toISOString(),
      accessTokenExpiresAt: new Date(req.authSession.accessTokenExpiresAt).toISOString()
    });
  });

  app.post('/auth/logout', async (req, res) => {
    const sessionId = readSignedCookie(req, config.sessionCookieName, config);
    const session = sessions.getSession(sessionId);
    if (session) {
      await keycloakClient.logout(sessions.getRefreshToken(session));
      sessions.deleteSession(session.id);
    }

    clearAuthCookies(config, res);
    res.status(204).end();
  });

  app.use('/api', requireSession, async (req, res, next) => {
    if (!config.upstreamApiUrl) {
      res.status(501).json({ error: 'upstream_api_not_configured' });
      return;
    }

    try {
      const upstream = new URL(`${config.upstreamApiUrl}${req.originalUrl.replace(/^\/api/, '')}`);
      const response = await fetch(upstream, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${req.authSession.accessToken}`,
          Accept: req.headers.accept || '*/*',
          'Content-Type': req.headers['content-type'] || 'application/json'
        },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body)
      });

      res.status(response.status);
      response.headers.forEach((value, key) => {
        if (!['set-cookie', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      });
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({ error: 'auth_service_error', message: error.message });
  });

  return { app, profileRepository };
}

if (require.main === module) {
  createServer()
    .then(({ app }) => {
      const config = readConfig();
      app.listen(config.port, () => {
        console.log(`bionicpro-auth listening on ${config.port}`);
      });
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { createServer };
