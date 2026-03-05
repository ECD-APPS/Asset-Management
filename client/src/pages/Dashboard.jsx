import { useEffect, useState } from 'react';
import DashboardCharts from '../components/DashboardCharts';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

import { Link } from 'react-router-dom';
import { 
  AlertCircle, 
  Bell, 
  Plus, 
  ArrowDownLeft, 
  Search, 
  MapPin, 
  ArrowRight,
  Activity,
  Package
} from 'lucide-react';

const Dashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [systemOk, setSystemOk] = useState(true);
  const [_HEALTH, setHealth] = useState({ backend: false, db: false });
  const [recentAssets, setRecentAssets] = useState([]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setError(null);
        const [statsResponse, recentResponse] = await Promise.all([
          api.get('/assets/stats'),
          api.get('/assets', { params: { page: 1, limit: 8 } })
        ]);
        setStats(statsResponse.data);
        setRecentAssets(recentResponse.data?.assets || []);
      } catch (error) {
        console.error('Error fetching stats:', error);
        setError('Failed to load dashboard data. Please try refreshing.');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  useEffect(() => {
    let timer;
    const checkHealth = async () => {
      try {
        const res = await fetch('/healthz', { credentials: 'include' });
        if (!res.ok) throw new Error('healthz failed');
        const data = await res.json();
        const backend = true;
        const db = !!data.db_connected;
        setHealth({ backend, db });
        setSystemOk(backend && db);
      } catch {
        setHealth({ backend: false, db: false });
        setSystemOk(false);
      }
    };
    checkHealth();
    timer = setInterval(checkHealth, 15000);
    return () => clearInterval(timer);
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-app-page">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[rgb(var(--accent-color))]"></div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-app-page flex items-center justify-center p-6">
      <div className="bg-app-card p-8 rounded-xl text-center max-w-md w-full">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-app-main mb-2">Error Loading Dashboard</h2>
        <p className="text-app-muted mb-6">{error}</p>
        <button
          onClick={() => window.location.reload()} 
          className="bg-app-accent px-6 py-2 rounded-xl hover:opacity-90 transition-opacity"
        >
          Retry
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-app-page space-y-6 text-app-main">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-app-main flex items-center gap-3">
            Dashboard
            {loading && <Activity className="w-5 h-5 text-app-accent animate-pulse" />}
          </h1>
          <p className="text-app-muted mt-1">Welcome back, {user?.name}. Here is the latest system snapshot.</p>
        </div>

        <div className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-medium ${systemOk ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            <div className={`w-2 h-2 rounded-full ${systemOk ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            <span>
              {systemOk ? 'System Operational' : 'Connectivity Issue'}
            </span>
        </div>
      </div>

      <div className="inline-flex items-center rounded-full border border-app-card bg-app-elevated px-3 py-1 text-xs text-app-muted">
        Theme: <span className="ml-1 font-semibold text-app-main capitalize">{theme}</span>
      </div>

      {(stats?.overview?.pendingRequests > 0 || (user?.role !== 'Viewer' && stats?.overview?.pendingReturns > 0)) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stats.overview.pendingRequests > 0 && (
            <div className="bg-app-card rounded-xl p-5 flex items-start justify-between hover:shadow-sm transition-shadow">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-xl mt-1">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-app-main">Pending Asset Requests</h3>
                  <p className="text-sm text-app-muted mt-1">
                    <span className="font-bold text-amber-600">{stats.overview.pendingRequests}</span> technician request{stats.overview.pendingRequests !== 1 && 's'} need approval.
                  </p>
                </div>
              </div>
              <Link
                to="/admin-requests" 
                className="flex items-center gap-1 text-sm font-medium text-amber-600 hover:text-amber-700 mt-2 md:mt-0"
              >
                Review <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          )}

          {user?.role !== 'Viewer' && stats.overview.pendingReturns > 0 && (
            <div className="bg-app-card rounded-xl p-5 flex items-start justify-between hover:shadow-sm transition-shadow">
              <div className="flex items-start gap-4">
                 <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl mt-1">
                  <ArrowDownLeft className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-app-main">Pending Returns</h3>
                  <p className="text-sm text-app-muted mt-1">
                    <span className="font-bold text-indigo-600">{stats.overview.pendingReturns}</span> asset{stats.overview.pendingReturns !== 1 && 's'} waiting for return confirmation.
                  </p>
                </div>
              </div>
              <Link
                to="/receive-process" 
                className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 mt-2 md:mt-0"
              >
                Process <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {user?.role !== 'Viewer' && (
            <>
              <Link to="/assets?action=add" className="bg-app-card p-4 rounded-xl flex flex-col items-center justify-center gap-3 hover:shadow-sm hover:-translate-y-0.5 transition-all group">
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl group-hover:bg-indigo-100 transition-colors">
                  <Plus className="w-6 h-6" />
                </div>
                <span className="font-medium text-app-main text-sm">Add New Asset</span>
              </Link>

              <Link to="/receive-process" className="bg-app-card p-4 rounded-xl flex flex-col items-center justify-center gap-3 hover:shadow-sm hover:-translate-y-0.5 transition-all group">
                <div className="p-3 bg-purple-50 text-purple-600 rounded-xl group-hover:bg-purple-100 transition-colors">
                  <ArrowDownLeft className="w-6 h-6" />
                </div>
                <span className="font-medium text-app-main text-sm">Receive / Return</span>
              </Link>
            </>
          )}

          <Link to="/assets" className="bg-app-card p-4 rounded-xl flex flex-col items-center justify-center gap-3 hover:shadow-sm hover:-translate-y-0.5 transition-all group">
             <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl group-hover:bg-emerald-100 transition-colors">
              <Search className="w-6 h-6" />
            </div>
            <span className="font-medium text-app-main text-sm">Search Assets</span>
          </Link>

          <Link to="/stores" className="bg-app-card p-4 rounded-xl flex flex-col items-center justify-center gap-3 hover:shadow-sm hover:-translate-y-0.5 transition-all group">
             <div className="p-3 bg-orange-50 text-orange-600 rounded-xl group-hover:bg-orange-100 transition-colors">
              <MapPin className="w-6 h-6" />
            </div>
            <span className="font-medium text-app-main text-sm">Manage Locations</span>
          </Link>
        </div>

      <DashboardCharts stats={stats} />

      <div className="rounded-xl border border-app-card bg-app-elevated shadow-sm">
        <div className="flex items-center justify-between border-b border-app-card px-5 py-4">
          <h2 className="text-base font-semibold text-app-main">Recent Asset Activity</h2>
          <Link to="/assets" className="text-sm text-app-accent hover:opacity-80 font-medium">View all</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-app-muted">
                <th className="px-5 py-3 font-medium">Asset</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentAssets.length === 0 && (
                <tr>
                  <td colSpan="4" className="px-5 py-8 text-center text-app-muted">
                    <div className="inline-flex items-center gap-2">
                      <Package size={16} />
                      No recent asset activity found.
                    </div>
                  </td>
                </tr>
              )}
              {recentAssets.map((asset) => (
                <tr key={asset._id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-app-main">{asset.name || '-'}</div>
                    <div className="text-xs text-app-muted font-mono">{asset.serial_number || '-'}</div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                      asset.status === 'In Use'
                        ? 'bg-emerald-50 text-emerald-700'
                        : asset.status === 'Spare'
                          ? 'bg-amber-50 text-amber-700'
                          : asset.status === 'Faulty'
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-slate-100 text-slate-700'
                    }`}>
                      {asset.status || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-app-main opacity-80">{asset.location || asset.store?.name || '-'}</td>
                  <td className="px-5 py-3.5 text-app-muted">{asset.updatedAt ? new Date(asset.updatedAt).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
