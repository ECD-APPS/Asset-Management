import { useEffect, useState, useCallback } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const statusBadgeClass = (status) => {
  if (status === 'Approved') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (status === 'Ordered') return 'bg-amber-100 text-amber-900 border-amber-200';
  if (status === 'Rejected') return 'bg-rose-100 text-rose-800 border-rose-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
};

const typeBadgeClass = (type) => {
  if (String(type || '').toLowerCase().includes('ppm')) return 'bg-indigo-100 text-indigo-800 border-indigo-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
};

const AdminRequests = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/requests${status ? `?status=${status}` : ''}`);
      const data = res.data;
      const filtered = search.trim()
        ? data.filter(r => {
            const q = search.toLowerCase();
            return (r.requester?.name || '').toLowerCase().includes(q)
              || (r.requester?.email || '').toLowerCase().includes(q)
              || (r.requester?.phone || '').toLowerCase().includes(q)
              || (r.requester?.username || '').toLowerCase().includes(q);
          })
        : data;
      setRequests(filtered);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (reqRow, s) => {
    const id = reqRow?._id;
    if (!id || updatingId) return;
    // Optimistic UI update so the label changes immediately
    setRequests(prev => prev.map(r => r._id === id ? { ...r, status: s, updatedAt: new Date().toISOString() } : r));
    try {
      setUpdatingId(id);
      await api.put(`/requests/${id}`, {
        status: s,
        item_name: reqRow.item_name,
        quantity: reqRow.quantity,
        description: reqRow.description,
        admin_note: reqRow.admin_note || ''
      });
    } catch (err) {
      // If API fails, reload to reflect actual state
      console.error(err);
    } finally {
      setUpdatingId('');
      load();
    }
  };
  
  const exportExcel = async () => {
    try {
      const params = new URLSearchParams();
      if (status) params.append('status', status);
      if (search.trim()) params.append('q', search.trim());
      const res = await api.get(`/requests/export${params.toString() ? `?${params.toString()}` : ''}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'requests.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed', err);
    }
  };

  const pendingCount = requests.filter((r) => r.status === 'Pending').length;
  const approvedCount = requests.filter((r) => r.status === 'Approved').length;
  const rejectedCount = requests.filter((r) => r.status === 'Rejected').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Requests</h1>
          <p className="text-sm text-slate-600 mt-1">Review spare/tool requests, modify details, and approve or reject with notes.</p>
        </div>
        <button
          onClick={exportExcel}
          className="px-4 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 text-sm font-medium"
        >
          Export Excel
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="text-xs uppercase text-slate-500 font-semibold">Pending</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{pendingCount}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="text-xs uppercase text-slate-500 font-semibold">Approved</div>
          <div className="text-2xl font-bold text-emerald-700 mt-1">{approvedCount}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="text-xs uppercase text-slate-500 font-semibold">Rejected</div>
          <div className="text-2xl font-bold text-rose-700 mt-1">{rejectedCount}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <input
          type="text"
          placeholder="Search technician name, email, phone, username"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-slate-300 p-2 rounded-lg md:col-span-2"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-slate-300 p-2 rounded-lg">
          <option value="">All Status</option>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Ordered">Ordered</option>
          <option value="Rejected">Rejected</option>
        </select>
        <button onClick={load} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Search</button>
        <button onClick={() => { setSearch(''); setStatus(''); }} className="bg-slate-100 border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium">Clear</button>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-slate-500">Loading requests...</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Item</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Qty</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Description</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Admin Note</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Store</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Technician</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Updated</th>
                {user?.role !== 'Viewer' && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Action</th>
                )}
              </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={user?.role !== 'Viewer' ? 10 : 9} className="px-4 py-8 text-center text-slate-500">
                    No requests found for the selected filters.
                  </td>
                </tr>
              ) : requests.map(r => (
                <tr key={r._id} className="hover:bg-slate-50/70 align-top">
                  <td className="px-4 py-3">
                    <input
                      value={r.item_name || ''}
                      onChange={(e) => setRequests((prev) => prev.map((x) => (x._id === r._id ? { ...x, item_name: e.target.value } : x)))}
                      className="border border-slate-300 rounded px-2 py-1.5 text-sm w-44"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 text-xs rounded-full border ${typeBadgeClass(r.request_type)}`}>
                      {r.request_type || 'General'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={1}
                      value={r.quantity || 1}
                      onChange={(e) => setRequests((prev) => prev.map((x) => (x._id === r._id ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))}
                      className="border border-slate-300 rounded px-2 py-1.5 text-sm w-20"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <textarea
                      value={r.description || ''}
                      onChange={(e) => setRequests((prev) => prev.map((x) => (x._id === r._id ? { ...x, description: e.target.value } : x)))}
                      className="border border-slate-300 rounded px-2 py-1.5 text-sm w-60"
                      rows={2}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <textarea
                      value={r.admin_note || ''}
                      onChange={(e) => setRequests((prev) => prev.map((x) => (x._id === r._id ? { ...x, admin_note: e.target.value } : x)))}
                      className="border border-slate-300 rounded px-2 py-1.5 text-sm w-52"
                      rows={2}
                      placeholder="Add decision note / modified part details"
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.store?.name || '-'}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{r.requester?.name}</div>
                    <div className="text-xs text-slate-500">{r.requester?.email}</div>
                    <div className="text-xs text-slate-500">{r.requester?.phone || ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 text-xs rounded-full border ${statusBadgeClass(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{new Date(r.updatedAt).toLocaleString()}</td>
                  {user?.role !== 'Viewer' && (
                    <td className="px-4 py-3">
                      {r.status === 'Approved' ? (
                        <span className="text-emerald-700 font-semibold">Approved</span>
                      ) : r.status === 'Ordered' ? (
                        <span className="text-amber-700 font-semibold">Ordered</span>
                      ) : r.status === 'Rejected' ? (
                        <span className="text-rose-700 font-semibold">Rejected</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={Boolean(updatingId)}
                            onClick={() => updateStatus(r, 'Approved')}
                            className={`px-2.5 py-1 rounded border text-xs border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 ${updatingId ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            {updatingId === r._id ? 'Updating...' : 'Approve'}
                          </button>
                          <button
                            disabled={Boolean(updatingId)}
                            onClick={() => updateStatus(r, 'Ordered')}
                            className={`px-2.5 py-1 rounded border text-xs border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 ${updatingId ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            Mark Ordered
                          </button>
                          <button
                            disabled={Boolean(updatingId)}
                            onClick={() => updateStatus(r, 'Rejected')}
                            className={`px-2.5 py-1 rounded border text-xs border-rose-300 bg-rose-50 text-rose-900 hover:bg-rose-100 ${updatingId ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminRequests;
