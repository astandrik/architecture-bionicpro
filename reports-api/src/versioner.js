const { ClickHouseClient } = require('./clickhouse');
const { readConfig } = require('./config');
const {
  createS3ReportCache,
  reportDataVersion,
  reportVersionKey
} = require('./report-cache');

async function readReportDataVersion(clickHouse) {
  const rows = await clickHouse.query(`
    SELECT
      count() AS rowCount,
      toString(max(period_end)) AS processedUntil,
      toString(max(record_version)) AS processedAt
    FROM report_user_daily_current
  `);

  if (!Number(rows[0]?.rowCount)) {
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

async function runForever(config = readConfig()) {
  const clickHouse = new ClickHouseClient(config.clickHouse);
  const reportCache = createS3ReportCache(config.s3);
  const intervalMs = Number(process.env.REPORTS_VERSIONER_INTERVAL_SECONDS || 5) * 1000;

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
  setInterval(tick, intervalMs);
}

if (require.main === module) {
  runForever();
}

module.exports = {
  readReportDataVersion,
  syncReportVersionMarker
};
