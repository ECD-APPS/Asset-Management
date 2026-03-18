import { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const formDefaults = {
  name: '',
  type: '',
  model: '',
  serial_number: '',
  mac_address: '',
  po_number: '',
  location: '',
  comment: '',
  quantity: 0,
  min_quantity: 0
};

const asText = (value, fallback = '-') => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'value')) {
      return String(value.value ?? fallback);
    }
    return fallback;
  }
  const s = String(value).trim();
  return s || fallback;
};

const asNumber = (value, fallback = 0) => {
  if (typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, 'value')) {
    const n = Number(value.value);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const Consumables = () => {
  const { user } = useAuth();
  const canWrite = user?.role === 'Admin' || user?.role === 'Super Admin';
  const [rows, setRows] = useState([]);
  const [searchName, setSearchName] = useState('');
  const [debouncedSearchName, setDebouncedSearchName] = useState('');
  const [form, setForm] = useState(formDefaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [historyModal, setHistoryModal] = useState({ open: false, name: '', rows: [] });

  const load = async (nameFilter = debouncedSearchName) => {
    try {
      setLoading(true);
      const res = await api.get('/consumables', { params: { name: nameFilter || undefined } });
      setRows(res.data || []);
    } catch (error) {
      console.error('Failed to load consumables:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchName(searchName), 300);
    return () => clearTimeout(t);
  }, [searchName]);

  useEffect(() => {
    load(debouncedSearchName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchName]);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!canWrite) return;
    try {
      setSaving(true);
      if (editing?._id) {
        await api.put(`/consumables/${editing._id}`, form);
      } else {
        await api.post('/consumables', form);
      }
      setForm(formDefaults);
      setEditing(null);
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to save consumable');
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (row) => {
    setEditing(row);
    setForm({
      name: asText(row.name, ''),
      type: asText(row.type, ''),
      model: asText(row.model, ''),
      serial_number: asText(row.serial_number, ''),
      mac_address: asText(row.mac_address, ''),
      po_number: asText(row.po_number, ''),
      location: asText(row.location, ''),
      comment: asText(row.comment, ''),
      quantity: asNumber(row.quantity, 0),
      min_quantity: asNumber(row.min_quantity, 0)
    });
  };

  const onDelete = async (id) => {
    if (!canWrite) return;
    if (!window.confirm('Delete this consumable?')) return;
    try {
      await api.delete(`/consumables/${id}`);
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to delete consumable');
    }
  };

  const showHistory = async (row) => {
    try {
      const res = await api.get(`/consumables/${row._id}/history`);
      setHistoryModal({ open: true, name: row.name, rows: res.data || [] });
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to load history');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Consumables</h1>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <input
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          placeholder="Search consumables by name"
          className="w-full border border-slate-300 rounded-lg px-3 py-2"
        />
      </div>

      {canWrite && (
        <form onSubmit={onSubmit} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <h2 className="font-semibold mb-3">{editing ? 'Edit Consumable' : 'Register Consumable'}</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input name="name" value={form.name} onChange={onChange} required placeholder="Name (e.g. Electric Tape)" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="type" value={form.type} onChange={onChange} placeholder="Type" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="model" value={form.model} onChange={onChange} placeholder="Model" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="serial_number" value={form.serial_number} onChange={onChange} placeholder="Serial Number" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="mac_address" value={form.mac_address} onChange={onChange} placeholder="MAC" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="po_number" value={form.po_number} onChange={onChange} placeholder="PO Number" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="location" value={form.location} onChange={onChange} placeholder="Location" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input type="number" min="0" name="quantity" value={form.quantity} onChange={onChange} placeholder="Quantity" className="border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <input type="number" min="0" name="min_quantity" value={form.min_quantity} onChange={onChange} placeholder="Minimum Quantity Alert" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="comment" value={form.comment} onChange={onChange} placeholder="Comment" className="border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={saving} className="rounded-lg px-4 py-2 bg-amber-600 text-black hover:bg-amber-700 disabled:opacity-50">
              {saving ? 'Saving...' : editing ? 'Update Consumable' : 'Register Consumable'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => { setEditing(null); setForm(formDefaults); }}
                className="rounded-lg px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-left">Serial</th>
              <th className="px-3 py-2 text-left">MAC</th>
              <th className="px-3 py-2 text-left">PO</th>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">Qty</th>
              <th className="px-3 py-2 text-left">Min Qty</th>
              <th className="px-3 py-2 text-left">Comment</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-4 text-slate-500" colSpan={11}>Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-3 py-4 text-slate-500" colSpan={11}>No consumables found.</td></tr>
            ) : rows.map((row) => (
              <tr key={row._id} className="border-t">
                <td className="px-3 py-2">{asText(row.name)}</td>
                <td className="px-3 py-2">{asText(row.type)}</td>
                <td className="px-3 py-2">{asText(row.model)}</td>
                <td className="px-3 py-2">{asText(row.serial_number)}</td>
                <td className="px-3 py-2">{asText(row.mac_address)}</td>
                <td className="px-3 py-2">{asText(row.po_number)}</td>
                <td className="px-3 py-2">{asText(row.location)}</td>
                <td className="px-3 py-2">{asNumber(row.quantity, 0)}</td>
                <td className="px-3 py-2">{asNumber(row.min_quantity, 0)}</td>
                <td className="px-3 py-2">{asText(row.comment)}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-3">
                    <button onClick={() => showHistory(row)} className="text-indigo-600 hover:underline">History</button>
                    {canWrite && <button onClick={() => onEdit(row)} className="text-amber-600 hover:underline">Edit</button>}
                    {canWrite && <button onClick={() => onDelete(row._id)} className="text-red-600 hover:underline">Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {historyModal.open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold">Consumable History - {historyModal.name}</h3>
              <button onClick={() => setHistoryModal({ open: false, name: '', rows: [] })} className="text-slate-500 hover:text-slate-800">Close</button>
            </div>
            <div className="p-4 space-y-2">
              {(historyModal.rows || []).map((h, idx) => (
                <div key={`${h.createdAt}-${idx}`} className="border border-slate-200 rounded-lg p-3 text-sm">
                  <div className="font-medium">{asText(h.action)}</div>
                  <div className="text-slate-600">By: {asText(h.actorName)}</div>
                  <div className="text-slate-600">Quantity: {asNumber(h.quantity, 0)}</div>
                  <div className="text-slate-600">Note: {asText(h.note)}</div>
                  <div className="text-slate-500 text-xs">{new Date(h.createdAt).toLocaleString()}</div>
                </div>
              ))}
              {(historyModal.rows || []).length === 0 && <p className="text-sm text-slate-500">No history found.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Consumables;

