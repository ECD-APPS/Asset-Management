import { useEffect, useMemo, useState } from 'react';
import api from '../api/axios';

const PpmHistory = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await api.get('/ppm');
        setTasks(Array.isArray(res.data) ? res.data : []);
      } catch (error) {
        alert(error.response?.data?.message || 'Failed to load PPM history');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const entries = useMemo(() => {
    const out = [];
    for (const t of tasks) {
      for (const h of (t.history || [])) {
        out.push({
          id: `${t._id}-${h.at || h.date || ''}-${h.action || ''}`,
          at: h.at || h.date || t.updatedAt,
          action: h.action || '-',
          user: h.user || '-',
          details: h.details || '',
          uniqueId: t.asset?.uniqueId || '-',
          abs_code: t.asset?.abs_code || '-',
          ip: t.asset?.ip_address || '-',
          model: t.asset?.model_number || t.asset?.name || '-'
        });
      }
    }
    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const keyword = q.trim().toLowerCase();
    if (!keyword) return out;
    return out.filter((r) =>
      [r.action, r.user, r.details, r.uniqueId, r.abs_code, r.ip, r.model]
        .map((v) => String(v || '').toLowerCase()).join(' ').includes(keyword)
    );
  }, [tasks, q]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">PPM History</h1>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search history by UID, ABS, IP, model, action, user..."
        className="w-full md:w-[520px] border rounded-lg px-3 py-2 text-sm"
      />
      <div className="bg-white border rounded-xl shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-left">Unique ID</th>
              <th className="px-3 py-2 text-left">ABS Code</th>
              <th className="px-3 py-2 text-left">IP</th>
              <th className="px-3 py-2 text-left">Model/Camera</th>
              <th className="px-3 py-2 text-left">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-4 text-slate-500">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-4 text-slate-500">No PPM history found.</td></tr>
            ) : entries.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">{row.at ? new Date(row.at).toLocaleString() : '-'}</td>
                <td className="px-3 py-2">{row.action}</td>
                <td className="px-3 py-2">{row.user}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.uniqueId}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.abs_code}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.ip}</td>
                <td className="px-3 py-2">{row.model}</td>
                <td className="px-3 py-2">{row.details || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PpmHistory;
