import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import AssignRecipientModal from '../components/AssignRecipientModal';

const defaultReceiptDatetimeLocal = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toLocalDatetimeValue = (d) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
};

const formDefaults = {
  name: '',
  part_number: '',
  type: '',
  compatible_models: '',
  location: '',
  comment: '',
  quantity: 0,
  min_quantity: 0,
  vendor: '',
  purchaseOrder: '',
  receiptReceivedAt: '',
  receiptLocationStore: '',
  receiptLocationDetail: '',
  receiptLocation: ''
};

const buildInitialForm = () => ({
  ...formDefaults,
  receiptReceivedAt: defaultReceiptDatetimeLocal()
});

const emptyHarvestLine = () => ({
  name: '',
  part_number: '',
  quantity: 1,
  type: '',
  compatible_models: '',
  location: '',
  note: ''
});

/** Store hierarchy + site (matches Assets “Store & location” when populate includes parentStore). */
const assetStoreLocationLine = (a) => {
  const parent = String(a?.store?.parentStore?.name || '').trim();
  const storeName = String(a?.store?.name || '').trim();
  const chain = (parent && storeName) ? `${parent} › ${storeName}` : (storeName || parent);
  const loc = String(a?.location || '').trim();
  if (chain && loc) return `${chain} · ${loc}`;
  return chain || loc || '';
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

const unwrapValueLayers = (v, maxDepth = 12) => {
  let x = v;
  let d = 0;
  while (
    x != null &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    Object.prototype.hasOwnProperty.call(x, 'value') &&
    d < maxDepth
  ) {
    x = x.value;
    d += 1;
  }
  return x;
};

const asNumber = (value, fallback = 0) => {
  const x = unwrapValueLayers(value);
  if (typeof x === 'number') return Number.isFinite(x) ? x : fallback;
  if (x === null || x === undefined || x === '') return fallback;
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
};

const isAtOrBelowMinQty = (row) => {
  const min = asNumber(row?.min_quantity, 0);
  const qty = asNumber(row?.quantity, 0);
  return min > 0 && qty <= min;
};

const formatReceiptWhere = (row) => {
  if (!row) return '—';
  if (row.receiptLocationStore) {
    const p = row.receiptLocationStore?.parentStore?.name;
    const n = row.receiptLocationStore?.name;
    const chain = p && n ? `${p} › ${n}` : (n || p || '');
    const d = row.receiptLocationDetail ? String(row.receiptLocationDetail).trim() : '';
    return [chain, d].filter(Boolean).join(' — ') || asText(row.receiptLocation, '—');
  }
  return asText(row.receiptLocation, '—');
};

/** Child location row + active main store (parent) for combobox labels. */
const receiptLocationOptionLabel = (store, activeStoreValue) => {
  const n = String(store?.name || '').trim();
  const parentName =
    activeStoreValue && activeStoreValue !== 'all' && typeof activeStoreValue === 'object'
      ? String(activeStoreValue?.name || '').trim()
      : '';
  return parentName && n ? `${parentName} › ${n}` : n;
};

const receiptLocationEditInputValue = (row) => {
  if (!row?.receiptLocationStore) return '';
  const rs = row.receiptLocationStore;
  const p = String(rs?.parentStore?.name || '').trim();
  const n = String(rs?.name || '').trim();
  if (p && n) return `${p} › ${n}`;
  return n || '';
};

const SpareParts = () => {
  const { user, activeStore } = useAuth();
  const canManage = user?.role === 'Admin' || user?.role === 'Super Admin';
  const managerLike = String(user?.role || '').toLowerCase().includes('manager');
  const canAssignSpare = canManage || managerLike;
  const canIssue = canManage || user?.role === 'Technician';
  const activeStoreId = activeStore && activeStore !== 'all' ? (activeStore._id || activeStore) : null;

  const [rows, setRows] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [form, setForm] = useState(buildInitialForm);
  const [vendors, setVendors] = useState([]);
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [historyModal, setHistoryModal] = useState({ open: false, name: '', rows: [] });

  const [faultyAssets, setFaultyAssets] = useState([]);
  const [harvestAssetId, setHarvestAssetId] = useState('');
  const [harvestTicket, setHarvestTicket] = useState('');
  const [harvestLines, setHarvestLines] = useState([emptyHarvestLine()]);
  const [harvesting, setHarvesting] = useState(false);

  const [issueModal, setIssueModal] = useState({
    open: false,
    row: null,
    quantity: 1,
    ticketNumber: '',
    note: '',
    targetAssetId: '',
    installationLocation: ''
  });
  const [issueTargetAssets, setIssueTargetAssets] = useState([]);
  const [issuing, setIssuing] = useState(false);

  const [restockModal, setRestockModal] = useState({
    open: false,
    row: null,
    quantity: 1,
    note: ''
  });
  const [restocking, setRestocking] = useState(false);
  const [childStores, setChildStores] = useState([]);
  const [importBusy, setImportBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [spareFormTitle, setSpareFormTitle] = useState('Register spare part (purchased / new stock)');
  const [technicians, setTechnicians] = useState([]);
  const [assignPartModal, setAssignPartModal] = useState(null);
  const [assignSpareSubmitting, setAssignSpareSubmitting] = useState(false);
  const [receiptLocationInput, setReceiptLocationInput] = useState('');
  const [receiptLocationMenuOpen, setReceiptLocationMenuOpen] = useState(false);

  const filteredReceiptStores = useMemo(() => {
    const q = receiptLocationInput.trim().toLowerCase();
    if (!childStores.length) return [];
    if (!q) return childStores.slice(0, 20);
    return childStores.filter((s) => {
      const label = receiptLocationOptionLabel(s, activeStore).toLowerCase();
      const name = String(s.name || '').toLowerCase();
      return label.includes(q) || name.includes(q);
    }).slice(0, 25);
  }, [childStores, receiptLocationInput, activeStore]);

  const filteredPos = useMemo(() => {
    if (!form.vendor) return pos;
    return pos.filter((p) => String(p.vendor?._id || p.vendor) === String(form.vendor));
  }, [pos, form.vendor]);

  const loadPurchaseRefs = useCallback(async () => {
    if (!canManage) return;
    try {
      const [vRes, pRes] = await Promise.all([
        api.get('/vendors'),
        api.get('/purchase-orders')
      ]);
      setVendors(Array.isArray(vRes.data) ? vRes.data : []);
      setPos(Array.isArray(pRes.data) ? pRes.data : []);
    } catch (error) {
      console.error('Failed to load vendors / purchase orders:', error);
      setVendors([]);
      setPos([]);
    }
  }, [canManage]);

  const load = useCallback(async (q = debouncedQ) => {
    try {
      setLoading(true);
      const res = await api.get('/spare-parts', { params: { q: q || undefined } });
      setRows(res.data || []);
    } catch (error) {
      console.error('Failed to load spare parts:', error);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ]);

  const loadFaultyAssets = useCallback(async () => {
    if (!canManage) return;
    try {
      const res = await api.get('/assets', {
        params: {
          condition: 'Faulty',
          page: 1,
          limit: 150
        }
      });
      const items = res.data?.items || res.data || [];
      setFaultyAssets(Array.isArray(items) ? items : []);
    } catch (error) {
      console.error('Failed to load faulty assets:', error);
      setFaultyAssets([]);
    }
  }, [canManage]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ), 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  useEffect(() => {
    load(debouncedQ);
  }, [debouncedQ, load]);

  useEffect(() => {
    loadFaultyAssets();
  }, [loadFaultyAssets]);

  useEffect(() => {
    loadPurchaseRefs();
  }, [loadPurchaseRefs]);

  useEffect(() => {
    const loadStores = async () => {
      if (!activeStoreId || !canManage) {
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
  }, [activeStoreId, canManage]);

  useEffect(() => {
    if (!canAssignSpare) {
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
  }, [canAssignSpare]);

  useEffect(() => {
    if (!form.receiptLocationStore || receiptLocationInput) return;
    const s = childStores.find((x) => String(x._id) === String(form.receiptLocationStore));
    if (!s) return;
    setReceiptLocationInput(receiptLocationOptionLabel(s, activeStore));
  }, [childStores, form.receiptLocationStore, receiptLocationInput, activeStore]);

  useEffect(() => {
    if (!issueModal.open || !canIssue) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/assets', {
          params: { light: '1', page: 1, limit: 100, disposed: 'false' }
        });
        if (cancelled) return;
        const items = res.data?.items || [];
        setIssueTargetAssets(Array.isArray(items) ? items : []);
      } catch {
        if (!cancelled) setIssueTargetAssets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [issueModal.open, canIssue]);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const onReceiptLocationInputChange = (e) => {
    const v = e.target.value;
    setReceiptLocationInput(v);
    setReceiptLocationMenuOpen(true);
    setForm((prev) => {
      if (!prev.receiptLocationStore) return prev;
      const s = childStores.find((x) => String(x._id) === String(prev.receiptLocationStore));
      const label = s ? receiptLocationOptionLabel(s, activeStore) : '';
      if (v === label) return prev;
      return { ...prev, receiptLocationStore: '' };
    });
  };

  const pickReceiptLocationStore = (s) => {
    setForm((prev) => ({ ...prev, receiptLocationStore: String(s._id), receiptLocation: '' }));
    setReceiptLocationInput(receiptLocationOptionLabel(s, activeStore));
    setReceiptLocationMenuOpen(false);
  };

  const clearReceiptLocationPick = () => {
    setForm((prev) => ({ ...prev, receiptLocationStore: '' }));
    setReceiptLocationInput('');
    setReceiptLocationMenuOpen(false);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    try {
      setSaving(true);
      const payload = {
        ...form,
        quantity: asNumber(form.quantity, 0),
        min_quantity: asNumber(form.min_quantity, 0),
        vendor: form.vendor || '',
        purchaseOrder: form.purchaseOrder || '',
        receiptReceivedAt: form.receiptReceivedAt
          ? new Date(form.receiptReceivedAt).toISOString()
          : '',
        receiptLocationStore: form.receiptLocationStore || null,
        receiptLocationDetail: form.receiptLocationDetail?.trim() || '',
        receiptLocation: form.receiptLocationStore ? '' : (form.receiptLocation?.trim() || '')
      };
      if (editing?._id) {
        const { quantity: _omitQty, ...metaPayload } = payload;
        await api.put(`/spare-parts/${editing._id}`, metaPayload);
      } else {
        const postPayload = { ...payload };
        if (!postPayload.vendor) delete postPayload.vendor;
        if (!postPayload.purchaseOrder) delete postPayload.purchaseOrder;
        if (!postPayload.receiptReceivedAt) delete postPayload.receiptReceivedAt;
        await api.post('/spare-parts', postPayload);
      }
      setForm(buildInitialForm());
      setReceiptLocationInput('');
      setReceiptLocationMenuOpen(false);
      setEditing(null);
      setSpareFormTitle('Register spare part (purchased / new stock)');
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to save spare part');
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (row, mode = 'edit') => {
    setSpareFormTitle(mode === 'modify' ? 'Modify spare part' : 'Edit spare part');
    setEditing(row);
    setReceiptLocationInput(receiptLocationEditInputValue(row));
    setReceiptLocationMenuOpen(false);
    setForm({
      name: asText(row.name, ''),
      part_number: asText(row.part_number, ''),
      type: asText(row.type, ''),
      compatible_models: asText(row.compatible_models, ''),
      location: asText(row.location, ''),
      comment: asText(row.comment, ''),
      quantity: asNumber(row.quantity, 0),
      min_quantity: asNumber(row.min_quantity, 0),
      vendor: row.vendor?._id ? String(row.vendor._id) : (row.vendor ? String(row.vendor) : ''),
      purchaseOrder: row.purchaseOrder?._id ? String(row.purchaseOrder._id) : (row.purchaseOrder ? String(row.purchaseOrder) : ''),
      receiptReceivedAt: row.receiptReceivedAt
        ? toLocalDatetimeValue(row.receiptReceivedAt)
        : defaultReceiptDatetimeLocal(),
      receiptLocationStore: row.receiptLocationStore?._id || row.receiptLocationStore || '',
      receiptLocationDetail: asText(row.receiptLocationDetail, ''),
      receiptLocation: row.receiptLocationStore ? '' : asText(row.receiptLocation, '')
    });
  };

  const onDelete = async (id) => {
    if (!canManage) return;
    if (!window.confirm('Delete this spare part record?')) return;
    try {
      await api.delete(`/spare-parts/${id}`);
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to delete spare part');
    }
  };

  const showHistory = async (row) => {
    try {
      const res = await api.get(`/spare-parts/${row._id}/history`);
      setHistoryModal({ open: true, name: row.name, rows: res.data || [] });
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to load history');
    }
  };

  const updateHarvestLine = (index, field, value) => {
    setHarvestLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const onHarvestSubmit = async (e) => {
    e.preventDefault();
    if (!canManage || !harvestAssetId) {
      alert('Select a faulty asset.');
      return;
    }
    const parts = harvestLines
      .map((line) => ({
        name: String(line.name || '').trim(),
        part_number: String(line.part_number || '').trim(),
        quantity: asNumber(line.quantity, 0),
        type: String(line.type || '').trim(),
        compatible_models: String(line.compatible_models || '').trim(),
        location: String(line.location || '').trim(),
        note: String(line.note || '').trim()
      }))
      .filter((p) => p.name && p.quantity > 0);

    if (parts.length === 0) {
      alert('Add at least one line with part name and quantity.');
      return;
    }

    try {
      setHarvesting(true);
      await api.post('/spare-parts/harvest', {
        assetId: harvestAssetId,
        ticketNumber: harvestTicket.trim() || undefined,
        parts
      });
      setHarvestLines([emptyHarvestLine()]);
      setHarvestTicket('');
      await load();
      await loadFaultyAssets();
      alert('Harvest recorded. Inventory and asset history were updated.');
    } catch (error) {
      alert(error.response?.data?.message || 'Harvest failed');
    } finally {
      setHarvesting(false);
    }
  };

  const openIssue = (row) => {
    setIssueModal({
      open: true,
      row,
      quantity: 1,
      ticketNumber: '',
      note: '',
      targetAssetId: '',
      installationLocation: ''
    });
  };

  const submitIssue = async () => {
    if (!issueModal.row?._id) return;
    const qty = asNumber(issueModal.quantity, 0);
    if (qty < 1) {
      alert('Quantity must be at least 1');
      return;
    }
    try {
      setIssuing(true);
      await api.post(`/spare-parts/${issueModal.row._id}/issue`, {
        quantity: qty,
        ticketNumber: issueModal.ticketNumber.trim(),
        note: issueModal.note.trim(),
        targetAssetId: issueModal.targetAssetId.trim() || undefined,
        installationLocation: issueModal.installationLocation.trim() || undefined
      });
      setIssueModal({
        open: false,
        row: null,
        quantity: 1,
        ticketNumber: '',
        note: '',
        targetAssetId: '',
        installationLocation: ''
      });
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Issue failed');
    } finally {
      setIssuing(false);
    }
  };

  const submitSpareAssign = async (payload) => {
    if (!assignPartModal?._id) return;
    try {
      setAssignSpareSubmitting(true);
      await api.post(`/spare-parts/${assignPartModal._id}/issue`, {
        fromAssignModal: true,
        quantity: payload.assignQuantity,
        ticketNumber: String(payload.ticketNumber || '').trim(),
        note: '',
        installationLocation: String(payload.installationLocation || '').trim() || undefined,
        recipientType: payload.recipientType,
        technicianId: payload.recipientType === 'Technician' ? payload.technicianId : undefined,
        otherRecipient: payload.recipientType === 'Other' ? payload.otherRecipient : undefined,
        recipientEmail: payload.recipientEmail,
        recipientPhone: payload.recipientPhone,
        needGatePass: payload.needGatePass,
        sendGatePassEmail: payload.sendGatePassEmail,
        gatePassOrigin: payload.gatePassOrigin,
        gatePassDestination: payload.gatePassDestination,
        gatePassJustification: payload.gatePassJustification
      });
      setAssignPartModal(null);
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Assign failed');
    } finally {
      setAssignSpareSubmitting(false);
    }
  };

  const submitRestock = async () => {
    if (!restockModal.row?._id) return;
    const qty = asNumber(restockModal.quantity, 0);
    if (qty < 1) {
      alert('Quantity must be at least 1');
      return;
    }
    try {
      setRestocking(true);
      await api.post(`/spare-parts/${restockModal.row._id}/restock`, {
        quantity: qty,
        note: restockModal.note.trim()
      });
      setRestockModal({ open: false, row: null, quantity: 1, note: '' });
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Restock failed');
    } finally {
      setRestocking(false);
    }
  };

  const vendorCell = (row) => asText(row.vendorNameSnapshot || row.vendor?.name, '—');
  const poCell = (row) => asText(row.poNumberSnapshot || row.purchaseOrder?.poNumber, '—');
  const receiptCell = (row) => {
    const bits = [];
    if (row.receiptReceivedAt) bits.push(new Date(row.receiptReceivedAt).toLocaleString());
    const loc = formatReceiptWhere(row);
    if (loc && loc !== '—') bits.push(loc);
    if (row.receiptRecordedByName) bits.push(`booked by ${asText(row.receiptRecordedByName)}`);
    return bits.length ? bits.join(' · ') : '—';
  };

  const downloadImportTemplate = async () => {
    try {
      const res = await api.get('/spare-parts/import/template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'spare_parts_import_template.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to download template');
    }
  };

  const exportSpareParts = async () => {
    try {
      setExportBusy(true);
      const res = await api.get('/spare-parts/export', {
        params: { q: debouncedQ || undefined },
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'spare_parts_export.xlsx';
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
    if (!file || !canManage) return;
    try {
      setImportBusy(true);
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/spare-parts/import', fd);
      let extra = '';
      if (Array.isArray(res.data?.errors) && res.data.errors.length) {
        const lines = res.data.errors.slice(0, 6).map((er) => `Row ${er.row}: ${er.message}`).join('\n');
        extra = `\n\n${lines}${res.data.errors.length > 6 ? '\n…' : ''}`;
      }
      alert((res.data?.message || 'Import finished') + extra);
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Spare Parts</h1>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">
          Workflow: when a unit is <strong>Faulty</strong>, workshop staff <em>harvest</em> reusable components into this
          inventory (donor asset history shows who collected and ticket). When parts are <em>issued</em>, FIFO lots tie
          usage back to donor units where possible; the donor asset, optional target asset, spare-part line history, work
          location, ticket, and system activity log all record who issued and where parts were used.
        </p>
      </div>

      {canManage && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="font-semibold text-slate-900">Harvest from faulty asset</h2>
          <p className="text-xs text-slate-500">
            Only assets currently in <span className="font-medium">Faulty</span> condition (not disposed) can be sources.
          </p>
          <form onSubmit={onHarvestSubmit} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Faulty asset</label>
                <select
                  value={harvestAssetId}
                  onChange={(e) => setHarvestAssetId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select asset…</option>
                  {faultyAssets.map((a) => {
                    const where = assetStoreLocationLine(a);
                    return (
                      <option key={a._id} value={a._id}>
                        {asText(a.name)} — SN {asText(a.serial_number, 'n/a')}
                        {where ? ` — ${where}` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Ticket / WO (optional)</label>
                <input
                  value={harvestTicket}
                  onChange={(e) => setHarvestTicket(e.target.value)}
                  placeholder="e.g. INC-4521"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-600">Parts recovered</div>
              {harvestLines.map((line, idx) => (
                <div key={`harvest-${idx}`} className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end border border-slate-100 rounded-lg p-2">
                  <input
                    value={line.name}
                    onChange={(e) => updateHarvestLine(idx, 'name', e.target.value)}
                    placeholder="Part name *"
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm md:col-span-2"
                  />
                  <input
                    value={line.part_number}
                    onChange={(e) => updateHarvestLine(idx, 'part_number', e.target.value)}
                    placeholder="Part #"
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(e) => updateHarvestLine(idx, 'quantity', e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                  />
                  <input
                    value={line.note}
                    onChange={(e) => updateHarvestLine(idx, 'note', e.target.value)}
                    placeholder="Note"
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm md:col-span-2"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => setHarvestLines((prev) => [...prev, emptyHarvestLine()])}
                className="text-sm text-indigo-600 hover:underline"
              >
                + Add line
              </button>
            </div>

            <button
              type="submit"
              disabled={harvesting}
              className="rounded-lg px-4 py-2 bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50 text-sm"
            >
              {harvesting ? 'Recording…' : 'Record harvest'}
            </button>
          </form>
        </div>
      )}

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search by name, part #, vendor, PO, bin, receipt location…"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2"
          />
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              disabled={exportBusy}
              onClick={exportSpareParts}
              className="rounded-lg px-3 py-2 bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 text-sm"
            >
              {exportBusy ? 'Export…' : 'Bulk export (.xlsx)'}
            </button>
            {canManage && (
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

      {canManage && (
        <form onSubmit={onSubmit} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div>
            <h2 className="font-semibold text-slate-900">
              {editing ? spareFormTitle : 'Register spare part (purchased / new stock)'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Link rows to{' '}
              <Link to="/vendors" className="text-indigo-600 hover:underline font-medium">Vendor Management</Link>
              {' '}and{' '}
              <Link to="/purchase-orders" className="text-indigo-600 hover:underline font-medium">Purchase Orders</Link>
              {' '}for traceability. Vendor and PO must belong to the active store. For physical receipt, pick a site from{' '}
              <Link to="/stores" className="text-indigo-600 hover:underline font-medium">Locations</Link>
              {' '}or enter free text if you do not link a row.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input name="name" value={form.name} onChange={onChange} required placeholder="Name *" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="part_number" value={form.part_number} onChange={onChange} placeholder="Part number" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="type" value={form.type} onChange={onChange} placeholder="Type" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="compatible_models" value={form.compatible_models} onChange={onChange} placeholder="Compatible models" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="location" value={form.location} onChange={onChange} placeholder="Bin / shelf" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input type="number" min="0" name="quantity" value={form.quantity} onChange={onChange} placeholder="Quantity" disabled={!!editing} title={editing ? 'Use Issue, Restock, or Harvest to change quantity' : ''} className="border border-slate-300 rounded-lg px-3 py-2 disabled:bg-slate-100" />
            <input type="number" min="0" name="min_quantity" value={form.min_quantity} onChange={onChange} placeholder="Min qty alert" className="border border-slate-300 rounded-lg px-3 py-2" />
            <input name="comment" value={form.comment} onChange={onChange} placeholder="Comment" className="border border-slate-300 rounded-lg px-3 py-2 md:col-span-2" />
          </div>

          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Purchase receipt</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 max-w-5xl">
              <div className="min-w-0">
                <label className="block text-xs font-medium text-slate-600 mb-1">Vendor</label>
                <select
                  value={form.vendor}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((prev) => ({ ...prev, vendor: v, purchaseOrder: '' }));
                  }}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
                >
                  <option value="">Select vendor (optional)</option>
                  {vendors.map((v) => (
                    <option key={v._id} value={v._id}>{asText(v.name)} ({asText(v.status)})</option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label className="block text-xs font-medium text-slate-600 mb-1">Purchase order</label>
                <select
                  value={form.purchaseOrder}
                  onChange={(e) => {
                    const poId = e.target.value;
                    if (!poId) {
                      setForm((prev) => ({ ...prev, purchaseOrder: '' }));
                      return;
                    }
                    const po = pos.find((p) => String(p._id) === poId);
                    const vid = po?.vendor?._id || po?.vendor;
                    setForm((prev) => ({
                      ...prev,
                      purchaseOrder: poId,
                      vendor: vid ? String(vid) : prev.vendor
                    }));
                  }}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
                >
                  <option value="">Select PO (optional)</option>
                  {(form.vendor ? filteredPos : pos).map((p) => (
                    <option key={p._id} value={p._id}>
                      {asText(p.poNumber)} — {asText(p.vendor?.name || p.vendor)} — {asText(p.status)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">When received</label>
                <input
                  type="datetime-local"
                  name="receiptReceivedAt"
                  value={form.receiptReceivedAt}
                  onChange={onChange}
                  className="w-full max-w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
                />
              </div>

              <div className="min-w-0 sm:col-span-2 lg:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Where received (Locations)</label>
                <div className="flex gap-2 items-start">
                  <div className="relative flex-1 min-w-0">
                    <input
                      type="text"
                      autoComplete="off"
                      value={receiptLocationInput}
                      onChange={onReceiptLocationInputChange}
                      onFocus={() => setReceiptLocationMenuOpen(true)}
                      onBlur={() => {
                        window.setTimeout(() => setReceiptLocationMenuOpen(false), 180);
                      }}
                      placeholder={
                        activeStoreId
                          ? 'Search parent › site…'
                          : 'Select a store in the header first'
                      }
                      disabled={!activeStoreId}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                    />
                    {receiptLocationMenuOpen && activeStoreId && (
                      <ul className="absolute z-40 mt-1 max-h-48 w-full min-w-[12rem] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg text-sm">
                        {filteredReceiptStores.length === 0 ? (
                          <li className="px-3 py-2 text-slate-500">
                            {receiptLocationInput.trim() ? 'No matching location.' : 'No locations under this store.'}
                          </li>
                        ) : (
                          filteredReceiptStores.map((s) => (
                            <li key={s._id}>
                              <button
                                type="button"
                                className="w-full px-3 py-1.5 text-left hover:bg-slate-50"
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={() => pickReceiptLocationStore(s)}
                              >
                                {receiptLocationOptionLabel(s, activeStore)}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                  {(form.receiptLocationStore || receiptLocationInput.trim()) && (
                    <button
                      type="button"
                      onClick={clearReceiptLocationPick}
                      className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {!activeStoreId && (
                  <p className="text-xs text-amber-700 mt-1">Choose an active store in the header to link a location.</p>
                )}
              </div>
              <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">Receipt detail (dock / bay)</label>
                <input
                  name="receiptLocationDetail"
                  value={form.receiptLocationDetail}
                  onChange={onChange}
                  placeholder="Optional"
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
                />
              </div>

              <div className="min-w-0 sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-medium text-slate-600 mb-1">Where received (free text if not linked)</label>
                <input
                  name="receiptLocation"
                  value={form.receiptLocation}
                  onChange={onChange}
                  placeholder={form.receiptLocationStore ? '— cleared when location is linked —' : 'e.g. Main warehouse — GRN dock 2'}
                  disabled={Boolean(form.receiptLocationStore)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3 pt-1 border-t border-slate-100">
                <p className="text-xs text-slate-500">
                  Recorded in system by: <span className="font-medium text-slate-700">{asText(user?.name)}</span>
                  {' '}({asText(user?.email)})
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded-lg px-4 py-2 bg-amber-600 text-black hover:bg-amber-700 disabled:opacity-50">
              {saving ? 'Saving…' : editing ? 'Update' : 'Register'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setSpareFormTitle('Register spare part (purchased / new stock)');
                  setForm(buildInitialForm());
                  setReceiptLocationInput('');
                  setReceiptLocationMenuOpen(false);
                }}
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
              <th className="px-3 py-2 text-left">Part #</th>
              <th className="px-3 py-2 text-left">Vendor</th>
              <th className="px-3 py-2 text-left">PO</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Compatible</th>
              <th className="px-3 py-2 text-left">Bin</th>
              <th className="px-3 py-2 text-left">Qty</th>
              <th className="px-3 py-2 text-left">Min</th>
              <th className="px-3 py-2 text-left">Receipt</th>
              <th className="px-3 py-2 text-left">Comment</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-4 text-slate-500" colSpan={12}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-3 py-4 text-slate-500" colSpan={12}>No spare parts yet.</td></tr>
            ) : rows.map((row) => {
              const qtyLow = isAtOrBelowMinQty(row);
              return (
                <tr key={row._id} className="border-t">
                  <td className="px-3 py-2">{asText(row.name)}</td>
                  <td className="px-3 py-2">{asText(row.part_number)}</td>
                  <td className="px-3 py-2 max-w-[140px] truncate" title={vendorCell(row)}>{vendorCell(row)}</td>
                  <td className="px-3 py-2 max-w-[100px] truncate" title={poCell(row)}>{poCell(row)}</td>
                  <td className="px-3 py-2">{asText(row.type)}</td>
                  <td className="px-3 py-2">{asText(row.compatible_models)}</td>
                  <td className="px-3 py-2">{asText(row.location)}</td>
                  <td className={`px-3 py-2 tabular-nums ${qtyLow ? 'text-red-600 font-semibold' : ''}`}>
                    {asNumber(row.quantity, 0)}
                  </td>
                  <td className="px-3 py-2">{asNumber(row.min_quantity, 0)}</td>
                  <td className="px-3 py-2 max-w-[220px] text-xs text-slate-600" title={receiptCell(row)}>{receiptCell(row)}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={asText(row.comment)}>{asText(row.comment)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => showHistory(row)} className="text-indigo-600 hover:underline">History</button>
                      {canIssue && asNumber(row.quantity, 0) > 0 && (
                        <button type="button" onClick={() => openIssue(row)} className="text-emerald-700 hover:underline">Issue</button>
                      )}
                      {canAssignSpare && asNumber(row.quantity, 0) > 0 && (
                        <button type="button" onClick={() => setAssignPartModal(row)} className="text-emerald-800 hover:underline">Assign</button>
                      )}
                      {canManage && (
                        <>
                          <button type="button" onClick={() => setRestockModal({ open: true, row, quantity: 1, note: '' })} className="text-slate-700 hover:underline">Restock</button>
                          <button type="button" onClick={() => onEdit(row, 'edit')} className="text-amber-600 hover:underline">Edit</button>
                          <button type="button" onClick={() => onEdit(row, 'modify')} className="text-amber-800 hover:underline">Modify</button>
                          <button type="button" onClick={() => onDelete(row._id)} className="text-red-600 hover:underline">Delete</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AssignRecipientModal
        open={Boolean(assignPartModal)}
        onClose={() => {
          if (!assignSpareSubmitting) setAssignPartModal(null);
        }}
        title="Assign spare parts"
        resourceLine={
          assignPartModal
            ? `Issuing from stock: ${asText(assignPartModal.name)} (on hand ${asNumber(assignPartModal.quantity, 0)})`
            : ''
        }
        technicians={technicians}
        showAssignQuantity
        maxQuantity={Math.max(1, asNumber(assignPartModal?.quantity, 0))}
        defaultQuantity={1}
        defaultInstallationLocation=""
        submitting={assignSpareSubmitting}
        onSubmit={submitSpareAssign}
      />

      {issueModal.open && issueModal.row && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-4 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold">Issue — {asText(issueModal.row.name)}</h3>
            <p className="text-xs text-slate-500">
              On hand: {asNumber(issueModal.row.quantity, 0)}. This is written to spare-part history, donor asset(s) when
              stock came from a harvest, optional target asset, and activity logs.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                value={issueModal.quantity}
                onChange={(e) => setIssueModal((m) => ({ ...m, quantity: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Work / install location</label>
              <input
                placeholder="e.g. Building A — Workshop bench 3"
                value={issueModal.installationLocation}
                onChange={(e) => setIssueModal((m) => ({ ...m, installationLocation: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Asset receiving the part (optional)</label>
              <select
                value={issueModal.targetAssetId}
                onChange={(e) => setIssueModal((m) => ({ ...m, targetAssetId: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Not linked — site / job only</option>
                {issueTargetAssets.map((a) => {
                  const where = assetStoreLocationLine(a);
                  return (
                    <option key={a._id} value={a._id}>
                      {asText(a.name)} — SN {asText(a.serial_number, 'n/a')}
                      {where ? ` — ${where}` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <input
              placeholder="Ticket / WO (optional)"
              value={issueModal.ticketNumber}
              onChange={(e) => setIssueModal((m) => ({ ...m, ticketNumber: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
            />
            <input
              placeholder="Note"
              value={issueModal.note}
              onChange={(e) => setIssueModal((m) => ({ ...m, note: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setIssueModal({
                  open: false,
                  row: null,
                  quantity: 1,
                  ticketNumber: '',
                  note: '',
                  targetAssetId: '',
                  installationLocation: ''
                })}
                className="px-3 py-2 rounded-lg bg-slate-100"
              >
                Cancel
              </button>
              <button type="button" disabled={issuing} onClick={submitIssue} className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50">{issuing ? '…' : 'Confirm issue'}</button>
            </div>
          </div>
        </div>
      )}

      {restockModal.open && restockModal.row && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-4 space-y-3">
            <h3 className="font-semibold">Restock — {asText(restockModal.row.name)}</h3>
            <input
              type="number"
              min="1"
              value={restockModal.quantity}
              onChange={(e) => setRestockModal((m) => ({ ...m, quantity: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
            />
            <input
              placeholder="Note (e.g. PO number)"
              value={restockModal.note}
              onChange={(e) => setRestockModal((m) => ({ ...m, note: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setRestockModal({ open: false, row: null, quantity: 1, note: '' })} className="px-3 py-2 rounded-lg bg-slate-100">Cancel</button>
              <button type="button" disabled={restocking} onClick={submitRestock} className="px-3 py-2 rounded-lg bg-slate-800 text-white disabled:opacity-50">{restocking ? '…' : 'Add stock'}</button>
            </div>
          </div>
        </div>
      )}

      {historyModal.open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold">History — {historyModal.name}</h3>
              <button type="button" onClick={() => setHistoryModal({ open: false, name: '', rows: [] })} className="text-slate-500 hover:text-slate-800">Close</button>
            </div>
            <div className="p-4 space-y-2">
              {(historyModal.rows || []).map((h, idx) => (
                <div key={`${h.createdAt}-${idx}`} className="border border-slate-200 rounded-lg p-3 text-sm">
                  <div className="font-medium">{asText(h.action)}</div>
                  <div className="text-slate-600">By: {asText(h.actorName)}</div>
                  <div className="text-slate-600">Qty (this event): {asNumber(h.quantity, 0)}</div>
                  {h.quantityAfter != null && (
                    <div className="text-slate-600">On hand after: {asNumber(h.quantityAfter, 0)}</div>
                  )}
                  {h.sourceAssetLabel && (
                    <div className="text-slate-600">Source asset: {asText(h.sourceAssetLabel)}</div>
                  )}
                  {h.targetAssetLabel && (
                    <div className="text-slate-600">Target asset: {asText(h.targetAssetLabel)}</div>
                  )}
                  {h.usedAtLocation && (
                    <div className="text-slate-600">Work location: {asText(h.usedAtLocation)}</div>
                  )}
                  {h.ticketNumber && (
                    <div className="text-slate-600">Ticket / WO: {asText(h.ticketNumber)}</div>
                  )}
                  {h.donorTraceSummary && (
                    <div className="text-slate-600">Donor FIFO trace: {asText(h.donorTraceSummary)}</div>
                  )}
                  {h.recipientUserName && (
                    <div className="text-slate-600">Recipient (technician): {asText(h.recipientUserName)}</div>
                  )}
                  {(h.recipientExternalName || h.recipientExternalEmail) && (
                    <div className="text-slate-600">
                      Recipient (external): {asText(h.recipientExternalName)}{' '}
                      {h.recipientExternalEmail ? `<${asText(h.recipientExternalEmail)}>` : ''}
                      {h.recipientExternalPhone ? ` · ${asText(h.recipientExternalPhone)}` : ''}
                    </div>
                  )}
                  {h.assignmentGatePassSummary && (
                    <div className="text-slate-600 text-xs">Gate pass: {asText(h.assignmentGatePassSummary)}</div>
                  )}
                  <div className="text-slate-600">Note: {asText(h.note)}</div>
                  <div className="text-slate-500 text-xs">{h.createdAt ? new Date(h.createdAt).toLocaleString() : ''}</div>
                </div>
              ))}
              {(historyModal.rows || []).length === 0 && <p className="text-sm text-slate-500">No history.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpareParts;
