import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import AssignRecipientModal from '../components/AssignRecipientModal';

const toDatetimeLocal = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

const toolLocationOptionLabel = (store, activeStoreValue) => {
  const n = String(store?.name || '').trim();
  const parentName =
    activeStoreValue && activeStoreValue !== 'all' && typeof activeStoreValue === 'object'
      ? String(activeStoreValue?.name || '').trim()
      : '';
  return parentName && n ? `${parentName} › ${n}` : n;
};

const toolLocationEditLabelFromTool = (tool) => {
  if (!tool?.locationStore) return '';
  const ls = tool.locationStore;
  const p = String(ls?.parentStore?.name || '').trim();
  const n = String(ls?.name || '').trim();
  if (p && n) return `${p} › ${n}`;
  return n;
};

const defaultForm = {
  name: '',
  type: '',
  model: '',
  serial_number: '',
  mac_address: '',
  po_number: '',
  vendor_name: '',
  registered_at: toDatetimeLocal(),
  locationStore: '',
  locationDetail: '',
  location: '',
  comment: '',
  status: 'Available'
};

const Tools = () => {
  const { user, activeStore } = useAuth();
  const [tools, setTools] = useState([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [historyModal, setHistoryModal] = useState({ open: false, toolName: '', rows: [] });
  const [editingTool, setEditingTool] = useState(null);
  const [editForm, setEditForm] = useState(defaultForm);
  const [updating, setUpdating] = useState(false);
  const [childStores, setChildStores] = useState([]);
  const [importBusy, setImportBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [locationStoreInput, setLocationStoreInput] = useState('');
  const [locationStoreMenuOpen, setLocationStoreMenuOpen] = useState(false);
  const [editLocationStoreInput, setEditLocationStoreInput] = useState('');
  const [editLocationStoreMenuOpen, setEditLocationStoreMenuOpen] = useState(false);

  const filteredToolLocations = useMemo(() => {
    const q = locationStoreInput.trim().toLowerCase();
    if (!childStores.length) return [];
    if (!q) return childStores.slice(0, 20);
    return childStores.filter((s) => {
      const label = toolLocationOptionLabel(s, activeStore).toLowerCase();
      const name = String(s.name || '').toLowerCase();
      return label.includes(q) || name.includes(q);
    }).slice(0, 25);
  }, [childStores, locationStoreInput, activeStore]);

  const filteredEditToolLocations = useMemo(() => {
    const q = editLocationStoreInput.trim().toLowerCase();
    if (!childStores.length) return [];
    if (!q) return childStores.slice(0, 20);
    return childStores.filter((s) => {
      const label = toolLocationOptionLabel(s, activeStore).toLowerCase();
      const name = String(s.name || '').toLowerCase();
      return label.includes(q) || name.includes(q);
    }).slice(0, 25);
  }, [childStores, editLocationStoreInput, activeStore]);

  const canWrite = user?.role === 'Admin' || user?.role === 'Super Admin';
  const managerLike = String(user?.role || '').toLowerCase().includes('manager');
  const canAssign = user?.role === 'Admin' || user?.role === 'Super Admin' || managerLike;
  const activeStoreId = activeStore && activeStore !== 'all' ? (activeStore._id || activeStore) : null;

  const [technicians, setTechnicians] = useState([]);
  const [assignToolModal, setAssignToolModal] = useState(null);
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [editModalTitle, setEditModalTitle] = useState('Edit Tool');

  const loadTools = async ({ q, s } = {}) => {
    try {
      setLoading(true);
      const res = await api.get('/tools', {
        params: {
          q: q || undefined,
          status: s || undefined
        }
      });
      setTools(res.data || []);
    } catch (error) {
      console.error('Error loading tools:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    loadTools({ q: debouncedSearch, s: status });
  }, [debouncedSearch, status]);

  useEffect(() => {
    if (!canAssign) {
      setTechnicians([]);
      return;
    }
    (async () => {
      try {
        const res = await api.get('/users');
        setTechnicians(Array.isArray(res.data) ? res.data : []);
      } catch (e) {
        console.error(e);
        setTechnicians([]);
      }
    })();
  }, [canAssign]);

  useEffect(() => {
    const loadStores = async () => {
      if (!activeStoreId) {
        setChildStores([]);
        return;
      }
      try {
        const params = new URLSearchParams({ parent: String(activeStoreId), page: '1', limit: '200' });
        const res = await api.get(`/stores?${params.toString()}`);
        const items = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        setChildStores(items);
      } catch (e) {
        console.error(e);
        setChildStores([]);
      }
    };
    loadStores();
  }, [activeStoreId]);

  useEffect(() => {
    if (!form.locationStore || locationStoreInput) return;
    const s = childStores.find((x) => String(x._id) === String(form.locationStore));
    if (!s) return;
    setLocationStoreInput(toolLocationOptionLabel(s, activeStore));
  }, [childStores, form.locationStore, locationStoreInput, activeStore]);

  useEffect(() => {
    if (!editForm.locationStore || editLocationStoreInput) return;
    const s = childStores.find((x) => String(x._id) === String(editForm.locationStore));
    if (!s) return;
    setEditLocationStoreInput(toolLocationOptionLabel(s, activeStore));
  }, [childStores, editForm.locationStore, editLocationStoreInput, activeStore]);

  const list = useMemo(() => tools, [tools]);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const onLocationStoreInputChange = (e) => {
    const v = e.target.value;
    setLocationStoreInput(v);
    setLocationStoreMenuOpen(true);
    setForm((prev) => {
      if (!prev.locationStore) return prev;
      const s = childStores.find((x) => String(x._id) === String(prev.locationStore));
      const label = s ? toolLocationOptionLabel(s, activeStore) : '';
      if (v === label) return prev;
      return { ...prev, locationStore: '', location: prev.location };
    });
  };

  const pickLocationStore = (s) => {
    setForm((prev) => ({ ...prev, locationStore: String(s._id), location: '' }));
    setLocationStoreInput(toolLocationOptionLabel(s, activeStore));
    setLocationStoreMenuOpen(false);
  };

  const clearLocationStorePick = () => {
    setForm((prev) => ({ ...prev, locationStore: '', location: '' }));
    setLocationStoreInput('');
    setLocationStoreMenuOpen(false);
  };

  const onEditLocationStoreInputChange = (e) => {
    const v = e.target.value;
    setEditLocationStoreInput(v);
    setEditLocationStoreMenuOpen(true);
    setEditForm((prev) => {
      if (!prev.locationStore) return prev;
      const s = childStores.find((x) => String(x._id) === String(prev.locationStore));
      const label = s ? toolLocationOptionLabel(s, activeStore) : '';
      if (v === label) return prev;
      return { ...prev, locationStore: '', location: prev.location };
    });
  };

  const pickEditLocationStore = (s) => {
    setEditForm((prev) => ({ ...prev, locationStore: String(s._id), location: '' }));
    setEditLocationStoreInput(toolLocationOptionLabel(s, activeStore));
    setEditLocationStoreMenuOpen(false);
  };

  const clearEditLocationStorePick = () => {
    setEditForm((prev) => ({ ...prev, locationStore: '', location: '' }));
    setEditLocationStoreInput('');
    setEditLocationStoreMenuOpen(false);
  };

  const onCreate = async (e) => {
    e.preventDefault();
    if (!canWrite) return;
    try {
      setSaving(true);
      const payload = {
        ...form,
        registered_at: form.registered_at ? new Date(form.registered_at).toISOString() : undefined,
        locationStore: form.locationStore || undefined
      };
      await api.post('/tools', payload);
      setForm({ ...defaultForm, registered_at: toDatetimeLocal() });
      setLocationStoreInput('');
      setLocationStoreMenuOpen(false);
      await loadTools();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to register tool');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id) => {
    if (!canWrite) return;
    if (!window.confirm('Delete this tool?')) return;
    try {
      await api.delete(`/tools/${id}`);
      await loadTools();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to delete tool');
    }
  };

  const holderDisplay = (tool) => {
    if (!tool) return '-';
    if (tool.currentHolder?.name) return tool.currentHolder.name;
    const ext = tool.externalHolder;
    if (ext?.name) return `${ext.name} (external)`;
    return '-';
  };

  const onAdminReturnTool = async (tool) => {
    if (!canAssign || !tool?._id) return;
    if (!window.confirm('Return this tool to available stock?')) return;
    try {
      await api.post(`/tools/${tool._id}/return`, { comment: 'Returned by admin' });
      await loadTools({ q: debouncedSearch, s: status });
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to return tool');
    }
  };

  const submitToolAssign = async (payload) => {
    if (!assignToolModal?._id) return;
    try {
      setAssignSubmitting(true);
      await api.post(`/tools/${assignToolModal._id}/assign`, {
        recipientType: payload.recipientType,
        technicianId: payload.recipientType === 'Technician' ? payload.technicianId : undefined,
        otherRecipient: payload.recipientType === 'Other' ? payload.otherRecipient : undefined,
        recipientEmail: payload.recipientEmail,
        recipientPhone: payload.recipientPhone,
        installationLocation: payload.installationLocation,
        needGatePass: payload.needGatePass,
        sendGatePassEmail: payload.sendGatePassEmail,
        gatePassOrigin: payload.gatePassOrigin,
        gatePassDestination: payload.gatePassDestination,
        gatePassJustification: payload.gatePassJustification,
        ticketNumber: payload.ticketNumber
      });
      setAssignToolModal(null);
      await loadTools({ q: debouncedSearch, s: status });
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to assign tool');
    } finally {
      setAssignSubmitting(false);
    }
  };

  const onEditClick = (tool, mode = 'edit') => {
    setEditModalTitle(mode === 'modify' ? 'Modify Tool' : 'Edit Tool');
    setEditingTool(tool);
    setEditLocationStoreInput(toolLocationEditLabelFromTool(tool));
    setEditLocationStoreMenuOpen(false);
    const ra = tool.registered_at ? new Date(tool.registered_at) : new Date();
    setEditForm({
      name: tool.name || '',
      type: tool.type || '',
      model: tool.model || '',
      serial_number: tool.serial_number || '',
      mac_address: tool.mac_address || '',
      po_number: tool.po_number || '',
      vendor_name: tool.vendor_name || '',
      registered_at: toDatetimeLocal(ra),
      locationStore: tool.locationStore?._id || tool.locationStore || '',
      locationDetail: tool.locationDetail || '',
      location: tool.locationStore ? '' : (tool.location || ''),
      comment: tool.comment || '',
      status: tool.status || 'Available'
    });
  };

  const onEditChange = (e) => {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
  };

  const onEditSave = async () => {
    if (!editingTool) return;
    try {
      setUpdating(true);
      const payload = {
        ...editForm,
        registered_at: editForm.registered_at ? new Date(editForm.registered_at).toISOString() : undefined,
        locationStore: editForm.locationStore || null
      };
      await api.put(`/tools/${editingTool._id}`, payload);
      setEditingTool(null);
      setEditLocationStoreInput('');
      setEditLocationStoreMenuOpen(false);
      await loadTools();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to update tool');
    } finally {
      setUpdating(false);
    }
  };

  const downloadImportTemplate = async () => {
    try {
      const res = await api.get('/tools/import/template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tools_import_template.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to download template');
    }
  };

  const exportTools = async () => {
    try {
      setExportBusy(true);
      const res = await api.get('/tools/export', {
        params: {
          q: debouncedSearch || undefined,
          status: status || undefined
        },
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tools_export.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to export');
    } finally {
      setExportBusy(false);
    }
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canWrite) return;
    try {
      setImportBusy(true);
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/tools/import', fd);
      let extra = '';
      if (Array.isArray(res.data?.errors) && res.data.errors.length) {
        const lines = res.data.errors.slice(0, 6).map((er) => `Row ${er.row}: ${er.message}`).join('\n');
        extra = `\n\n${lines}${res.data.errors.length > 6 ? '\n…' : ''}`;
      }
      alert((res.data?.message || 'Import finished') + extra);
      await loadTools();
    } catch (error) {
      alert(error.response?.data?.message || 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  const openHistory = async (tool) => {
    try {
      const res = await api.get(`/tools/${tool._id}/history`);
      setHistoryModal({
        open: true,
        toolName: tool.name,
        rows: res.data || []
      });
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to load history');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Tools</h1>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            className="border border-slate-300 rounded-lg px-3 py-2"
            placeholder="Search by name, type, serial, mac, po, vendor, comment"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="border border-slate-300 rounded-lg px-3 py-2" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="Available">Available</option>
            <option value="Issued">Issued</option>
            <option value="Maintenance">Maintenance</option>
            <option value="Retired">Retired</option>
          </select>
          <button type="button" onClick={() => loadTools({ q: debouncedSearch, s: status })} className="rounded-lg px-4 py-2 bg-slate-900 text-white hover:bg-black">Refresh</button>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              disabled={exportBusy}
              onClick={exportTools}
              className="rounded-lg px-3 py-2 bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 text-sm"
            >
              {exportBusy ? 'Export…' : 'Bulk export (.xlsx)'}
            </button>
            {canWrite && (
              <>
                <button
                  type="button"
                  onClick={downloadImportTemplate}
                  className="rounded-lg px-3 py-2 bg-slate-100 text-slate-800 hover:bg-slate-200 text-sm"
                >
                  Import template
                </button>
                <label className="rounded-lg px-3 py-2 bg-indigo-600 text-white hover:bg-indigo-700 text-sm cursor-pointer disabled:opacity-50">
                  <input type="file" accept=".xlsx,.xls" className="hidden" disabled={importBusy} onChange={onImportFile} />
                  {importBusy ? 'Import…' : 'Bulk import'}
                </label>
              </>
            )}
          </div>
        </div>
      </div>

      {canWrite && (
        <form onSubmit={onCreate} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <h2 className="font-semibold mb-3">Register Tool</h2>
          <p className="text-sm text-slate-600 mb-3">
            Link a row from{' '}
            <Link to="/stores" className="text-indigo-600 hover:underline">Locations</Link>
            {' '}under your active store. You can still type a free-text location if you do not pick a linked location.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input name="name" value={form.name} onChange={onChange} required placeholder="Tool Name" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="type" value={form.type} onChange={onChange} placeholder="Type" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="model" value={form.model} onChange={onChange} placeholder="Model" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="serial_number" value={form.serial_number} onChange={onChange} placeholder="Serial" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="mac_address" value={form.mac_address} onChange={onChange} placeholder="MAC" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="po_number" value={form.po_number} onChange={onChange} placeholder="PO Number" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="vendor_name" value={form.vendor_name} onChange={onChange} placeholder="Vendor" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="registered_at" type="datetime-local" value={form.registered_at} onChange={onChange} className="border border-slate-300 rounded-lg px-3 py-2" />
            <div className="relative min-w-0 flex gap-2 items-start">
              <div className="relative flex-1 min-w-0">
                <input
                  type="text"
                  autoComplete="off"
                  value={locationStoreInput}
                  onChange={onLocationStoreInputChange}
                  onFocus={() => setLocationStoreMenuOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setLocationStoreMenuOpen(false), 180);
                  }}
                  placeholder={
                    activeStoreId
                      ? 'Type to search locations (parent › site)…'
                      : 'Select a store in the header first'
                  }
                  disabled={!activeStoreId}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 disabled:bg-slate-50"
                />
                {locationStoreMenuOpen && activeStoreId && (
                  <ul className="absolute z-40 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg text-sm">
                    {filteredToolLocations.length === 0 ? (
                      <li className="px-3 py-2 text-slate-500">
                        {locationStoreInput.trim() ? 'No matching location.' : 'No locations under this store.'}
                      </li>
                    ) : (
                      filteredToolLocations.map((s) => (
                        <li key={s._id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left hover:bg-slate-50"
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => pickLocationStore(s)}
                          >
                            {toolLocationOptionLabel(s, activeStore)}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
              {(form.locationStore || locationStoreInput.trim()) && (
                <button
                  type="button"
                  onClick={clearLocationStorePick}
                  className="shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
            </div>
            <input
              name="locationDetail"
              value={form.locationDetail}
              onChange={onChange}
              placeholder="Shelf / bin (optional, with linked location)"
              className="border border-slate-300 rounded-lg px-3 py-2"
            />
            <input
              name="location"
              value={form.location}
              onChange={onChange}
              placeholder={form.locationStore ? '— linked location —' : 'Location (free text if not linked)'}
              className="border border-slate-300 rounded-lg px-3 py-2"
              disabled={Boolean(form.locationStore)}
            />
            <select name="status" value={form.status} onChange={onChange} className="border border-slate-300 rounded-lg px-3 py-2">
              <option value="Available">Available</option>
              <option value="Maintenance">Maintenance</option>
              <option value="Retired">Retired</option>
            </select>
          </div>
          <textarea name="comment" value={form.comment} onChange={onChange} placeholder="Comment" className="mt-3 w-full border border-slate-300 rounded-lg px-3 py-2" rows={2} />
          <div className="mt-3">
            <button type="submit" disabled={saving} className="rounded-lg px-4 py-2 bg-amber-600 text-black hover:bg-amber-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Register Tool'}
            </button>
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
              <th className="px-3 py-2 text-left">Vendor</th>
              <th className="px-3 py-2 text-left">Registered</th>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Holder</th>
              <th className="px-3 py-2 text-left">Comment</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-4 text-slate-500" colSpan={13}>Loading tools...</td></tr>
            ) : list.length === 0 ? (
              <tr><td className="px-3 py-4 text-slate-500" colSpan={13}>No tools found.</td></tr>
            ) : (
              list.map((tool) => (
                <tr key={tool._id} className="border-t">
                  <td className="px-3 py-2">{tool.name}</td>
                  <td className="px-3 py-2">{tool.type || '-'}</td>
                  <td className="px-3 py-2">{tool.model || '-'}</td>
                  <td className="px-3 py-2">{tool.serial_number || '-'}</td>
                  <td className="px-3 py-2">{tool.mac_address || '-'}</td>
                  <td className="px-3 py-2">{tool.po_number || '-'}</td>
                  <td className="px-3 py-2">{tool.vendor_name || '-'}</td>
                  <td className="px-3 py-2">{tool.registered_at ? new Date(tool.registered_at).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2">{formatToolLocation(tool)}</td>
                  <td className="px-3 py-2">{tool.status}</td>
                  <td className="px-3 py-2">{holderDisplay(tool)}</td>
                  <td className="px-3 py-2">{tool.comment || '-'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <button type="button" onClick={() => openHistory(tool)} className="text-indigo-600 hover:underline">History</button>
                      {canWrite && (
                        <button type="button" onClick={() => onEditClick(tool, 'edit')} className="text-amber-600 hover:underline">Edit</button>
                      )}
                      {canWrite && (
                        <button type="button" onClick={() => onEditClick(tool, 'modify')} className="text-amber-800 hover:underline">Modify</button>
                      )}
                      {canAssign && tool.status === 'Available' && (
                        <button type="button" onClick={() => setAssignToolModal(tool)} className="text-emerald-700 hover:underline">Assign</button>
                      )}
                      {canAssign && tool.status === 'Issued' && (
                        <button type="button" onClick={() => onAdminReturnTool(tool)} className="text-slate-700 hover:underline">Return</button>
                      )}
                      {canWrite && <button type="button" onClick={() => onDelete(tool._id)} className="text-red-600 hover:underline">Delete</button>}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AssignRecipientModal
        open={Boolean(assignToolModal)}
        onClose={() => {
          if (!assignSubmitting) setAssignToolModal(null);
        }}
        title="Assign Tool"
        resourceLine={
          assignToolModal
            ? `Assigning: ${assignToolModal.name} (${assignToolModal.serial_number || 'no serial'})`
            : ''
        }
        technicians={technicians}
        showAssignQuantity={false}
        maxQuantity={1}
        defaultQuantity={1}
        defaultInstallationLocation={assignToolModal?.location || ''}
        submitting={assignSubmitting}
        onSubmit={submitToolAssign}
      />

      {historyModal.open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold">Tool History - {historyModal.toolName}</h3>
              <button onClick={() => setHistoryModal({ open: false, toolName: '', rows: [] })} className="text-slate-500 hover:text-slate-800">Close</button>
            </div>
            <div className="p-4 space-y-2">
              {historyModal.rows.length === 0 ? (
                <p className="text-sm text-slate-500">No history found.</p>
              ) : historyModal.rows.map((h, idx) => (
                <div key={`${h.createdAt}-${idx}`} className="border border-slate-200 rounded-lg p-3 text-sm">
                  <div className="font-medium">{h.action}</div>
                  <div className="text-slate-600">By: {h.actorName || '-'}</div>
                  <div className="text-slate-600">User: {h.targetUserName || '-'}</div>
                  <div className="text-slate-600">Note: {h.note || '-'}</div>
                  <div className="text-slate-500 text-xs">{new Date(h.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {editingTool && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-2xl w-full">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold">{editModalTitle}</h3>
              <button
                type="button"
                onClick={() => {
                  setEditingTool(null);
                  setEditLocationStoreInput('');
                  setEditLocationStoreMenuOpen(false);
                }}
                className="text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input name="name" value={editForm.name} onChange={onEditChange} placeholder="Tool Name" className="border border-slate-300 rounded-lg px-3 py-2" />
                <input name="type" value={editForm.type} onChange={onEditChange} placeholder="Type" className="border border-slate-300 rounded-lg px-3 py-2" />
                <input name="model" value={editForm.model} onChange={onEditChange} placeholder="Model" className="border border-slate-300 rounded-lg px-3 py-2" />
                <input name="serial_number" value={editForm.serial_number} onChange={onEditChange} placeholder="Serial" className="border border-slate-300 rounded-lg px-3 py-2" />
                <input name="mac_address" value={editForm.mac_address} onChange={onEditChange} placeholder="MAC" className="border border-slate-300 rounded-lg px-3 py-2" />
                <input name="po_number" value={editForm.po_number} onChange={onEditChange} placeholder="PO Number" className="border border-slate-300 rounded-lg px-3 py-2" />
                <input name="vendor_name" value={editForm.vendor_name} onChange={onEditChange} placeholder="Vendor" className="border border-slate-300 rounded-lg px-3 py-2" />
                <input name="registered_at" type="datetime-local" value={editForm.registered_at} onChange={onEditChange} className="border border-slate-300 rounded-lg px-3 py-2" />
                <div className="relative min-w-0 flex gap-2 items-start md:col-span-2">
                  <div className="relative flex-1 min-w-0">
                    <input
                      type="text"
                      autoComplete="off"
                      value={editLocationStoreInput}
                      onChange={onEditLocationStoreInputChange}
                      onFocus={() => setEditLocationStoreMenuOpen(true)}
                      onBlur={() => {
                        window.setTimeout(() => setEditLocationStoreMenuOpen(false), 180);
                      }}
                      placeholder={
                        activeStoreId
                          ? 'Type to search locations (parent › site)…'
                          : 'Select a store in the header first'
                      }
                      disabled={!activeStoreId}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 disabled:bg-slate-50"
                    />
                    {editLocationStoreMenuOpen && activeStoreId && (
                      <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg text-sm">
                        {filteredEditToolLocations.length === 0 ? (
                          <li className="px-3 py-2 text-slate-500">
                            {editLocationStoreInput.trim() ? 'No matching location.' : 'No locations under this store.'}
                          </li>
                        ) : (
                          filteredEditToolLocations.map((s) => (
                            <li key={s._id}>
                              <button
                                type="button"
                                className="w-full px-3 py-2 text-left hover:bg-slate-50"
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={() => pickEditLocationStore(s)}
                              >
                                {toolLocationOptionLabel(s, activeStore)}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                  {(editForm.locationStore || editLocationStoreInput.trim()) && (
                    <button
                      type="button"
                      onClick={clearEditLocationStorePick}
                      className="shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <input name="locationDetail" value={editForm.locationDetail} onChange={onEditChange} placeholder="Shelf / bin (optional)" className="border border-slate-300 rounded-lg px-3 py-2" />
                <input
                  name="location"
                  value={editForm.location}
                  onChange={onEditChange}
                  placeholder={editForm.locationStore ? '— linked —' : 'Location (free text)'}
                  className="border border-slate-300 rounded-lg px-3 py-2"
                  disabled={Boolean(editForm.locationStore)}
                />
                <select name="status" value={editForm.status} onChange={onEditChange} className="border border-slate-300 rounded-lg px-3 py-2">
                  <option value="Available">Available</option>
                  <option value="Issued">Issued</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Retired">Retired</option>
                </select>
              </div>
              <textarea name="comment" value={editForm.comment} onChange={onEditChange} placeholder="Comment" className="mt-3 w-full border border-slate-300 rounded-lg px-3 py-2" rows={3} />
            </div>
            <div className="px-4 py-3 border-t flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingTool(null);
                  setEditLocationStoreInput('');
                  setEditLocationStoreMenuOpen(false);
                }}
                className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button onClick={onEditSave} disabled={updating} className="px-4 py-2 rounded-lg bg-amber-600 text-black hover:bg-amber-700 disabled:opacity-50">
                {updating ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tools;

