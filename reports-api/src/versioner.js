const { ClickHouseClient } = require('./clickhouse');
const { readVersionerConfig } = require('./config');
const {
  createS3ReportCache,
  reportDataVersion,
  reportVersionKey
} = require('./report-cache');

function hasRows(rowCount) {
  return BigInt(String(rowCount || 0)) > 0n;
}

function versionerIntervalMs(env = process.env) {
  const raw = env.REPORTS_VERSIONER_INTERVAL_SECONDS;
  const seconds = raw === undefined || raw === '' ? 5 : Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 5_000;
  }

  return Math.max(1_000, Math.floor(seconds * 1000));
}

async function readReportDataVersion(clickHouse) {
  const rows = await clickHouse.query(`
    SELECT
      count() AS rowCount,
      toString(max(period_end)) AS processedUntil,
      toString(max(record_version)) AS processedAt
    FROM report_user_daily_current
  `);

  if (!hasRows(rows[0]?.rowCount)) {
    return null;
  }

  const watermark = {
    processedUntil: rows[0].processedUntil,
    processedAt: rows[0].processedAt
  };

  return {
    processedUntil: watermark.processedUntil,
    processedAt: watermark.processedAt,
    dataVersion: reportDataVersion(watermark)
  };
}

async function syncReportVersionMarker({ clickHouse, reportCache, pipelineName }) {
  const reportVersion = await readReportDataVersion(clickHouse);
  if (!reportVersion) {
    return null;
  }

  const version = {
    pipeline: pipelineName,
    ...reportVersion
  };
  await reportCache.putJson(reportVersionKey(pipelineName), version, { cacheControl: 'no-store' });
  return version;
}

async function runForever(config = readVersionerConfig()) {
  const clickHouse = new ClickHouseClient(config.clickHouse);
  const reportCache = createS3ReportCache(config.s3);
  const intervalMs = versionerIntervalMs();

  async function tick() {
    try {
      const version = await syncReportVersionMarker({
        clickHouse,
        reportCache,
        pipelineName: config.pipelineName
      });
      if (version) {
        console.log(`reports-versioner marker ${version.dataVersion}`);
      }
    } catch (error) {
      console.error(`reports-versioner failed: ${error.message}`);
    }
  }

  await tick();

  async function scheduleNext() {
    await tick();
    setTimeout(scheduleNext, intervalMs);
  }

  setTimeout(scheduleNext, intervalMs);
}

if (require.main === module) {
  runForever();
}

module.exports = {
  readReportDataVersion,
  syncReportVersionMarker,
  versionerIntervalMs
};
