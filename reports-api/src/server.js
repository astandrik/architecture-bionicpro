const express = require('express');
const { createAuthenticator } = require('./auth');
const { ClickHouseClient, createReportStore } = require('./clickhouse');
const { readConfig } = require('./config');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function compareDates(left, right) {
  return left.localeCompare(right);
}

function isRealDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validatePeriod(query) {
  const periodStart = String(query.periodStart || '');
  const periodEnd = String(query.periodEnd || '');

  if (
    !DATE_PATTERN.test(periodStart)
    || !DATE_PATTERN.test(periodEnd)
    || !isRealDate(periodStart)
    || !isRealDate(periodEnd)
  ) {
    return { error: 'invalid_period' };
  }

  if (compareDates(periodStart, periodEnd) > 0) {
    return { error: 'invalid_period_range' };
  }

  return { periodStart, periodEnd };
}

function createDefaultStore(config) {
  return createReportStore({
    clickHouse: new ClickHouseClient(config.clickHouse),
    pipelineName: config.pipelineName
  });
}

function createApp(options = {}) {
  const config = options.config || readConfig();
  const reportStore = options.reportStore || createDefaultStore(config);
  const authenticate = options.authenticate || createAuthenticator(config.jwt);
  const app = express();

  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/reports', authenticate, async (req, res, next) => {
    try {
      const period = validatePeriod(req.query);
      if (period.error) {
        res.status(400).json({ error: period.error });
        return;
      }

      const requestedUsername = req.query.username ? String(req.query.username) : '';
      if (requestedUsername && requestedUsername !== req.user.username) {
        res.status(403).json({ error: 'forbidden_user_report' });
        return;
      }

      const processedUntil = await reportStore.processedUntil();
      if (!processedUntil || compareDates(processedUntil, period.periodEnd) < 0) {
        res.status(409).json({
          error: 'period_not_processed',
          processedUntil
        });
        return;
      }

      const report = await reportStore.getUserReport(
        req.user.username,
        period.periodStart,
        period.periodEnd
      );

      res.json({
        user: {
          subject: req.user.subject,
          username: req.user.username
        },
        period: {
          start: period.periodStart,
          end: period.periodEnd
        },
        generatedAt: new Date().toISOString(),
        rows: report.rows,
        totals: report.totals
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    res.status(500).json({ error: 'reports_api_error', message: error.message });
  });

  return app;
}

if (require.main === module) {
  const config = readConfig();
  const app = createApp({ config });
  app.listen(config.port, () => {
    console.log(`reports-api listening on ${config.port}`);
  });
}

module.exports = {
  createApp,
  validatePeriod
};
