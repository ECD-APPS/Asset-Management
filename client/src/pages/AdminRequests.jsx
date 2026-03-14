import { useEffect, useState, useCallback } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const AdminRequests = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

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

  const updateStatus = async (id, s) => {
    // Optimistic UI update so the label changes immediately
    setRequests(prev => prev.map(r => r._id === id ? { ...r, status: s, updatedAt: new Date().toISOString() } : r));
    try {
      await api.put(`/requests/${id}`, { status: s });
    } catch (err) {
      // If API fails, reload to reflect actual state
      console.error(err);
    } finally {
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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Requests</h1>
      <div className="bg-white p-4 rounded shadow mb-6 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          type="text"
          placeholder="Search by technician name, email, phone, username"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border p-2 rounded"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border p-2 rounded">
          <option value="">All</option>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Ordered">Ordered</option>
          <option value="Rejected">Rejected</option>
        </select>
        <button onClick={load} className="bg-amber-600 hover:bg-amber-700 text-black px-4 py-2 rounded">Search</button>
        <button onClick={() => { setSearch(''); setStatus(''); }} className="bg-gray-200 text-gray-700 px-4 py-2 rounded">Clear</button>
        <button onClick={exportExcel} className="bg-green-600 text-white px-4 py-2 rounded">Export Excel</button>
      </div>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="bg-white rounded shadow overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Store</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Technician</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                {user?.role !== 'Viewer' && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {requests.map(r => (
                <tr key={r._id}>
                  <td className="px-6 py-4">{r.item_name}</td>
                  <td className="px-6 py-4">{r.quantity}</td>
                  <td className="px-6 py-4">{r.description}</td>
                  <td className="px-6 py-4">{r.store?.name || '-'}</td>
                  <td className="px-6 py-4">
                    <div className="font-medium">{r.requester?.name}</div>
                    <div className="text-xs text-gray-500">{r.requester?.email}</div>
                    <div className="text-xs text-gray-500">{r.requester?.phone || ''}</div>
                  </td>
                  <td className="px-6 py-4">{r.status}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{new Date(r.updatedAt).toLocaleString()}</td>
                  {user?.role !== 'Viewer' && (
                    <td className="px-6 py-4">
                      {r.status === 'Approved' ? (
                        <span className="text-green-600 font-semibold">Approved</span>
                      ) : r.status === 'Ordered' ? (
                        <span className="text-amber-600 font-semibold">Ordered</span>
                      ) : r.status === 'Rejected' ? (
                        <span className="text-red-600 font-semibold">Rejected</span>
                      ) : (
                        <div className="flex gap-2">
                          <button onClick={() => updateStatus(r._id, 'Approved')} className="text-green-600">Approve</button>
                          <button onClick={() => updateStatus(r._id, 'Ordered')} className="text-amber-600">Mark Ordered</button>
                          <button onClick={() => updateStatus(r._id, 'Rejected')} className="text-red-600">Reject</button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminRequests;
