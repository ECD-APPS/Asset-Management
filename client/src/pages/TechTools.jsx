import { useEffect, useMemo, useState } from 'react';
import api from '../api/axios';

const TechTools = () => {
  const [tools, setTools] = useState([]);
  const [mine, setMine] = useState([]);
  const [consumables, setConsumables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toolNameQuery, setToolNameQuery] = useState('');
  const [consumableNameQuery, setConsumableNameQuery] = useState('');
  const [note, setNote] = useState('');
  const [consumeQty, setConsumeQty] = useState({});

  const load = async () => {
    try {
      setLoading(true);
      const [allRes, myRes, consumablesRes] = await Promise.all([
        api.get('/tools'),
        api.get('/tools', { params: { mine: true } }),
        api.get('/consumables')
      ]);
      setTools(allRes.data || []);
      setMine(myRes.data || []);
      setConsumables(consumablesRes.data || []);
    } catch (error) {
      console.error('Error loading technician tools:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const available = useMemo(() => {
    const q = toolNameQuery.trim().toLowerCase();
    return (tools || [])
      .filter((t) => t.status === 'Available')
      .filter((t) => {
        if (!q) return true;
        return String(t.name || '').toLowerCase().includes(q);
      });
  }, [tools, toolNameQuery]);

  const myIssued = useMemo(() => mine.filter((t) => t.status === 'Issued'), [mine]);
  const filteredConsumables = useMemo(() => {
    const q = consumableNameQuery.trim().toLowerCase();
    return (consumables || []).filter((c) => {
      if (!q) return true;
      return String(c.name || '').toLowerCase().includes(q);
    });
  }, [consumables, consumableNameQuery]);

  const issueTool = async (toolId) => {
    try {
      await api.post(`/tools/${toolId}/issue`, { comment: note });
      setNote('');
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to get tool');
    }
  };

  const returnTool = async (toolId) => {
    try {
      await api.post(`/tools/${toolId}/return`, { comment: note });
      setNote('');
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to return tool');
    }
  };

  const consumeItem = async (id) => {
    const qty = Math.max(Number(consumeQty[id] || 1), 1);
    try {
      await api.post(`/consumables/${id}/consume`, { quantity: qty, comment: note });
      setConsumeQty((prev) => ({ ...prev, [id]: 1 }));
      setNote('');
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to consume item');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Tools Panel</h1>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          value={toolNameQuery}
          onChange={(e) => setToolNameQuery(e.target.value)}
          placeholder="Search tools by name"
          className="border border-slate-300 rounded-lg px-3 py-2"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional comment for get/return"
          className="border border-slate-300 rounded-lg px-3 py-2"
        />
        <input
          value={consumableNameQuery}
          onChange={(e) => setConsumableNameQuery(e.target.value)}
          placeholder="Search consumables by name"
          className="border border-slate-300 rounded-lg px-3 py-2"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <div className="px-4 py-3 border-b font-semibold">Available Tools</div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-left">Serial</th>
              <th className="px-3 py-2 text-left">MAC</th>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">PO</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-4 text-slate-500">Loading...</td></tr>
            ) : available.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-4 text-slate-500">No available tools.</td></tr>
            ) : available.map((tool) => (
              <tr key={tool._id} className="border-t">
                <td className="px-3 py-2">{tool.name}</td>
                <td className="px-3 py-2">{tool.type || '-'}</td>
                <td className="px-3 py-2">{tool.model || '-'}</td>
                <td className="px-3 py-2">{tool.serial_number || '-'}</td>
                <td className="px-3 py-2">{tool.mac_address || '-'}</td>
                <td className="px-3 py-2">{tool.location || '-'}</td>
                <td className="px-3 py-2">{tool.po_number || '-'}</td>
                <td className="px-3 py-2">
                  <button onClick={() => issueTool(tool._id)} className="px-3 py-1 rounded bg-amber-600 text-black hover:bg-amber-700">
                    Get Tool
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <div className="px-4 py-3 border-b font-semibold">My Issued Tools</div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-left">Serial</th>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-4 text-slate-500">Loading...</td></tr>
            ) : myIssued.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-4 text-slate-500">No issued tools.</td></tr>
            ) : myIssued.map((tool) => (
              <tr key={tool._id} className="border-t">
                <td className="px-3 py-2">{tool.name}</td>
                <td className="px-3 py-2">{tool.type || '-'}</td>
                <td className="px-3 py-2">{tool.model || '-'}</td>
                <td className="px-3 py-2">{tool.serial_number || '-'}</td>
                <td className="px-3 py-2">{tool.location || '-'}</td>
                <td className="px-3 py-2">
                  <button onClick={() => returnTool(tool._id)} className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700">
                    Return Tool
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <div className="px-4 py-3 border-b font-semibold">Consumables</div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-left">Serial</th>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">Available Qty</th>
              <th className="px-3 py-2 text-left">Use Qty</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-4 text-slate-500">Loading...</td></tr>
            ) : filteredConsumables.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-4 text-slate-500">No consumables found.</td></tr>
            ) : filteredConsumables.map((item) => (
              <tr key={item._id} className="border-t">
                <td className="px-3 py-2">{item.name}</td>
                <td className="px-3 py-2">{item.type || '-'}</td>
                <td className="px-3 py-2">{item.model || '-'}</td>
                <td className="px-3 py-2">{item.serial_number || '-'}</td>
                <td className="px-3 py-2">{item.location || '-'}</td>
                <td className="px-3 py-2">{item.quantity}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="1"
                    max={Math.max(Number(item.quantity || 0), 1)}
                    value={consumeQty[item._id] || 1}
                    onChange={(e) => setConsumeQty((prev) => ({ ...prev, [item._id]: e.target.value }))}
                    className="w-20 border border-slate-300 rounded-lg px-2 py-1"
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => consumeItem(item._id)}
                    disabled={Number(item.quantity || 0) <= 0}
                    className={`px-3 py-1 rounded ${Number(item.quantity || 0) <= 0 ? 'bg-slate-200 text-slate-500' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                  >
                    Consume
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TechTools;

