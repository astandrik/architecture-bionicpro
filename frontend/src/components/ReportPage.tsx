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

const ReportPage: React.FC = () => {
  const authUrl = useMemo(
    () => (process.env.REACT_APP_AUTH_URL || 'http://localhost:8000').replace(/\/+$/, ''),
    []
  );
  const [initialized, setInitialized] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);

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
    setReportMessage(null);
  };

  const downloadReport = async () => {
    try {
      setLoading(true);
      setError(null);
      setReportMessage(null);

      const response = await fetch(`${authUrl}/api/reports`, {
        credentials: 'include'
      });

      if (response.status === 401) {
        setSession(null);
        throw new Error('Not authenticated');
      }

      if (!response.ok) {
        const details = await response.json().catch(() => null);
        throw new Error(details?.error || 'Report service is unavailable');
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const report = await response.json();
        setReportMessage(JSON.stringify(report, null, 2));
        return;
      }

      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'bionicpro-report';
      link.click();
      URL.revokeObjectURL(href);
      setReportMessage('Report downloaded');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (!initialized) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-100">Loading...</div>;
  }

  if (!session?.authenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100">
        <button
          onClick={login}
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          Login
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100">
      <div className="w-full max-w-xl rounded-lg bg-white p-8 shadow-md">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Usage Reports</h1>
            <p className="mt-2 text-sm text-gray-600">
              {session.user.name || session.user.username || session.user.email}
            </p>
          </div>
          <button
            onClick={logout}
            className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Logout
          </button>
        </div>

        <button
          onClick={downloadReport}
          disabled={loading}
          className={`rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 ${
            loading ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          {loading ? 'Generating Report...' : 'Download Report'}
        </button>

        {error && (
          <div className="mt-4 rounded bg-red-100 p-4 text-red-700">
            {error}
          </div>
        )}

        {reportMessage && (
          <pre className="mt-4 max-h-80 overflow-auto rounded bg-gray-900 p-4 text-sm text-white">
            {reportMessage}
          </pre>
        )}
      </div>
    </div>
  );
};

export default ReportPage;
