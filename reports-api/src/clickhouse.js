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
      output_format_json_quote_64bit_integers: '0'
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

function numeric(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  return Number(value);
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
    samplesCount: numeric(row.samplesCount),
    movementsCount: numeric(row.movementsCount),
    avgSignalStrength: numeric(row.avgSignalStrength),
    maxTemperature: numeric(row.maxTemperature),
    lowBatteryEvents: numeric(row.lowBatteryEvents),
    errorEvents: numeric(row.errorEvents),
    activeMinutes: numeric(row.activeMinutes)
  };
}

function summarizeRows(rows) {
  const totals = rows.reduce((acc, row) => {
    acc.samplesCount += row.samplesCount;
    acc.movementsCount += row.movementsCount;
    acc.lowBatteryEvents += row.lowBatteryEvents;
    acc.errorEvents += row.errorEvents;
    acc.activeMinutes += row.activeMinutes;

    if (row.maxTemperature !== null && row.maxTemperature !== undefined) {
      acc.maxTemperature = acc.maxTemperature === null
        ? row.maxTemperature
        : Math.max(acc.maxTemperature, row.maxTemperature);
    }

    acc.weightedSignal += row.avgSignalStrength * row.samplesCount;
    return acc;
  }, {
    samplesCount: 0,
    movementsCount: 0,
    lowBatteryEvents: 0,
    errorEvents: 0,
    activeMinutes: 0,
    maxTemperature: null,
    weightedSignal: 0
  });

  return {
    samplesCount: totals.samplesCount,
    movementsCount: totals.movementsCount,
    avgSignalStrength: totals.samplesCount > 0
      ? Number((totals.weightedSignal / totals.samplesCount).toFixed(2))
      : null,
    maxTemperature: totals.maxTemperature,
    lowBatteryEvents: totals.lowBatteryEvents,
    errorEvents: totals.errorEvents,
    activeMinutes: totals.activeMinutes
  };
}

function createReportStore({ clickHouse, pipelineName }) {
  return {
    async processedUntil() {
      const rows = await clickHouse.query(`
        SELECT toString(max(processed_until)) AS processedUntil
        FROM etl_watermarks
        WHERE pipeline = {pipeline:String}
      `, { pipeline: pipelineName });

      return rows[0]?.processedUntil || null;
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
        FROM report_user_daily
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
  createReportStore,
  normalizeReportRow,
  summarizeRows
};
