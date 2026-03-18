import { useEffect, useMemo, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const TechRequest = () => {
  const { user } = useAuth();
  const [stores, setStores] = useState([]);
  const [form, setForm] = useState({ item_name: '', quantity: 1, description: '', store: '' });
  const [message, setMessage] = useState('');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [hasUpdates, setHasUpdates] = useState(false);
  const lastSeenKey = useMemo(() => `req_last_seen_${user?._id || 'anon'}`, [user]);

  useEffect(() => {
    const loadStores = async () => {
      try {
        const res = await api.get('/stores');
        setStores(res.data);
      } catch (e) {
        console.error(e);
      }
    };
    loadStores();
    const loadMine = async () => {
      try {
        const res = await api.get('/requests/mine');
        setRequests(res.data);
        const lastSeen = localStorage.getItem(lastSeenKey);
        if (lastSeen) {
          const lastSeenTime = new Date(lastSeen).getTime();
          const newest = res.data[0]?.updatedAt ? new Date(res.data[0].updatedAt).getTime() : 0;
          setHasUpdates(newest > lastSeenTime);
        } else {
          setHasUpdates(false);
        }
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };
    loadMine();
    const interval = setInterval(loadMine, 30000);
    return () => clearInterval(interval);
  }, [lastSeenKey]);

  const submit = async () => {
    if (submitting) return;
    setMessage('');
    if (!form.item_name) { setMessage('Enter item name'); return; }
    try {
      setSubmitting(true);
      await api.post('/requests', form);
      setMessage('Request submitted');
      setForm({ item_name: '', quantity: 1, description: '', store: '' });
      const res = await api.get('/requests/mine');
      setRequests(res.data);
    } catch (err) {
      setMessage(err.response?.data?.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };
  
  const markSeen = () => {
    localStorage.setItem(lastSeenKey, new Date().toISOString());
    setHasUpdates(false);
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Request Tools/Supplies</h1>
      {hasUpdates && (
        <div className="mb-4 bg-yellow-100 text-yellow-800 px-4 py-2 rounded flex justify-between items-center">
          <span>You have updates on your requests</span>
          <button onClick={markSeen} className="text-sm underline">Dismiss</button>
        </div>
      )}
      <div className="bg-white p-6 rounded shadow space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Item</label>
          <input
            type="text"
            value={form.item_name}
            onChange={(e) => setForm({ ...form, item_name: e.target.value })}
            className="mt-1 w-full border p-2 rounded"
            placeholder="e.g., Screwdriver set"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Quantity</label>
          <input
            type="number"
            min="1"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            className="mt-1 w-full border p-2 rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="mt-1 w-full border p-2 rounded"
            rows="3"
            placeholder="Any details"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Store (optional)</label>
          <select
            value={form.store}
            onChange={(e) => setForm({ ...form, store: e.target.value })}
            className="mt-1 w-full border p-2 rounded"
          >
            <option value="">Select Store</option>
            {stores.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex justify-end">
          <button
            onClick={submit}
            disabled={submitting}
            className={`text-black px-4 py-2 rounded ${submitting ? 'bg-amber-300 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700'}`}
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
        {message && <div className="text-center text-sm text-gray-600">{message}</div>}
      </div>
      
      <div className="mt-8 bg-white p-6 rounded shadow">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">My Requests</h2>
          <button onClick={markSeen} className="text-sm text-gray-600 underline">Mark all seen</button>
        </div>
        {loading ? (
          <div>Loading...</div>
        ) : requests.length === 0 ? (
          <p className="text-sm text-gray-500">No requests yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Store</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {requests.map(r => {
                  const lastSeen = localStorage.getItem(lastSeenKey);
                  const highlight = lastSeen ? new Date(r.updatedAt).getTime() > new Date(lastSeen).getTime() : false;
                  return (
                    <tr key={r._id} className={highlight ? 'bg-yellow-50' : ''}>
                      <td className="px-4 py-2">{r.item_name}</td>
                      <td className="px-4 py-2">{r.quantity}</td>
                      <td className="px-4 py-2">{r.store?.name || '-'}</td>
                      <td className="px-4 py-2">{r.status}</td>
                      <td className="px-4 py-2 text-sm text-gray-500">{new Date(r.updatedAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default TechRequest;
