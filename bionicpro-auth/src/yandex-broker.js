const crypto = require('crypto');
const express = require('express');
const { randomUrlSafe, sha256Base64Url } = require('./crypto-utils');

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createSigningKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = crypto
    .createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64url')
    .slice(0, 16);

  return {
    privateKey,
    publicJwk: {
      ...publicKey.export({ format: 'jwk' }),
      alg: 'RS256',
      kid,
      use: 'sig'
    }
  };
}

function signJwt(payload, signingKey) {
  const header = { alg: 'RS256', typ: 'JWT', kid: signingKey.publicJwk.kid };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    signingKey.privateKey
  ).toString('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function normalizeYandexProfile(rawProfile) {
  return {
    subject: String(rawProfile.id || rawProfile.login),
    username: rawProfile.login,
    email: rawProfile.default_email || rawProfile.email,
    name: rawProfile.display_name || rawProfile.real_name || rawProfile.name,
    rawProfile
  };
}

function buildIdToken(profile, config, nonce, signingKey) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: config.yandexBroker.issuer,
      aud: config.yandexBroker.clientId,
      sub: profile.subject,
      preferred_username: profile.username,
      email: profile.email,
      email_verified: Boolean(profile.email),
      name: profile.name,
      nonce,
      iat: now,
      exp: now + 120
    },
    signingKey
  );
}

function readBasicClientCredentials(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.toLowerCase().startsWith('basic ')) {
    return null;
  }

  const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  const index = decoded.indexOf(':');
  if (index === -1) {
    return null;
  }

  return {
    clientId: decoded.slice(0, index),
    clientSecret: decoded.slice(index + 1)
  };
}

function clientCredentialsFromRequest(req) {
  return readBasicClientCredentials(req) || {
    clientId: req.body.client_id,
    clientSecret: req.body.client_secret
  };
}

function assertBrokerClient(req, config) {
  const credentials = clientCredentialsFromRequest(req);
  if (
    !credentials ||
    credentials.clientId !== config.yandexBroker.clientId ||
    credentials.clientSecret !== config.yandexBroker.clientSecret
  ) {
    return false;
  }

  return true;
}

function isAllowedBrokerRedirect(redirectUri, config) {
  const expected = `${config.keycloak.publicUrl}/realms/${config.keycloak.realm}/broker/yandex/endpoint`;
  return redirectUri === expected;
}

function sweepExpired(map, now) {
  for (const [key, entry] of map.entries()) {
    if (!entry?.expiresAt || entry.expiresAt <= now) {
      map.delete(key);
    }
  }
}

async function fetchYandexTokens({ code, config }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.yandex.clientId,
    client_secret: config.yandex.clientSecret,
    redirect_uri: config.yandex.redirectUrl
  });

  const response = await fetch(config.yandex.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(`Yandex token request failed: ${response.status} ${JSON.stringify(json)}`);
  }

  return json;
}

async function fetchYandexProfile({ accessToken, config }) {
  const response = await fetch(config.yandex.infoUrl, {
    headers: { Authorization: `OAuth ${accessToken}` }
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || (!json.id && !json.login)) {
    throw new Error(`Yandex profile request failed: ${response.status} ${JSON.stringify(json)}`);
  }

  return normalizeYandexProfile(json);
}

class YandexBroker {
  constructor(config) {
    this.config = config;
    this.pending = new Map();
    this.codes = new Map();
    this.tokens = new Map();
    this.signingKey = createSigningKey();
  }

  sweepExpired(now = Date.now()) {
    sweepExpired(this.pending, now);
    sweepExpired(this.codes, now);
    sweepExpired(this.tokens, now);
  }

  register(app, repository) {
    app.get('/yandex/jwks', (req, res) => {
      res.json({ keys: [this.signingKey.publicJwk] });
    });

    app.get('/yandex/authorize', (req, res) => {
      this.sweepExpired();

      if (!this.config.yandex.clientId || !this.config.yandex.clientSecret) {
        res.status(500).json({ error: 'yandex_credentials_not_configured' });
        return;
      }

      const redirectUri = String(req.query.redirect_uri || '');
      if (
        req.query.client_id !== this.config.yandexBroker.clientId ||
        req.query.response_type !== 'code' ||
        !req.query.state ||
        !isAllowedBrokerRedirect(redirectUri, this.config)
      ) {
        res.status(400).json({ error: 'invalid_broker_authorization_request' });
        return;
      }

      const state = randomUrlSafe(32);
      this.pending.set(state, {
        keycloakState: String(req.query.state),
        keycloakRedirectUri: redirectUri,
        nonce: req.query.nonce ? String(req.query.nonce) : undefined,
        codeChallenge: req.query.code_challenge ? String(req.query.code_challenge) : undefined,
        codeChallengeMethod: req.query.code_challenge_method ? String(req.query.code_challenge_method) : undefined,
        expiresAt: Date.now() + this.config.pendingAuthTtlMs
      });

      const url = new URL(this.config.yandex.authorizationUrl);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', this.config.yandex.clientId);
      url.searchParams.set('redirect_uri', this.config.yandex.redirectUrl);
      url.searchParams.set('scope', this.config.yandex.scope);
      url.searchParams.set('state', state);
      url.searchParams.set('force_confirm', 'yes');

      res.redirect(url.toString());
    });

    app.get('/yandex/callback', async (req, res, next) => {
      try {
        this.sweepExpired();

        const pending = this.pending.get(String(req.query.state || ''));
        this.pending.delete(String(req.query.state || ''));
        if (!pending || pending.expiresAt <= Date.now()) {
          res.status(400).json({ error: 'invalid_yandex_state' });
          return;
        }

        if (req.query.error) {
          const redirect = new URL(pending.keycloakRedirectUri);
          redirect.searchParams.set('error', String(req.query.error));
          if (req.query.error_description) {
            redirect.searchParams.set('error_description', String(req.query.error_description));
          }
          redirect.searchParams.set('state', pending.keycloakState);
          res.redirect(redirect.toString());
          return;
        }

        if (!req.query.code) {
          res.status(400).json({ error: 'missing_yandex_authorization_code' });
          return;
        }

        const yandexTokens = await fetchYandexTokens({
          code: String(req.query.code),
          config: this.config
        });
        const profile = await fetchYandexProfile({
          accessToken: yandexTokens.access_token,
          config: this.config
        });
        const code = randomUrlSafe(32);
        const expiresAt = Date.now() + this.config.pendingAuthTtlMs;
        this.codes.set(code, {
          profile,
          yandexTokens,
          nonce: pending.nonce,
          codeChallenge: pending.codeChallenge,
          codeChallengeMethod: pending.codeChallengeMethod,
          expiresAt
        });
        this.tokens.set(yandexTokens.access_token, { profile, expiresAt });

        await repository.upsert({
          provider: 'yandex',
          providerSubject: profile.subject,
          keycloakSubject: profile.subject,
          email: profile.email,
          displayName: profile.name,
          rawProfile: profile.rawProfile
        });

        const redirect = new URL(pending.keycloakRedirectUri);
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', pending.keycloakState);
        res.redirect(redirect.toString());
      } catch (error) {
        next(error);
      }
    });

    app.post('/yandex/token', express.urlencoded({ extended: false }), (req, res) => {
      this.sweepExpired();

      if (!assertBrokerClient(req, this.config)) {
        res.status(401).json({ error: 'invalid_client' });
        return;
      }

      if (req.body.grant_type !== 'authorization_code') {
        res.status(400).json({ error: 'unsupported_grant_type' });
        return;
      }

      const entry = this.codes.get(req.body.code);
      this.codes.delete(req.body.code);
      if (!entry || entry.expiresAt <= Date.now()) {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }
      if (entry.codeChallenge) {
        const expected = entry.codeChallengeMethod === 'S256'
          ? sha256Base64Url(req.body.code_verifier || '')
          : req.body.code_verifier;
        if (expected !== entry.codeChallenge) {
          res.status(400).json({ error: 'invalid_grant' });
          return;
        }
      }

      res.json({
        access_token: entry.yandexTokens.access_token,
        refresh_token: entry.yandexTokens.refresh_token,
        token_type: 'Bearer',
        expires_in: Number(entry.yandexTokens.expires_in || 120),
        scope: 'openid profile email',
        id_token: buildIdToken(entry.profile, this.config, entry.nonce, this.signingKey)
      });
    });

    app.get('/yandex/userinfo', async (req, res, next) => {
      try {
        this.sweepExpired();

        const authorization = req.headers.authorization || '';
        const token = authorization.toLowerCase().startsWith('bearer ')
          ? authorization.slice(7)
          : '';

        if (!token) {
          res.status(401).json({ error: 'missing_token' });
          return;
        }

        let entry = this.tokens.get(token);
        if (!entry || entry.expiresAt <= Date.now()) {
          const profile = await fetchYandexProfile({ accessToken: token, config: this.config });
          entry = { profile, expiresAt: Date.now() + 120_000 };
          this.tokens.set(token, entry);
        }

        res.json({
          sub: entry.profile.subject,
          preferred_username: entry.profile.username,
          email: entry.profile.email,
          email_verified: Boolean(entry.profile.email),
          name: entry.profile.name
        });
      } catch (error) {
        next(error);
      }
    });
  }
}

module.exports = {
  YandexBroker,
  normalizeYandexProfile
};
