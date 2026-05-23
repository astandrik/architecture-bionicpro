const crypto = require('node:crypto');
const {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} = require('@aws-sdk/client-s3');

function hmacKey(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

function sanitizeKeyPart(value) {
  return String(value || 'unknown')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function reportDataVersion(watermark) {
  return sanitizeKeyPart(`${watermark.processedUntil}_${watermark.processedAt || 'unknown'}`);
}

function reportManifestKey({ username, periodStart, periodEnd, dataVersion, secret }) {
  return [
    'reports',
    hmacKey(username, secret),
    `${periodStart}_${periodEnd}`,
    sanitizeKeyPart(dataVersion),
    'manifest.json'
  ].join('/');
}

function reportVersionKey(pipelineName) {
  return ['reports', '_versions', `${sanitizeKeyPart(pipelineName)}.json`].join('/');
}

function reportObjectKey({ username, periodStart, periodEnd, watermark, secret, reportId = crypto.randomUUID() }) {
  return [
    'reports',
    hmacKey(username, secret),
    `${periodStart}_${periodEnd}`,
    'objects',
    `${reportDataVersion(watermark)}.json`
      .replace('.json', `-${sanitizeKeyPart(reportId)}.json`)
  ].join('/');
}

function publicReportPath(cdnBaseUrl, key) {
  const basePath = new URL(cdnBaseUrl).pathname.replace(/\/+$/, '');
  const relativeKey = key.replace(/^reports\/+/, '');
  return `${basePath}/${relativeKey.split('/').map(encodeURIComponent).join('/')}`;
}

function signCdnPath(path, expires, secret) {
  return crypto
    .createHash('md5')
    .update(`${expires}${path} ${secret}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function reportCdnUrl(cdnBaseUrl, key, { signingSecret, ttlSeconds, now = Date.now() }) {
  const base = new URL(cdnBaseUrl);
  const path = publicReportPath(cdnBaseUrl, key);
  const expires = Math.floor(now / 1000) + ttlSeconds;
  const signature = signCdnPath(path, expires, signingSecret);
  return `${base.origin}${path}?expires=${expires}&signature=${signature}`;
}

function isNotFound(error) {
  return error?.name === 'NotFound'
    || error?.$metadata?.httpStatusCode === 404
    || error?.Code === 'NoSuchKey'
    || error?.Code === 'NotFound';
}

async function bodyToString(body) {
  if (body?.transformToString) {
    return body.transformToString();
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

class S3ReportCache {
  constructor({ client, bucket, cdnBaseUrl, cdnSigningSecret, cdnUrlTtlSeconds }) {
    this.client = client;
    this.bucket = bucket;
    this.cdnBaseUrl = cdnBaseUrl;
    this.cdnSigningSecret = cdnSigningSecret;
    this.cdnUrlTtlSeconds = cdnUrlTtlSeconds;
  }

  url(key) {
    return reportCdnUrl(this.cdnBaseUrl, key, {
      signingSecret: this.cdnSigningSecret,
      ttlSeconds: this.cdnUrlTtlSeconds
    });
  }

  async exists(key) {
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      }));
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  async getJson(key) {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      }));
      return JSON.parse(await bodyToString(response.Body));
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async putJson(key, value) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: `${JSON.stringify(value, null, 2)}\n`,
      ContentType: 'application/json',
      CacheControl: 'public, max-age=3600'
    }));
  }
}

function createS3ReportCache(config) {
  return new S3ReportCache({
    bucket: config.bucket,
    cdnBaseUrl: config.cdnBaseUrl,
    cdnSigningSecret: config.cdnSigningSecret,
    cdnUrlTtlSeconds: config.cdnUrlTtlSeconds,
    client: new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    })
  });
}

module.exports = {
  S3ReportCache,
  bodyToString,
  createS3ReportCache,
  hmacKey,
  publicReportPath,
  reportCdnUrl,
  reportDataVersion,
  reportManifestKey,
  reportObjectKey,
  reportVersionKey,
  signCdnPath,
  sanitizeKeyPart
};
