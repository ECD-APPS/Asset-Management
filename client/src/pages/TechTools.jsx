import { useEffect, useMemo, useState } from 'react';
import api from '../api/axios';

const toDisplay = (value, fallback = '-') => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') {
    if (value.value != null && value.value !== '') return String(value.value);
    if (value.label != null && value.label !== '') return String(value.label);
    return fallback;
  }
  return String(value);
};

const toNumber = (value, fallback = 0) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'object' && value?.value != null) {
    const parsed = Number(value.value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const consumableAtOrBelowMin = (item) => {
  const min = toNumber(item?.min_quantity, 0);
  const qty = toNumber(item?.quantity, 0);
  return min > 0 && qty <= min;
};

const formatToolLocation = (tool) => {
  if (!tool) return '-';
  if (tool.locationStore) {
    const p = tool.locationStore?.parentStore?.name;
    const n = tool.locationStore?.name;
    const chain = p && n ? `${p} › ${n}` : (n || p || '');
    const d = tool.locationDetail ? String(tool.locationDetail).trim() : '';
    return [chain, d].filter(Boolean).join(' — ') || tool.location || '-';
  }
  return tool.location || '-';
};

const TechTools = () => {
  const [tools, setTools] = useState([]);
  const [mine, setMine] = useState([]);
  const [consumables, setConsumables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toolNameQuery, setToolNameQuery] = useState('');
  const [consumableNameQuery, setConsumableNameQuery] = useState('');
  const [note, setNote] = useState('');
  const [consumeQty, setConsumeQty] = useState({});
  const [actionBusy, setActionBusy] = useState({});

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
    if (actionBusy[`issue-${toolId}`]) return;
    try {
      setActionBusy((prev) => ({ ...prev, [`issue-${toolId}`]: true }));
      await api.post(`/tools/${toolId}/issue`, { comment: note });
      setNote('');
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to get tool');
    } finally {
      setActionBusy((prev) => ({ ...prev, [`issue-${toolId}`]: false }));
    }
  };

  const returnTool = async (toolId) => {
    if (actionBusy[`return-${toolId}`]) return;
    try {
      setActionBusy((prev) => ({ ...prev, [`return-${toolId}`]: true }));
      await api.post(`/tools/${toolId}/return`, { comment: note });
      setNote('');
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to return tool');
    } finally {
      setActionBusy((prev) => ({ ...prev, [`return-${toolId}`]: false }));
    }
  };

  const consumeItem = async (id) => {
    if (actionBusy[`consume-${id}`]) return;
    const qty = Math.max(Number(consumeQty[id] || 1), 1);
    try {
      setActionBusy((prev) => ({ ...prev, [`consume-${id}`]: true }));
      await api.post(`/consumables/${id}/consume`, { quantity: qty, comment: note });
      setConsumeQty((prev) => ({ ...prev, [id]: 1 }));
      setNote('');
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to consume item');
    } finally {
      setActionBusy((prev) => ({ ...prev, [`consume-${id}`]: false }));
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
                <td className="px-3 py-2">{toDisplay(tool.name)}</td>
                <td className="px-3 py-2">{toDisplay(tool.type)}</td>
                <td className="px-3 py-2">{toDisplay(tool.model)}</td>
                <td className="px-3 py-2">{toDisplay(tool.serial_number)}</td>
                <td className="px-3 py-2">{toDisplay(tool.mac_address)}</td>
                <td className="px-3 py-2">{toDisplay(formatToolLocation(tool))}</td>
                <td className="px-3 py-2">{toDisplay(tool.po_number)}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => issueTool(tool._id)}
                    disabled={Boolean(actionBusy[`issue-${tool._id}`])}
                    className="px-3 py-1 rounded bg-amber-600 text-black hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionBusy[`issue-${tool._id}`] ? 'Getting...' : 'Get Tool'}
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
                <td className="px-3 py-2">{toDisplay(tool.name)}</td>
                <td className="px-3 py-2">{toDisplay(tool.type)}</td>
                <td className="px-3 py-2">{toDisplay(tool.model)}</td>
                <td className="px-3 py-2">{toDisplay(tool.serial_number)}</td>
                <td className="px-3 py-2">{toDisplay(formatToolLocation(tool))}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => returnTool(tool._id)}
                    disabled={Boolean(actionBusy[`return-${tool._id}`])}
                    className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionBusy[`return-${tool._id}`] ? 'Returning...' : 'Return Tool'}
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
            ) : filteredConsumables.map((item) => {
              const consumableLow = consumableAtOrBelowMin(item);
              return (
              <tr key={item._id} className="border-t">
                <td className="px-3 py-2">{toDisplay(item.name)}</td>
                <td className="px-3 py-2">{toDisplay(item.type)}</td>
                <td className="px-3 py-2">{toDisplay(item.model)}</td>
                <td className="px-3 py-2">{toDisplay(item.serial_number)}</td>
                <td className="px-3 py-2">{toDisplay(item.location)}</td>
                <td
                  className={`px-3 py-2 tabular-nums ${consumableLow ? 'text-red-600 font-semibold' : ''}`}
                  title={consumableLow ? 'At or below minimum quantity' : undefined}
                >
                  {toNumber(item.quantity, 0)}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="1"
                    max={Math.max(toNumber(item.quantity, 0), 1)}
                    value={consumeQty[item._id] || 1}
                    onChange={(e) => setConsumeQty((prev) => ({ ...prev, [item._id]: e.target.value }))}
                    className="w-20 border border-slate-300 rounded-lg px-2 py-1"
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => consumeItem(item._id)}
                    disabled={toNumber(item.quantity, 0) <= 0 || Boolean(actionBusy[`consume-${item._id}`])}
                    className={`px-3 py-1 rounded ${(toNumber(item.quantity, 0) <= 0 || actionBusy[`consume-${item._id}`]) ? 'bg-slate-200 text-slate-500' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                  >
                    {actionBusy[`consume-${item._id}`] ? 'Consuming...' : 'Consume'}
                  </button>
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TechTools;

