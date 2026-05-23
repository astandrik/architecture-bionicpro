class ClickHouseClient {
  constructor({ url, database, user = '', password = '', fetchImpl = fetch }) {
    this.url = url.replace(/\/+$/, '');
    this.database = database;
    this.user = user;
    this.password = password;
    this.fetchImpl = fetchImpl;
  }

  async query(sql, params = {}) {
    const queryParams = new URLSearchParams({
      database: this.database,
      output_format_json_quote_64bit_integers: '1'
    });

    if (this.user) {
      queryParams.set('user', this.user);
      queryParams.set('password', this.password);
    }

    Object.entries(params).forEach(([key, value]) => {
      queryParams.set(`param_${key}`, String(value));
    });

    const response = await this.fetchImpl(`${this.url}/?${queryParams}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: `${sql}\nFORMAT JSON`
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`clickhouse_query_failed:${response.status}:${text}`);
    }

    const parsed = text ? JSON.parse(text) : {};
    return parsed.data || [];
  }
}

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function numeric(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  return Number(value);
}

function counterBigInt(value) {
  if (value === null || value === undefined || value === '') {
    return 0n;
  }

  return BigInt(String(value));
}

function counterJson(value) {
  return value <= MAX_SAFE_INTEGER_BIGINT ? Number(value) : value.toString();
}

function uint64(value) {
  return counterJson(counterBigInt(value));
}

function normalizeReportRow(row) {
  return {
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    username: row.username,
    userEmail: row.userEmail,
    customerName: row.customerName,
    prosthesisId: row.prosthesisId,
    prosthesisModel: row.prosthesisModel,
    samplesCount: uint64(row.samplesCount),
    movementsCount: uint64(row.movementsCount),
    avgSignalStrength: numeric(row.avgSignalStrength),
    maxTemperature: numeric(row.maxTemperature),
    lowBatteryEvents: uint64(row.lowBatteryEvents),
    errorEvents: uint64(row.errorEvents),
    activeMinutes: uint64(row.activeMinutes)
  };
}

function summarizeRows(rows) {
  const totals = rows.reduce((acc, row) => {
    const samplesCount = counterBigInt(row.samplesCount);

    acc.samplesCount += samplesCount;
    acc.movementsCount += counterBigInt(row.movementsCount);
    acc.lowBatteryEvents += counterBigInt(row.lowBatteryEvents);
    acc.errorEvents += counterBigInt(row.errorEvents);
    acc.activeMinutes += counterBigInt(row.activeMinutes);

    if (row.maxTemperature !== null && row.maxTemperature !== undefined) {
      acc.maxTemperature = acc.maxTemperature === null
        ? row.maxTemperature
        : Math.max(acc.maxTemperature, row.maxTemperature);
    }

    acc.weightedSignal += row.avgSignalStrength * Number(samplesCount);
    return acc;
  }, {
    samplesCount: 0n,
    movementsCount: 0n,
    lowBatteryEvents: 0n,
    errorEvents: 0n,
    activeMinutes: 0n,
    maxTemperature: null,
    weightedSignal: 0
  });

  return {
    samplesCount: counterJson(totals.samplesCount),
    movementsCount: counterJson(totals.movementsCount),
    avgSignalStrength: totals.samplesCount > 0n
      ? Number((totals.weightedSignal / Number(totals.samplesCount)).toFixed(2))
      : null,
    maxTemperature: totals.maxTemperature,
    lowBatteryEvents: counterJson(totals.lowBatteryEvents),
    errorEvents: counterJson(totals.errorEvents),
    activeMinutes: counterJson(totals.activeMinutes)
  };
}

function createReportStore({ clickHouse, pipelineName }) {
  async function watermark() {
    const rows = await clickHouse.query(`
      SELECT
        toString(processed_until) AS processedUntil,
        toString(processed_at) AS processedAt
      FROM etl_watermarks
      WHERE pipeline = {pipeline:String}
      ORDER BY processed_at DESC
      LIMIT 1
    `, { pipeline: pipelineName });

    if (!rows[0]?.processedUntil) {
      return null;
    }

    return {
      processedUntil: rows[0].processedUntil,
      processedAt: rows[0].processedAt || null
    };
  }

  return {
    watermark,

    async processedUntil() {
      const current = await watermark();
      return current?.processedUntil || null;
    },

    async getUserReport(username, periodStart, periodEnd) {
      const rows = await clickHouse.query(`
        SELECT
          toString(period_start) AS periodStart,
          toString(period_end) AS periodEnd,
          username AS username,
          user_email AS userEmail,
          customer_name AS customerName,
          prosthesis_id AS prosthesisId,
          prosthesis_model AS prosthesisModel,
          samples_count AS samplesCount,
          movements_count AS movementsCount,
          avg_signal_strength AS avgSignalStrength,
          max_temperature AS maxTemperature,
          low_battery_events AS lowBatteryEvents,
          error_events AS errorEvents,
          active_minutes AS activeMinutes
        FROM report_user_daily_current
        WHERE username = {username:String}
          AND period_start >= {periodStart:Date}
          AND period_end <= {periodEnd:Date}
        ORDER BY period_start, prosthesis_id
      `, { username, periodStart, periodEnd });

      const normalizedRows = rows.map(normalizeReportRow);
      return {
        rows: normalizedRows,
        totals: summarizeRows(normalizedRows)
      };
    }
  };
}

module.exports = {
  ClickHouseClient,
  counterBigInt,
  counterJson,
  createReportStore,
  normalizeReportRow,
  summarizeRows
};
