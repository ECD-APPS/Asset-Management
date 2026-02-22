import { useEffect, useState } from 'react';
import DashboardCharts from '../components/DashboardCharts';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

import { Link } from 'react-router-dom';
import { 
  AlertCircle, 
  Bell, 
  Plus, 
  ArrowDownLeft, 
  Search, 
  MapPin, 
  ArrowRight,
  TrendingUp,
  Activity
} from 'lucide-react';

const Dashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [systemOk, setSystemOk] = useState(true);
  const [health, setHealth] = useState({ backend: false, db: false });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setError(null);
        const response = await api.get('/assets/stats');
        setStats(response.data);
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
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white p-8 rounded-lg shadow-md text-center max-w-md w-full">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Error Loading Dashboard</h2>
        <p className="text-gray-600 mb-6">{error}</p>
        <button 
          onClick={() => window.location.reload()} 
          className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8 space-y-8">
      {/* Header & Notifications Area */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            Dashboard
            {loading && <Activity className="w-5 h-5 text-blue-500 animate-pulse" />}
          </h1>
          <p className="text-gray-500 mt-1">Welcome back, {user?.name}</p>
        </div>

        {!loading && (
          <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-sm border border-gray-100">
            <div className={`w-2.5 h-2.5 rounded-full ${systemOk ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></div>
            <span className="text-sm font-medium text-gray-600">
              {systemOk ? 'System Operational' : 'Connectivity Issue'}
            </span>
          </div>
        )}
      </div>

      {/* Action Center (Notifications) - Top Left Priority */}
      {(stats?.overview?.pendingRequests > 0 || stats?.overview?.pendingReturns > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
          
          {/* Technician Request Notification */}
          {stats.overview.pendingRequests > 0 && (
            <div className="bg-white border-l-4 border-amber-500 p-5 rounded-lg shadow-sm flex items-start justify-between group hover:shadow-md transition-shadow">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-full mt-1">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Pending Asset Requests</h3>
                  <p className="text-sm text-gray-600 mt-1">
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

          {/* Return Request Notification */}
          {stats.overview.pendingReturns > 0 && (
            <div className="bg-white border-l-4 border-blue-500 p-5 rounded-lg shadow-sm flex items-start justify-between group hover:shadow-md transition-shadow">
              <div className="flex items-start gap-4">
                 <div className="p-2 bg-blue-50 text-blue-600 rounded-full mt-1">
                  <ArrowDownLeft className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Pending Returns</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    <span className="font-bold text-blue-600">{stats.overview.pendingReturns}</span> asset{stats.overview.pendingReturns !== 1 && 's'} waiting for return confirmation.
                  </p>
                </div>
              </div>
              <Link 
                to="/receive-process" 
                className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 mt-2 md:mt-0"
              >
                Process <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Quick Actions Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link to="/assets?action=add" className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-3 hover:shadow-md hover:-translate-y-1 transition-all group">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-100 transition-colors">
            <Plus className="w-6 h-6" />
          </div>
          <span className="font-semibold text-gray-700 text-sm">Add New Asset</span>
        </Link>
        
        <Link to="/receive-process" className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-3 hover:shadow-md hover:-translate-y-1 transition-all group">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-xl group-hover:bg-purple-100 transition-colors">
            <ArrowDownLeft className="w-6 h-6" />
          </div>
          <span className="font-semibold text-gray-700 text-sm">Receive / Return</span>
        </Link>
        
        <Link to="/assets" className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-3 hover:shadow-md hover:-translate-y-1 transition-all group">
           <div className="p-3 bg-green-50 text-green-600 rounded-xl group-hover:bg-green-100 transition-colors">
            <Search className="w-6 h-6" />
          </div>
          <span className="font-semibold text-gray-700 text-sm">Search Assets</span>
        </Link>
        
        <Link to="/stores" className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-3 hover:shadow-md hover:-translate-y-1 transition-all group">
           <div className="p-3 bg-orange-50 text-orange-600 rounded-xl group-hover:bg-orange-100 transition-colors">
            <MapPin className="w-6 h-6" />
          </div>
          <span className="font-semibold text-gray-700 text-sm">Manage Locations</span>
        </Link>
      </div>

      {/* Main Charts & Stats */}
      <DashboardCharts stats={stats} />
    </div>
  );
};

export default Dashboard;
