import { useCallback, useEffect, useState } from 'react';
import api from '../api/axios';
import { Activity, Copy, RefreshCw, Server } from 'lucide-react';
import LoadingLogo from '../components/LoadingLogo';

const badge = (ok) =>
  ok
    ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
    : 'bg-rose-50 text-rose-900 border border-rose-200';

const SystemHealth = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/system/operations-status');
      setData(res.data || null);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Failed to load status.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copyJson = () => {
    if (!data) return;
    void navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <LoadingLogo message="Loading platform health…" sizeClass="w-24 h-24" className="text-slate-700" />
      </div>
    );
  }

  const fs = data?.filesystem;
  const mongoOk = data?.mongo?.ready && data?.mongo?.ping_ms >= 0;
  const diskOk = fs && fs.uploads_writable && fs.storage_writable && fs.backups_writable;

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Server className="text-indigo-600" />
            Platform health
          </h1>
          <p className="text-gray-500 mt-1 max-w-2xl">
            Live snapshot for operators: application build, database reachability, writable data directories, and
            process and host memory metrics.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden />
            Refresh
          </button>
          <button
            type="button"
            onClick={copyJson}
            disabled={!data}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <Copy size={16} aria-hidden />
            Copy JSON
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {data && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <Activity size={16} className="text-indigo-600" aria-hidden />
              Application
            </div>
            <dl className="mt-3 space-y-2 text-sm text-gray-600">
              <div className="flex justify-between gap-2">
                <dt>Version</dt>
                <dd className="font-mono text-gray-900">{data.app?.version}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Node</dt>
                <dd className="font-mono text-xs text-gray-900">{data.app?.node}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Uptime</dt>
                <dd className="text-gray-900">{data.app?.uptime_s}s</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Environment</dt>
                <dd className="text-gray-900">{data.app?.env}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-gray-800">MongoDB</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge(mongoOk)}`}>
                {mongoOk ? 'Reachable' : 'Check connection'}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge(data.mongo?.ready)}`}>
                readyState={data.mongo?.ready_state}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Last ping:{' '}
              <span className="font-mono text-gray-800">
                {data.mongo?.ping_ms == null ? '—' : `${data.mongo.ping_ms} ms`}
              </span>
            </p>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-gray-800">Filesystem</div>
            <ul className="mt-3 space-y-1 text-xs text-gray-600">
              <li className="flex justify-between">
                <span>uploads</span>
                <span className={fs?.uploads_writable ? 'text-emerald-700' : 'text-rose-700'}>
                  {fs?.uploads_writable ? 'writable' : 'blocked'}
                </span>
              </li>
              <li className="flex justify-between">
                <span>storage</span>
                <span className={fs?.storage_writable ? 'text-emerald-700' : 'text-rose-700'}>
                  {fs?.storage_writable ? 'writable' : 'blocked'}
                </span>
              </li>
              <li className="flex justify-between">
                <span>backups</span>
                <span className={fs?.backups_writable ? 'text-emerald-700' : 'text-rose-700'}>
                  {fs?.backups_writable ? 'writable' : 'blocked'}
                </span>
              </li>
            </ul>
            <p className={`mt-2 text-xs font-medium ${diskOk ? 'text-emerald-800' : 'text-rose-800'}`}>
              {diskOk ? 'OK for uploads and local backup markers.' : 'Fix volume permissions before go-live.'}
            </p>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-gray-800">Process & host</div>
            <dl className="mt-3 space-y-1 text-xs text-gray-600">
              <div className="flex justify-between">
                <dt>Heap</dt>
                <dd className="font-mono text-gray-900">{data.process?.heap_used_mb} MB</dd>
              </div>
              <div className="flex justify-between">
                <dt>RSS</dt>
                <dd className="font-mono text-gray-900">{data.process?.rss_mb} MB</dd>
              </div>
              <div className="flex justify-between">
                <dt>Free RAM</dt>
                <dd className="font-mono text-gray-900">{data.host?.freemem_mb} / {data.host?.totalmem_mb} MB</dd>
              </div>
              <div className="flex justify-between">
                <dt>Load (1m)</dt>
                <dd className="font-mono text-gray-900">{data.host?.loadavg?.[0]?.toFixed?.(2) ?? '—'}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemHealth;
