import React, { useEffect, useMemo, useState } from 'react';

type AuthUser = {
  subject: string;
  username?: string;
  email?: string;
  name?: string;
  roles?: string[];
};

type AuthSession = {
  authenticated: boolean;
  user: AuthUser;
  sessionExpiresAt: string;
  accessTokenExpiresAt: string;
};

type ReportRow = {
  periodStart: string;
  periodEnd: string;
  prosthesisId: string;
  prosthesisModel: string;
  samplesCount: number;
  movementsCount: number;
  avgSignalStrength: number | null;
  maxTemperature: number | null;
  lowBatteryEvents: number;
  errorEvents: number;
  activeMinutes: number;
};

type ReportResponse = {
  user: {
    subject: string;
    username: string;
  };
  period: {
    start: string;
    end: string;
  };
  generatedAt: string;
  rows: ReportRow[];
  totals: {
    samplesCount: number;
    movementsCount: number;
    avgSignalStrength: number | null;
    maxTemperature: number | null;
    lowBatteryEvents: number;
    errorEvents: number;
    activeMinutes: number;
  };
};

type ReportDescriptor = {
  user: {
    subject: string;
    username: string;
  };
  period: {
    start: string;
    end: string;
  };
  reportUrl: string;
  cacheStatus: 'hit' | 'miss';
  dataVersion: string;
  processedUntil: string;
};

function dateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const ReportPage: React.FC = () => {
  const authUrl = useMemo(
    () => (process.env.REACT_APP_AUTH_URL || 'http://localhost:8000').replace(/\/+$/, ''),
    []
  );
  const defaultPeriod = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return {
      start: dateInputValue(start),
      end: dateInputValue(end)
    };
  }, []);
  const [initialized, setInitialized] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState(defaultPeriod.start);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.end);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [reportDescriptor, setReportDescriptor] = useState<ReportDescriptor | null>(null);

  useEffect(() => {
    let mounted = true;

    fetch(`${authUrl}/auth/session`, {
      credentials: 'include'
    })
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        return response.json() as Promise<AuthSession>;
      })
      .then((data) => {
        if (mounted) {
          setSession(data);
        }
      })
      .catch(() => {
        if (mounted) {
          setSession(null);
        }
      })
      .finally(() => {
        if (mounted) {
          setInitialized(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [authUrl]);

  const login = () => {
    window.location.assign(`${authUrl}/auth/login`);
  };

  const logout = async () => {
    await fetch(`${authUrl}/auth/logout`, {
      method: 'POST',
      credentials: 'include'
    });
    setSession(null);
    setReport(null);
    setReportDescriptor(null);
  };

  const downloadReport = async () => {
    try {
      setLoading(true);
      setError(null);
      setReport(null);
      setReportDescriptor(null);

      const params = new URLSearchParams({ periodStart, periodEnd });
      const response = await fetch(`${authUrl}/api/reports?${params}`, {
        credentials: 'include'
      });

      if (response.status === 401) {
        setSession(null);
        throw new Error('Нужно войти в систему');
      }

      if (!response.ok) {
        const details = await response.json().catch(() => null);
        if (response.status === 409 && details?.error === 'period_not_processed') {
          const suffix = details.processedUntil
            ? ` Последний обработанный день: ${details.processedUntil}.`
            : '';
          throw new Error(`Выбранный период ещё не обработан Airflow.${suffix}`);
        }
        throw new Error(details?.error || 'Сервис отчётов недоступен');
      }

      const descriptor = await response.json() as ReportDescriptor;
      const reportResponse = await fetch(descriptor.reportUrl);
      if (!reportResponse.ok) {
        throw new Error('Отчёт сформирован, но CDN сейчас недоступен');
      }

      setReportDescriptor(descriptor);
      setReport(await reportResponse.json() as ReportResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить отчёт');
    } finally {
      setLoading(false);
    }
  };

  if (!initialized) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-100">Загрузка...</div>;
  }

  if (!session?.authenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100">
        <button
          onClick={login}
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          Войти
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-8">
      <div className="mx-auto w-full max-w-5xl rounded-lg bg-white p-8 shadow-md">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Отчёт по работе протеза</h1>
            <p className="mt-2 text-sm text-gray-600">
              {session.user.name || session.user.username || session.user.email}
            </p>
          </div>
          <button
            onClick={logout}
            className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Выйти
          </button>
        </div>

        <div className="mb-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block text-sm font-medium text-gray-700">
            Начало периода
            <input
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Конец периода
            <input
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
          <button
            onClick={downloadReport}
            disabled={loading}
            className={`rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 ${
              loading ? 'cursor-not-allowed opacity-50' : ''
            }`}
          >
            {loading ? 'Формируется...' : 'Получить отчёт'}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded bg-red-100 p-4 text-red-700">
            {error}
          </div>
        )}

        {report && (
          <div className="mt-6 space-y-6">
            {reportDescriptor && (
              <div className="rounded border border-gray-200 p-3 text-sm text-gray-700">
                <div>
                  Источник: <span className="font-medium">
                    {reportDescriptor.cacheStatus === 'hit' ? 'CDN-кеш' : 'OLAP-витрина'}
                  </span>
                </div>
                <div>
                  Данные обработаны по: <span className="font-medium">{reportDescriptor.processedUntil}</span>
                </div>
                <a
                  href={reportDescriptor.reportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-blue-600 hover:text-blue-700"
                >
                  Открыть JSON-файл отчёта
                </a>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded border border-gray-200 p-3">
                <div className="text-xs uppercase text-gray-500">Измерения</div>
                <div className="text-xl font-semibold">{report.totals.samplesCount}</div>
              </div>
              <div className="rounded border border-gray-200 p-3">
                <div className="text-xs uppercase text-gray-500">Минуты работы</div>
                <div className="text-xl font-semibold">{report.totals.activeMinutes}</div>
              </div>
              <div className="rounded border border-gray-200 p-3">
                <div className="text-xs uppercase text-gray-500">Ошибки</div>
                <div className="text-xl font-semibold">{report.totals.errorEvents}</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-600">
                    <th className="py-2 pr-4">День</th>
                    <th className="py-2 pr-4">Протез</th>
                    <th className="py-2 pr-4">Измерения</th>
                    <th className="py-2 pr-4">Движения</th>
                    <th className="py-2 pr-4">Сигнал</th>
                    <th className="py-2 pr-4">Макс. температура</th>
                    <th className="py-2 pr-4">Низкий заряд</th>
                    <th className="py-2 pr-4">Ошибки</th>
                    <th className="py-2 pr-4">Минуты</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr
                      key={`${row.periodStart}-${row.prosthesisId}`}
                      className="border-b border-gray-100"
                    >
                      <td className="py-2 pr-4">{row.periodStart}</td>
                      <td className="py-2 pr-4">
                        <div className="font-medium">{row.prosthesisId}</div>
                        <div className="text-xs text-gray-500">{row.prosthesisModel}</div>
                      </td>
                      <td className="py-2 pr-4">{row.samplesCount}</td>
                      <td className="py-2 pr-4">{row.movementsCount}</td>
                      <td className="py-2 pr-4">{row.avgSignalStrength ?? '-'}</td>
                      <td className="py-2 pr-4">{row.maxTemperature ?? '-'}</td>
                      <td className="py-2 pr-4">{row.lowBatteryEvents}</td>
                      <td className="py-2 pr-4">{row.errorEvents}</td>
                      <td className="py-2 pr-4">{row.activeMinutes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.rows.length === 0 && (
                <div className="rounded border border-gray-200 p-4 text-sm text-gray-600">
                  За выбранный период данных по этому пользователю нет.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportPage;
