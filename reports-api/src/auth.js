const crypto = require('crypto');

function decodePart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function parseJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error('invalid_token_format');
  }

  return {
    header: decodePart(parts[0]),
    payload: decodePart(parts[1]),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], 'base64url')
  };
}

function hasAudience(payloadAudience, expectedAudience) {
  if (!expectedAudience) {
    return true;
  }

  return Array.isArray(payloadAudience)
    ? payloadAudience.includes(expectedAudience)
    : payloadAudience === expectedAudience;
}

function assertClaims(payload, config) {
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (!payload.sub) {
    throw new Error('missing_subject');
  }

  if (payload.exp && payload.exp <= nowSeconds) {
    throw new Error('token_expired');
  }

  if (config.issuer && payload.iss !== config.issuer) {
    throw new Error('invalid_issuer');
  }

  if (!hasAudience(payload.aud, config.audience)) {
    throw new Error('invalid_audience');
  }
}

class JwksClient {
  constructor({ jwksUrl, fetchImpl = fetch, ttlMs = 300000 }) {
    this.jwksUrl = jwksUrl;
    this.fetchImpl = fetchImpl;
    this.ttlMs = ttlMs;
    this.cachedAt = 0;
    this.keys = [];
  }

  async refresh() {
    const response = await this.fetchImpl(this.jwksUrl);
    if (!response.ok) {
      throw new Error(`jwks_fetch_failed:${response.status}`);
    }

    const body = await response.json();
    this.keys = Array.isArray(body.keys) ? body.keys : [];
    this.cachedAt = Date.now();
  }

  async getKey(kid) {
    if (!this.keys.length || Date.now() - this.cachedAt > this.ttlMs) {
      await this.refresh();
    }

    let key = this.keys.find((candidate) => candidate.kid === kid);
    if (!key) {
      await this.refresh();
      key = this.keys.find((candidate) => candidate.kid === kid);
    }

    if (!key) {
      throw new Error('jwks_key_not_found');
    }

    return key;
  }
}

async function verifyJwt(token, config, jwksClient = new JwksClient({ jwksUrl: config.jwksUrl })) {
  const parsed = parseJwt(token);
  if (parsed.header.alg !== 'RS256' || !parsed.header.kid) {
    throw new Error('unsupported_token_header');
  }

  const jwk = await jwksClient.getKey(parsed.header.kid);
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(parsed.signingInput),
    publicKey,
    parsed.signature
  );

  if (!verified) {
    throw new Error('invalid_signature');
  }

  assertClaims(parsed.payload, config);

  return {
    subject: parsed.payload.sub,
    username: parsed.payload.preferred_username || parsed.payload.sub,
    email: parsed.payload.email,
    name: parsed.payload.name,
    roles: parsed.payload.realm_access?.roles || []
  };
}

function bearerToken(header) {
  if (!header) {
    return '';
  }

  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : '';
}

function createAuthenticator(config, dependencies = {}) {
  const jwksClient = dependencies.jwksClient || new JwksClient({
    jwksUrl: config.jwksUrl,
    fetchImpl: dependencies.fetchImpl || fetch
  });

  return async function authenticate(req, res, next) {
    try {
      const token = bearerToken(req.headers.authorization);
      if (!token) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
      }

      req.user = await verifyJwt(token, config, jwksClient);
      next();
    } catch (error) {
      res.status(401).json({ error: 'invalid_token' });
    }
  };
}

module.exports = {
  JwksClient,
  bearerToken,
  createAuthenticator,
  parseJwt,
  verifyJwt
};
