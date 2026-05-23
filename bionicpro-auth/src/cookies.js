const crypto = require('crypto');

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function encodeSigned(value, secret) {
  return `${value}.${sign(value, secret)}`;
}

function decodeSigned(rawValue, secret) {
  if (!rawValue) {
    return null;
  }

  const dot = rawValue.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }

  const value = rawValue.slice(0, dot);
  const signature = rawValue.slice(dot + 1);
  const expected = sign(value, secret);

  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return null;
  }

  return value;
}

function parseCookies(header) {
  if (!header) {
    return {};
  }

  return header.split(';').reduce((cookies, item) => {
    const index = item.indexOf('=');
    if (index === -1) {
      return cookies;
    }

    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);

  if (options.secure) {
    parts.push('Secure');
  }
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  return parts.join('; ');
}

function clearCookie(name, options = {}) {
  return serializeCookie(name, '', {
    ...options,
    maxAge: 0,
    expires: new Date(0)
  });
}

module.exports = {
  clearCookie,
  decodeSigned,
  encodeSigned,
  parseCookies,
  serializeCookie
};
