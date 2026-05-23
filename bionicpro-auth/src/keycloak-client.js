const { decodeJwtPayload } = require('./crypto-utils');

function tokenExpiry(accessToken, expiresInSeconds) {
  const payload = decodeJwtPayload(accessToken);
  if (payload.exp) {
    return payload.exp * 1000;
  }

  return Date.now() + Number(expiresInSeconds || 120) * 1000;
}

function refreshExpiry(refreshToken, expiresInSeconds) {
  const payload = decodeJwtPayload(refreshToken);
  if (payload.exp) {
    return payload.exp * 1000;
  }

  return expiresInSeconds ? Date.now() + Number(expiresInSeconds) * 1000 : null;
}

function userFromTokens(tokens) {
  const idPayload = decodeJwtPayload(tokens.id_token);
  const accessPayload = decodeJwtPayload(tokens.access_token);
  const payload = Object.keys(idPayload).length > 0 ? idPayload : accessPayload;

  return {
    subject: payload.sub,
    username: payload.preferred_username,
    email: payload.email,
    name: payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(' '),
    roles: accessPayload.realm_access?.roles || []
  };
}

class KeycloakClient {
  constructor(config) {
    this.config = config;
  }

  async exchangeCode({ code, codeVerifier }) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.callbackUrl,
      code_verifier: codeVerifier
    });

    return this.requestToken(body);
  }

  async refresh(refreshToken) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken
    });

    return this.requestToken(body);
  }

  async requestToken(body) {
    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Keycloak token request failed: ${response.status} ${JSON.stringify(json)}`);
    }

    if (!json.access_token || !json.refresh_token) {
      throw new Error('Keycloak token response did not include access_token and refresh_token');
    }

    return {
      ...json,
      accessTokenExpiresAt: tokenExpiry(json.access_token, json.expires_in),
      refreshExpiresAt: refreshExpiry(json.refresh_token, json.refresh_expires_in)
    };
  }

  async logout(refreshToken) {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken
    });

    await fetch(this.config.logoutUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }).catch(() => null);
  }

  async userInfo(accessToken) {
    const response = await fetch(this.config.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      return null;
    }

    return response.json().catch(() => null);
  }

  async brokerToken(accessToken) {
    const response = await fetch(this.config.brokerTokenUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      return null;
    }

    return response.json().catch(() => null);
  }
}

module.exports = {
  KeycloakClient,
  userFromTokens
};
