const { decryptText, encryptText, randomUrlSafe } = require('./crypto-utils');

class SessionStore {
  constructor({ sessionTtlMs, pendingAuthTtlMs, tokenEncryptionKey, sessionRotationGraceMs = 5000 }) {
    this.sessionTtlMs = sessionTtlMs;
    this.pendingAuthTtlMs = pendingAuthTtlMs;
    this.tokenEncryptionKey = tokenEncryptionKey;
    this.sessionRotationGraceMs = sessionRotationGraceMs;
    this.sessions = new Map();
    this.rotatedSessionIds = new Map();
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

    const sessionId = this.resolveSessionId(id);
    if (!sessionId) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
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

  resolveSessionId(id) {
    let currentId = id;

    for (let depth = 0; depth < 10; depth += 1) {
      if (this.sessions.has(currentId)) {
        return currentId;
      }

      const rotated = this.rotatedSessionIds.get(currentId);
      if (!rotated || rotated.expiresAt <= Date.now()) {
        this.rotatedSessionIds.delete(currentId);
        return null;
      }

      currentId = rotated.sessionId;
    }

    return null;
  }

  rotateSession(id) {
    const session = this.getSession(id);
    if (!session) {
      return null;
    }

    const previousId = session.id;
    this.sessions.delete(previousId);
    const nextId = randomUrlSafe(32);
    const rotated = {
      ...session,
      id: nextId,
      rotatedAt: Date.now()
    };
    const alias = {
      sessionId: nextId,
      expiresAt: Date.now() + this.sessionRotationGraceMs
    };
    this.sessions.set(nextId, rotated);
    this.rotatedSessionIds.set(previousId, alias);
    if (id !== previousId && this.rotatedSessionIds.has(id)) {
      this.rotatedSessionIds.set(id, alias);
    }
    return rotated;
  }

  deleteSession(id) {
    const sessionId = this.resolveSessionId(id) || id;
    this.sessions.delete(sessionId);
    this.rotatedSessionIds.delete(id);

    for (const [rotatedId, target] of this.rotatedSessionIds.entries()) {
      if (target.sessionId === sessionId) {
        this.rotatedSessionIds.delete(rotatedId);
      }
    }
  }

  cleanup() {
    const now = Date.now();

    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt <= now || (session.refreshExpiresAt && session.refreshExpiresAt <= now)) {
        this.sessions.delete(id);
      }
    }

    for (const [id, rotated] of this.rotatedSessionIds.entries()) {
      if (
        rotated.expiresAt <= now
        || (!this.sessions.has(rotated.sessionId) && !this.rotatedSessionIds.has(rotated.sessionId))
      ) {
        this.rotatedSessionIds.delete(id);
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
