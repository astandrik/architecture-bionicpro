const crypto = require('crypto');

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function randomUrlSafe(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256Base64Url(value) {
  return base64Url(crypto.createHash('sha256').update(value).digest());
}

function deriveKey(secret) {
  if (!secret) {
    throw new Error('Token encryption key is required');
  }

  return crypto.createHash('sha256').update(secret).digest();
}

function encryptText(plainText, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    base64Url(iv),
    base64Url(tag),
    base64Url(ciphertext)
  ].join('.');
}

function decryptText(encrypted, secret) {
  const [ivRaw, tagRaw, ciphertextRaw] = encrypted.split('.');
  if (!ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error('Invalid encrypted token format');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveKey(secret),
    Buffer.from(ivRaw, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

function decodeJwtPayload(token) {
  if (!token) {
    return {};
  }

  const [, payload] = token.split('.');
  if (!payload) {
    return {};
  }

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

module.exports = {
  decodeJwtPayload,
  decryptText,
  encryptText,
  randomUrlSafe,
  sha256Base64Url
};
