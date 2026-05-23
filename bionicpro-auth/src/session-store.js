const { decryptText, encryptText, randomUrlSafe } = require('./crypto-utils');

class SessionStore {
  constructor({ sessionTtlMs, pendingAuthTtlMs, tokenEncryptionKey }) {
    this.sessionTtlMs = sessionTtlMs;
    this.pendingAuthTtlMs = pendingAuthTtlMs;
    this.tokenEncryptionKey = tokenEncryptionKey;
    this.sessions = new Map();
    this.pendingAuth = new Map();
  }

  createPendingAuth(data) {
    this.cleanup();
    const id = randomUrlSafe(32);
    this.pendingAuth.set(id, {
      ...data,
      expiresAt: Date.now() + this.pendingAuthTtlMs
    });
    return id;
  }

  consumePendingAuth(id) {
    this.cleanup();
    const pending = this.pendingAuth.get(id);
    this.pendingAuth.delete(id);

    if (!pending || pending.expiresAt <= Date.now()) {
      return null;
    }

    return pending;
  }

  createSession({ accessToken, accessTokenExpiresAt, refreshToken, refreshExpiresAt, user }) {
    this.cleanup();
    const id = randomUrlSafe(32);
    const now = Date.now();

    this.sessions.set(id, {
      id,
      accessToken,
      accessTokenExpiresAt,
      encryptedRefreshToken: encryptText(refreshToken, this.tokenEncryptionKey),
      refreshExpiresAt,
      user,
      createdAt: now,
      rotatedAt: now,
      expiresAt: now + this.sessionTtlMs
    });

    return this.sessions.get(id);
  }

  getSession(id) {
    this.cleanup();
    if (!id) {
      return null;
    }

    const session = this.sessions.get(id);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }

    return session;
  }

  updateTokens(id, { accessToken, accessTokenExpiresAt, refreshToken, refreshExpiresAt }) {
    const session = this.getSession(id);
    if (!session) {
      return null;
    }

    session.accessToken = accessToken;
    session.accessTokenExpiresAt = accessTokenExpiresAt;
    if (refreshToken) {
      session.encryptedRefreshToken = encryptText(refreshToken, this.tokenEncryptionKey);
    }
    if (refreshExpiresAt) {
      session.refreshExpiresAt = refreshExpiresAt;
    }

    return session;
  }

  getRefreshToken(session) {
    return decryptText(session.encryptedRefreshToken, this.tokenEncryptionKey);
  }

  rotateSession(id) {
    const session = this.getSession(id);
    if (!session) {
      return null;
    }

    this.sessions.delete(id);
    const nextId = randomUrlSafe(32);
    const rotated = {
      ...session,
      id: nextId,
      rotatedAt: Date.now()
    };
    this.sessions.set(nextId, rotated);
    return rotated;
  }

  deleteSession(id) {
    this.sessions.delete(id);
  }

  cleanup() {
    const now = Date.now();

    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt <= now || (session.refreshExpiresAt && session.refreshExpiresAt <= now)) {
        this.sessions.delete(id);
      }
    }

    for (const [id, pending] of this.pendingAuth.entries()) {
      if (pending.expiresAt <= now) {
        this.pendingAuth.delete(id);
      }
    }
  }
}

module.exports = { SessionStore };
