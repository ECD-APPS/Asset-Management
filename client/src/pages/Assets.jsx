import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Edit, Trash2, UserCheck, UserX, Filter, SlidersHorizontal, Download, RotateCcw, Scissors, Clock, MessageSquarePlus, GripVertical, Lock, LockOpen } from 'lucide-react';
import api from '../api/axios';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';

const flattenProducts = (list, level = 0, ancestors = []) => {
  const out = [];
  (list || []).forEach(p => {
    const pathParts = [...ancestors, p.name];
    const fullPath = pathParts.join(' / ');
    out.push({ ...p, level, fullPath });
    if (p.children && p.children.length > 0) {
      out.push(...flattenProducts(p.children, level + 1, pathParts));
    }
  });
  return out;
};

const escapeRegExpForHighlight = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Wrap every non-overlapping occurrence of `query` in <mark> (case-insensitive).
 * Typing "e" highlights all e's; "ex" highlights every "ex" substring, etc.
 * Returns a plain string if there is no query or no match in this cell.
 */
const highlightSearchInText = (text, query) => {
  const q = String(query || '').trim();
  if (!q) return text === null || text === undefined ? '' : String(text);
  const str = text === null || text === undefined ? '' : String(text);
  if (!str) return str;

  let re;
  try {
    re = new RegExp(escapeRegExpForHighlight(q), 'gi');
  } catch {
    return str;
  }

  const nodes = [];
  let lastIndex = 0;
  let key = 0;
  const matches = [...str.matchAll(re)];
  if (matches.length === 0) return str;

  for (const m of matches) {
    const start = m.index;
    if (start > lastIndex) {
      nodes.push(<span key={`t-${key++}`}>{str.slice(lastIndex, start)}</span>);
    }
    nodes.push(
      <mark
        key={`m-${key++}`}
        className="rounded px-0.5 bg-yellow-300 text-gray-900 font-semibold ring-1 ring-amber-500/80"
      >
        {m[0]}
      </mark>
    );
    lastIndex = start + m[0].length;
  }
  if (lastIndex < str.length) {
    nodes.push(<span key={`t-${key++}`}>{str.slice(lastIndex)}</span>);
  }
  return nodes;
};

const DEFAULT_COLUMN_DEFS = [
  { id: 'uniqueId', label: 'Unique ID', key: 'uniqueId', visible: true, builtin: true },
  { id: 'absCode', label: 'ABS Code', key: 'abs_code', visible: true, builtin: true },
  { id: 'expoTag', label: 'Expo Tag', key: 'expo_tag', visible: true, builtin: true },
  { id: 'model', label: 'Model Number', key: 'model_number', visible: true, builtin: true },
  { id: 'serial', label: 'Serial Number', key: 'serial_number', visible: true, builtin: true },
  { id: 'mac', label: 'MAC Address', key: 'mac_address', visible: true, builtin: true },
  { id: 'ipAddress', label: 'IP Address', key: 'ip_address', visible: true, builtin: true },
  { id: 'manufacturer', label: 'Manufacturer', key: 'manufacturer', visible: true, builtin: true },
  { id: 'ticket', label: 'Ticket', key: 'ticket_number', visible: true, builtin: true },
  { id: 'assignedTo', label: 'Assigned To', key: 'assigned_to.name', visible: true, builtin: true },
  { id: 'inboundFrom', label: 'Inbound From', key: 'inbound_from', visible: true, builtin: true },
  { id: 'outboundTo', label: 'Outbound To', key: 'outbound_to', visible: true, builtin: true },
  { id: 'name', label: 'Name', key: 'name', visible: true, builtin: true },
  { id: 'productNumber', label: 'Product Number', key: 'product_number', visible: true, builtin: true },
  { id: 'operatingSystem', label: 'Operating System', key: 'operating_system', visible: true, builtin: true },
  { id: 'specification', label: 'Specification', key: 'specification', visible: true, builtin: true },
  { id: 'serviceTag', label: 'Service Tag', key: 'service_tag', visible: true, builtin: true },
  { id: 'assignToDepartment', label: 'Assign To Department', key: 'assign_to_department', visible: true, builtin: true },
  { id: 'serialLast4', label: 'Serial Last 4', key: 'serial_last_4', visible: true, builtin: true },
  { id: 'poNumber', label: 'PO Number', key: 'po_number', visible: true, builtin: true },
  { id: 'rfid', label: 'RFID', key: 'rfid', visible: true, builtin: true },
  { id: 'qr', label: 'QR Code', key: 'qr_code', visible: true, builtin: true },
  { id: 'condition', label: 'Condition', key: 'condition', visible: true, builtin: true },
  { id: 'status', label: 'Status', key: 'status', visible: true, builtin: true },
  { id: 'prevStatus', label: 'Prev Status', key: 'previous_status', visible: true, builtin: true },
  { id: 'store', label: 'Store', key: 'store.name', visible: true, builtin: true },
  { id: 'location', label: 'Location', key: 'location', visible: true, builtin: true },
  { id: 'quantity', label: 'Quantity', key: 'quantity', visible: true, builtin: true },
  { id: 'vendor', label: 'Vendor', key: 'vendor_name', visible: true, builtin: true },
  { id: 'maintenanceVendor', label: 'Maintenance Vendor', key: 'maintenance_vendor', visible: true, builtin: true },
  { id: 'deviceGroup', label: 'Device Group', key: 'device_group', visible: true, builtin: true },
  { id: 'building', label: 'Building', key: 'building', visible: true, builtin: true },
  { id: 'stateComments', label: 'State Comments', key: 'state_comments', visible: true, builtin: true },
  { id: 'remarks', label: 'Remarks', key: 'remarks', visible: true, builtin: true },
  { id: 'comments', label: 'Comments', key: 'comments', visible: true, builtin: true },
  { id: 'source', label: 'Source', key: 'source', visible: true, builtin: true },
  { id: 'deliveredBy', label: 'Delivered By', key: 'delivered_by_name', visible: true, builtin: true },
  { id: 'deliveredAt', label: 'Delivered At', key: 'delivered_at', visible: true, builtin: true },
  { id: 'dateTime', label: 'Date & Time', key: 'updatedAt', visible: true, builtin: true },
  { id: 'price', label: 'Price', key: 'price', visible: true, builtin: true },
  { id: 'action', label: 'Action', key: 'action', visible: true, builtin: true }
];

/** Same column order as server template/export/import (bulk Excel). */
const BULK_ASSET_EXCEL_HEADERS = [
  'Category',
  'Product Type',
  'Product Name',
  'Unique ID',
  'ABS Code',
  'Expo Tag',
  'Model Number',
  'Quantity',
  'Serial Number',
  'MAC Address',
  'IP Address',
  'Manufacturer',
  'Ticket Number',
  'Assigned To',
  'Inbound From',
  'Outbound To',
  'PO Number',
  'Vendor Name',
  'Price',
  'RFID',
  'QR Code',
  'Store Location',
  'Status',
  'Condition',
  'Maintenance Vendor',
  'Device Group',
  'Location',
  'Product Number',
  'Operating System',
  'Specification',
  'Service Tag',
  'Assign To Department',
  'Building',
  'State Comments',
  'Remarks',
  'Comments',
  'Delivered By',
  'Delivered At'
];

const BULK_ASSET_TEMPLATE_SAMPLE_ROW = [
  'ACCESS CONTROL SYSTEMS',
  'LOCKS',
  'MAGNETIC LOCKS',
  'AST-88421',
  'ABS-99',
  'EXPO-001',
  'MEC-1200',
  1,
  '1584632152',
  '',
  '10.0.10.42',
  'SIEMENS',
  'TKT-1001',
  '',
  'Logistics Hub',
  'Site Alpha',
  'PO-1001',
  'ABC TRADERS',
  1250,
  '',
  '',
  'SCY ASSET',
  'In Store',
  'New',
  'Siemens',
  'Core Security',
  'Main Warehouse',
  'PN-12345',
  'Windows 11 Pro',
  '16GB RAM / 512GB SSD',
  'ST-88421',
  'IT Operations',
  'Block A',
  'Rack and power state verified',
  'Initial install batch',
  'Commissioned by infra team',
  'JOHN DOE',
  '2024-01-01 10:00'
];
const ALLOWED_STATUS_FILTERS = new Set(['In Store', 'In Use', 'Missing', 'Reserved', 'Disposed', 'Under Repair/Workshop', 'Faulty', 'Repaired', 'Serviceable']);
const DEFAULT_COLUMN_ORDER = DEFAULT_COLUMN_DEFS.map((column) => column.id);
const DEFAULT_VISIBLE_COLUMNS = Object.fromEntries(DEFAULT_COLUMN_DEFS.map((column) => [column.id, column.visible !== false]));
const REQUIRED_ASSET_COLUMN_IDS = new Set([
  'expoTag',
  'absCode',
  'productNumber',
  'operatingSystem',
  'specification',
  'serviceTag',
  'assignToDepartment',
  'deviceGroup',
  'inboundFrom',
  'outboundTo',
  'ipAddress',
  'building',
  'stateComments',
  'remarks',
  'comments'
]);
const KNOWN_EDIT_KEYS = new Set([
  'name',
  'model_number',
  'serial_number',
  'ticket_number',
  'po_number',
  'vendor_name',
  'device_group',
  'inbound_from',
  'outbound_to',
  'expo_tag',
  'abs_code',
  'product_number',
  'operating_system',
  'specification',
  'service_tag',
  'assign_to_department',
  'ip_address',
  'building',
  'state_comments',
  'remarks',
  'comments',
  'price',
  'rfid',
  'qr_code',
  'mac_address',
  'manufacturer',
  'location',
  'condition',
  'status',
  'store',
  'product_name',
  'quantity',
  'serial_last_4',
  'previous_status',
  'source',
  'delivered_by_name',
  'delivered_at',
  'updatedAt',
  'action',
  'uniqueId'
]);
const NON_EDITABLE_CUSTOM_KEYS = new Set([
  'assigned_to.name',
  'assigned_to.email',
  'store.name',
  'store.parentStore.name',
  'previous_status',
  'updatedAt',
  'createdAt'
]);
const MAINTENANCE_VENDOR_OPTIONS = ['Siemens', 'G42'];

const Assets = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const searchParam = searchParams.get('search');
  const productParam = searchParams.get('product');
  const statusParam = searchParams.get('status');
  const derivedStatusParam = searchParams.get('derived_status');
  const conditionParam = searchParams.get('condition');
  const actionParam = searchParams.get('action');
  const locationParam = searchParams.get('location');
  const storeParam = searchParams.get('store');
  const maintenanceVendorParam = searchParams.get('maintenance_vendor');
  const reservedParam = searchParams.get('reserved');
  const disposedParam = searchParams.get('disposed');
  const duplicateParam = searchParams.get('duplicate');
  const { user, activeStore } = useAuth();
  const scopeHints = [
    activeStore?.name,
    user?.assignedStore?.name,
    user?.name,
    user?.email
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  const hasScyHint = scopeHints.includes('SCY');
  const hasItHint = scopeHints.includes('IT ASSET') || /\bIT\b/.test(scopeHints);
  const hasNocHint = scopeHints.includes('NOC ASSET') || /\bNOC\b/.test(scopeHints);
  const isScyStoreContext = hasScyHint || (!hasItHint && !hasNocHint && user?.role !== 'Super Admin');

  const [assets, setAssets] = useState([]);
  const [stores, setStores] = useState([]);
  const [technicians, setTechnicians] = useState([]); // New: Technicians list
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [allowDup, setAllowDup] = useState(false);
  const [importInfo, setImportInfo] = useState(null);
  const [importStep, setImportStep] = useState('select');
  const [importPreview, setImportPreview] = useState(null);
  const [forceLoading, setForceLoading] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [reserveBusy, setReserveBusy] = useState(false);
  const [topReserveBusy, setTopReserveBusy] = useState(false);
  const [bulkLocationId, setBulkLocationId] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    status: '',
    condition: '',
    manufacturer: '',
    locationId: '',
    product_name: '',
    device_group: '',
    inbound_from: '',
    outbound_to: '',
    expo_tag: '',
    abs_code: '',
    product_number: '',
    operating_system: '',
    specification: '',
    service_tag: '',
    assign_to_department: '',
    ip_address: '',
    building: '',
    state_comments: '',
    remarks: '',
    comments: ''
  });
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showRecentUploads, setShowRecentUploads] = useState(false);
  const [prevVisibleColumns, setPrevVisibleColumns] = useState(null);

  const displayedAssets = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    const selectedRows = [];
    const normalRows = [];
    assets.forEach((asset) => {
      if (selectedSet.has(asset._id)) selectedRows.push(asset);
      else normalRows.push(asset);
    });
    return [...selectedRows, ...normalRows];
  }, [assets, selectedIds]);
  
  // Custom Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    type: 'danger', // danger | warning | info
    onConfirm: null
  });

  const openConfirm = (title, message, onConfirm, type = 'danger', confirmText = 'Confirm') => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, type, confirmText });
  };

  const [splitModal, setSplitModal] = useState({
    isOpen: false,
    asset: null,
    quantity: 1,
    status: 'In Store',
    condition: 'Faulty'
  });

  const handleSplitClick = (asset) => {
    setSplitModal({
      isOpen: true,
      asset,
      quantity: 1,
      status: 'In Store',
      condition: 'Faulty'
    });
  };

  const handleSplitSubmit = async () => {
    try {
      if (!splitModal.asset) return;
      await api.post('/assets/split', {
        assetId: splitModal.asset._id,
        splitQuantity: splitModal.quantity,
        newStatus: splitModal.status,
        newCondition: splitModal.condition
      });
      alert('Asset split successfully');
      setSplitModal(prev => ({ ...prev, isOpen: false }));
      fetchAssets(undefined, { silent: true });
    } catch (error) {
      console.error('Error splitting asset:', error);
      alert(error.response?.data?.message || 'Failed to split asset');
    }
  };

  const moveColumnOrder = (fromKey, toKey) => {
    if (!fromKey || !toKey || fromKey === toKey) return;
    setColumnOrder((prev) => {
      const fromIndex = prev.indexOf(fromKey);
      const toIndex = prev.indexOf(toKey);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleSaveColumnLayout = async () => {
    const columnById = new Map(columnDefinitions.map((c) => [c.id, c]));
    const columnsPayload = columnOrder.map((id) => {
      const def = columnById.get(id);
      if (!def) return null;
      return {
        id,
        label: def.label,
        key: def.key,
        visible: visibleColumns[id] !== false,
        builtin: Boolean(def.builtin)
      };
    }).filter(Boolean);
    try {
      setSavingColumnPrefs(true);
      await api.put('/users/me/assets-table-columns', { config: { columns: columnsPayload } });
      alert('Column layout saved for your account.');
    } catch (e) {
      alert(e?.response?.data?.message || 'Could not save column layout.');
    } finally {
      setSavingColumnPrefs(false);
    }
  };

  const getByPath = (obj, path) => {
    const rawPath = String(path || '').trim();
    if (!rawPath) return undefined;
    return rawPath.split('.').reduce((acc, segment) => (acc == null ? undefined : acc[segment]), obj);
  };
  const getValueByAliases = (asset = {}, aliases = []) => {
    for (const alias of aliases) {
      const key = String(alias || '').trim();
      if (!key) continue;
      const topValue = asset?.[key];
      if (topValue !== undefined && topValue !== null && String(topValue).trim() !== '') {
        return String(topValue).trim();
      }
      const customValue = asset?.customFields?.[key];
      if (customValue !== undefined && customValue !== null && String(customValue).trim() !== '') {
        return String(customValue).trim();
      }
    }
    return '-';
  };

  const pickAssetField = (asset = {}, aliases = []) => {
    for (const alias of aliases) {
      const key = String(alias || '').trim();
      if (!key) continue;
      const topValue = asset?.[key];
      if (topValue !== undefined && topValue !== null && String(topValue).trim() !== '') {
        return String(topValue).trim();
      }
      const customValue = asset?.customFields?.[key];
      if (customValue !== undefined && customValue !== null && String(customValue).trim() !== '') {
        return String(customValue).trim();
      }
    }
    return '';
  };

  const openCommentModal = (asset) => {
    setAssetCommentModal({
      isOpen: true,
      asset,
      comment: ''
    });
  };

  const submitAssetComment = async () => {
    const comment = String(assetCommentModal.comment || '').trim();
    const assetId = assetCommentModal.asset?._id;
    if (!assetId) return;
    if (!comment) {
      alert('Please enter a comment.');
      return;
    }
    try {
      setSavingComment(true);
      await api.post(`/assets/${assetId}/comment`, { comment });
      setAssetCommentModal({ isOpen: false, asset: null, comment: '' });
      await fetchAssets(undefined, { silent: true });
      alert('Comment added to asset history.');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to add comment');
    } finally {
      setSavingComment(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!Array.isArray(importPreview) || importPreview.length === 0) return;
    try {
      setManualLoading(true);
      // Reuse the original file and let server perform robust parsing/upsert
      const form = new FormData();
      form.append('file', file);
      form.append('allowDuplicates', String(allowDup));
      if (selectedProduct) form.append('product_name', selectedProduct);
      if (bulkLocationId) {
        const loc = stores.find(s => s._id === bulkLocationId);
        if (loc) form.append('location', loc.name);
      }
      const res = await api.post('/assets/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const warningStrings = Array.isArray(res.data?.warnings)
        ? res.data.warnings.map((w) => String(w))
        : [];
      const skippedDuplicates = Array.isArray(res.data?.skipped_duplicates)
        ? res.data.skipped_duplicates
        : [];
      setImportInfo({
        message: res.data?.message || 'Import complete',
        warnings: warningStrings,
        skipped_duplicates: skippedDuplicates,
        invalid_rows: Array.isArray(res.data?.invalid_rows) ? res.data.invalid_rows : [],
        updated_rows: Array.isArray(res.data?.updated_rows) ? res.data.updated_rows : [],
        totals: res.data?.totals || {},
        import_update_batch_id: String(res.data?.import_update_batch_id || ''),
        import_update_batch_created_at: res.data?.import_update_batch_created_at || null
      });
      alert(res.data?.message || 'Import completed');
      setShowImportModal(false);
      setImportPreview(null);
      setImportStep('select');
      setFile(null);
      fetchAssets(undefined, { silent: true });
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to import assets');
    } finally {
      setManualLoading(false);
    }
  };

  const handleRevertLastImportUpdates = async () => {
    openConfirm(
      'Revert Last Import Updates',
      'This will restore previous values for assets updated by the latest import batch. Continue?',
      async () => {
        try {
          setRevertingImport(true);
          const res = await api.post('/assets/import/revert-last');
          alert(res.data?.message || 'Latest import updates reverted');
          await fetchAssets(undefined, { silent: true });
          setImportInfo((prev) => (
            prev
              ? { ...prev, import_update_batch_id: '', import_update_batch_created_at: null }
              : prev
          ));
        } catch (error) {
          alert(error?.response?.data?.message || 'Failed to revert latest import updates');
        } finally {
          setRevertingImport(false);
        }
      },
      'warning',
      'Revert'
    );
  };

  const handleExportSelected = async () => {
    if (!selectedIds.length) return;
    const headers = BULK_ASSET_EXCEL_HEADERS;

    const rows = assets.filter((a) => selectedIds.includes(a._id)).map((a) => {
      const maintenanceVendor = a?.customFields?.maintenance_vendor || '';
      const deliveredAt = a?.delivered_at
        ? new Date(a.delivered_at).toLocaleString()
        : '';
      const storeLocation = a?.store?.parentStore?.name || a?.store?.name || '';
      const assigneeName = a?.assigned_to?.name || a?.assigned_to_external?.name || '';

      const out = {};
      headers.forEach((h) => {
        out[h] = (() => {
          switch (h) {
            case 'Category':
              return '';
            case 'Product Type':
              return '';
            case 'Product Name':
              return a.product_name || '';
            case 'Unique ID':
              return a.uniqueId || '';
            case 'ABS Code':
              return pickAssetField(a, ['abs_code', 'absCode', 'abs code']);
            case 'Expo Tag':
              return pickAssetField(a, ['expo_tag', 'expoTag', 'expo tag']);
            case 'Model Number':
              return a.model_number || '';
            case 'Quantity':
              return a.quantity ?? '';
            case 'Serial Number':
              return a.serial_number || '';
            case 'MAC Address':
              return a.mac_address || '';
            case 'IP Address':
              return a.ip_address || '';
            case 'Manufacturer':
              return a.manufacturer || '';
            case 'Ticket Number':
              return a.ticket_number || '';
            case 'Assigned To':
              return assigneeName;
            case 'Inbound From':
              return a.inbound_from || '';
            case 'Outbound To':
              return a.outbound_to || '';
            case 'PO Number':
              return a.po_number || '';
            case 'Vendor Name':
              return a.vendor_name || '';
            case 'Price':
              return typeof a.price === 'number' ? a.price : '';
            case 'RFID':
              return a.rfid || '';
            case 'QR Code':
              return a.qr_code || '';
            case 'Store Location':
              return storeLocation;
            case 'Status':
              return a.status || '';
            case 'Condition':
              return a.condition || '';
            case 'Maintenance Vendor':
              return maintenanceVendor;
            case 'Device Group':
              return a.device_group || '';
            case 'Location':
              return a.location || '';
            case 'Product Number':
              return pickAssetField(a, ['product_number', 'productNumber', 'product number']);
            case 'Operating System':
              return pickAssetField(a, ['operating_system', 'operatingSystem', 'operating system']);
            case 'Specification':
              return pickAssetField(a, ['specification', 'spec']);
            case 'Service Tag':
              return pickAssetField(a, ['service_tag', 'serviceTag', 'service tag']);
            case 'Assign To Department':
              return pickAssetField(a, [
                'assign_to_department',
                'assignToDepartment',
                'assign to department',
                'assign to depratment',
                'assign_to_depratment'
              ]);
            case 'Building':
              return a.building || '';
            case 'State Comments':
              return a.state_comments || '';
            case 'Remarks':
              return a.remarks || '';
            case 'Comments':
              return a.comments || '';
            case 'Delivered By':
              return a.delivered_by_name || '';
            case 'Delivered At':
              return deliveredAt;
            default:
              return '';
          }
        })();
      });
      return out;
    });

    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Selected Assets');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'selected_assets.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const closeConfirm = () => {
    setConfirmModal(prev => ({ ...prev, isOpen: false }));
  };

  const handleConfirmAction = async () => {
    if (confirmModal.onConfirm) {
      await confirmModal.onConfirm();
    }
    closeConfirm();
  };

  // Assign State
  const [assigningAsset, setAssigningAsset] = useState(null);
  const [assigningAssetIds, setAssigningAssetIds] = useState([]);
  const [assignForm, setAssignForm] = useState({
    technicianId: '',
    recipientEmail: '',
    recipientPhone: '',
    assignQuantity: 1,
    ticketNumber: '',
    needGatePass: false,
    gatePassOrigin: '',
    gatePassDestination: '',
    gatePassJustification: ''
  });
  const [techSearch, setTechSearch] = useState('');
  const [showTechSuggestions, setShowTechSuggestions] = useState(false);
  const [recipientType, setRecipientType] = useState('Technician');
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignInstallationLocationError, setAssignInstallationLocationError] = useState('');
  const [otherRecipient, setOtherRecipient] = useState({
    name: '',
    email: '',
    phone: '',
    note: ''
  });

  // Edit State
  const [editingAsset, setEditingAsset] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    model_number: '',
    serial_number: '',
    quantity: 1,
    mac_address: '',
    manufacturer: '',
    ticket_number: '',
    po_number: '',
    vendor_name: '',
    device_group: '',
    inbound_from: '',
    outbound_to: '',
    expo_tag: '',
    abs_code: '',
    product_number: '',
    operating_system: '',
    specification: '',
    service_tag: '',
    assign_to_department: '',
    ip_address: '',
    building: '',
    state_comments: '',
    remarks: '',
    comments: '',
    delivered_by_name: '',
    price: '',
    store: '',
    location: '',
    status: '',
    condition: 'New',
    rfid: '',
    qr_code: ''
  });
  const [addForm, setAddForm] = useState({
    name: '',
    model_number: '',
    serial_number: '',
    quantity: 1,
    mac_address: '',
    manufacturer: '',
    ticket_number: '',
    po_number: '',
    vendor_name: '',
    device_group: '',
    inbound_from: '',
    outbound_to: '',
    expo_tag: '',
    abs_code: '',
    product_number: '',
    operating_system: '',
    specification: '',
    service_tag: '',
    assign_to_department: '',
    ip_address: '',
    building: '',
    state_comments: '',
    remarks: '',
    comments: '',
    price: '',
    store: '',
    location: '',
    status: 'In Store',
    condition: 'New',
    rfid: '',
    qr_code: ''
  });
  const [customEditValues, setCustomEditValues] = useState({});
  const [editAssignedToId, setEditAssignedToId] = useState('');
  const [editAssignQuantity, setEditAssignQuantity] = useState(1);
  const [editInstallationLocation, setEditInstallationLocation] = useState('');
  const [editInstallationLocationError, setEditInstallationLocationError] = useState('');
  const [editNeedGatePass, setEditNeedGatePass] = useState(false);
  const [editGatePassOrigin, setEditGatePassOrigin] = useState('');
  const [editGatePassDestination, setEditGatePassDestination] = useState('');
  const [editGatePassJustification, setEditGatePassJustification] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterStoreId, setFilterStoreId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterProductName, setFilterProductName] = useState('');
  
  // Advanced Filters
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterManufacturer, setFilterManufacturer] = useState('');
  const [filterMaintenanceVendor, setFilterMaintenanceVendor] = useState('');
  const [filterReserved, setFilterReserved] = useState('');
  const [filterDisposed, setFilterDisposed] = useState('');
  const [filterDuplicate, setFilterDuplicate] = useState('');
  const [filterModelNumber, setFilterModelNumber] = useState('');
  const [filterSerialNumber, setFilterSerialNumber] = useState('');
  const [filterMacAddress, setFilterMacAddress] = useState('');
  const [filterTicket, setFilterTicket] = useState('');
  const [filterRfid, setFilterRfid] = useState('');
  const [filterQr, setFilterQr] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [fullProducts, setFullProducts] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [dragColumnKey, setDragColumnKey] = useState('');
  const [columnDefinitions, setColumnDefinitions] = useState(() => [...DEFAULT_COLUMN_DEFS]);
  const [columnOrder, setColumnOrder] = useState(() => [...DEFAULT_COLUMN_ORDER]);
  const [visibleColumns, setVisibleColumns] = useState(() => ({ ...DEFAULT_VISIBLE_COLUMNS }));
  const requestIdRef = useRef(0);
  const activeControllerRef = useRef(null);
  const hasHydratedFiltersRef = useRef(false);
  const [assetCommentModal, setAssetCommentModal] = useState({
    isOpen: false,
    asset: null,
    comment: ''
  });
  const [savingComment, setSavingComment] = useState(false);
  const [revertingImport, setRevertingImport] = useState(false);
  const [savingColumnPrefs, setSavingColumnPrefs] = useState(false);

  useEffect(() => {
    if (showRecentUploads) {
      setPrevVisibleColumns(visibleColumns);
      setVisibleColumns((prev) => ({
        ...prev,
        uniqueId: false,
        name: true,
        model: true,
        serial: true,
        serialLast4: false,
        ticket: true,
        poNumber: false,
        mac: true,
        rfid: true,
        qr: true,
        manufacturer: true,
        condition: true,
        status: true,
        prevStatus: false,
        store: true,
        location: true,
        quantity: true,
        vendor: true,
        maintenanceVendor: true,
        deviceGroup: true,
        inboundFrom: true,
        outboundTo: true,
        expoTag: true,
        absCode: true,
        productNumber: true,
        operatingSystem: true,
        specification: true,
        serviceTag: true,
        assignToDepartment: true,
        ipAddress: true,
        building: true,
        stateComments: true,
        remarks: true,
        comments: true,
        source: false,
        deliveredBy: true,
        deliveredAt: true,
        assignedTo: false,
        dateTime: false,
        price: true,
        action: true
      }));
    } else if (prevVisibleColumns) {
      setVisibleColumns(prevVisibleColumns);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRecentUploads]);

  useEffect(() => {
    let cancelled = false;
    const loadColumnsConfig = async () => {
      const applyMergedColumns = (nextColumnsRaw) => {
        const nextColumns = [];
        const seen = new Set();
        nextColumnsRaw.forEach((column, idx) => {
          const id = String(column?.id || '').trim() || `custom_${idx}`;
          if (seen.has(id)) return;
          const label = String(column?.label || '').trim() || id;
          const key = String(column?.key || '').trim();
          if (!key) return;
          seen.add(id);
          nextColumns.push({
            id,
            label,
            key,
            visible: column?.visible !== false,
            builtin: Boolean(column?.builtin)
          });
        });

        let safeColumns = nextColumns.length > 0 ? nextColumns : [...DEFAULT_COLUMN_DEFS];
        const hasMaintenanceVendorColumn = safeColumns.some((column) => {
          const key = String(column?.key || '').toLowerCase();
          const label = String(column?.label || '').toLowerCase();
          return key.includes('maintenance_vendor')
            || key.includes('maintenancevendor')
            || key.includes('maintenance_vandor')
            || label.includes('maintenance vendor')
            || label.includes('maintenance vandor');
        });
        if (!hasMaintenanceVendorColumn) {
          safeColumns.push({ id: 'maintenanceVendor', label: 'Maintenance Vendor', key: 'maintenance_vendor', visible: true, builtin: true });
        }
        const columnById = new Map(safeColumns.map((c) => [String(c.id), { ...c }]));
        DEFAULT_COLUMN_DEFS.forEach((builtinColumn) => {
          const id = String(builtinColumn.id);
          if (!columnById.has(id)) {
            const added = { ...builtinColumn, visible: true, builtin: true };
            columnById.set(id, added);
          }
        });
        const ordered = [];
        const usedIds = new Set();
        nextColumns.forEach((col) => {
          const id = String(col.id);
          const full = columnById.get(id);
          if (full && !usedIds.has(id)) {
            ordered.push({ ...full, visible: col.visible !== false });
            usedIds.add(id);
          }
        });
        DEFAULT_COLUMN_ORDER.forEach((id) => {
          if (!usedIds.has(id) && columnById.has(id)) {
            ordered.push(columnById.get(id));
            usedIds.add(id);
          }
        });
        columnById.forEach((col, id) => {
          if (!usedIds.has(id)) {
            ordered.push(col);
            usedIds.add(id);
          }
        });
        safeColumns = ordered;
        const nextOrder = safeColumns.map((column) => column.id);
        const nextVisible = Object.fromEntries(safeColumns.map((column) => [column.id, column.visible !== false]));
        const maintenanceColumnId = safeColumns.find((column) => {
          const key = String(column?.key || '').toLowerCase();
          const label = String(column?.label || '').toLowerCase();
          return key.includes('maintenance_vendor')
            || key.includes('maintenancevendor')
            || key.includes('maintenance_vandor')
            || label.includes('maintenance vendor')
            || label.includes('maintenance vandor');
        })?.id;
        if (maintenanceColumnId) {
          nextVisible[maintenanceColumnId] = true;
        }
        REQUIRED_ASSET_COLUMN_IDS.forEach((id) => {
          nextVisible[id] = true;
        });

        setColumnDefinitions(safeColumns);
        setColumnOrder(nextOrder);
        setVisibleColumns(nextVisible);
      };

      try {
        let nextColumnsRaw = null;
        if (user?._id) {
          try {
            const userRes = await api.get('/users/me/assets-table-columns');
            if (cancelled) return;
            const uc = userRes.data?.config?.columns;
            if (Array.isArray(uc) && uc.length > 0) nextColumnsRaw = uc;
          } catch {
            /* fall back to store defaults */
          }
        }
        if (!nextColumnsRaw) {
          const activeStoreId = activeStore?._id || activeStore;
          const res = await api.get('/system/assets-columns-config', {
            params: activeStoreId ? { storeId: activeStoreId } : undefined
          });
          if (cancelled) return;
          const config = res.data?.config || {};
          const sc = config.columns;
          if (Array.isArray(sc) && sc.length > 0) nextColumnsRaw = sc;
        }
        applyMergedColumns(nextColumnsRaw && nextColumnsRaw.length ? nextColumnsRaw : DEFAULT_COLUMN_DEFS);
      } catch {
        if (!cancelled) applyMergedColumns(DEFAULT_COLUMN_DEFS);
      }
    };
    loadColumnsConfig();
    return () => { cancelled = true; };
  }, [activeStore, user?._id]);

  const isConditionFaulty = (asset) => String(asset?.condition || '').trim().toLowerCase() === 'faulty';
  const cannotIssueToTechnician = (asset) => Boolean(asset?.reserved === true) || isConditionFaulty(asset);
  const topAssignDisabled = selectedIds.length === 0;

  const handleTopEdit = () => {
    if (selectedIds.length === 0) return;
    if (selectedIds.length === 1) {
      const asset = assets.find(a => a._id === selectedIds[0]);
      if (asset) handleEditClick(asset);
    } else {
      setShowBulkEditModal(true);
    }
  };

  const handleTopAssign = () => {
    if (selectedIds.length === 0) return;
    const asset = assets.find((a) => String(a._id) === String(selectedIds[0]));
    if (asset) handleAssignClick(asset, selectedIds);
  };

  const handleTopReserve = async () => {
    if (selectedIds.length === 0 || topReserveBusy) return;
    openConfirm(
      'Reserve Assets',
      `Reserve ${selectedIds.length} selected asset(s)? Reserved assets cannot be issued to technicians.`,
      async () => {
        try {
          setTopReserveBusy(true);
          const res = await api.post('/assets/reserve', { assetIds: selectedIds });
          const updatedItems = res.data?.items || [];
          const updatedMap = new Map(updatedItems.map((item) => [item._id, item]));
          setAssets((prev) => prev.map((a) => updatedMap.get(a._id) || a));
          fetchAssets(undefined, { silent: true });
          alert(res.data?.message || 'Asset(s) reserved successfully');
        } catch (error) {
          console.error('Error reserving assets:', error);
          alert(error?.response?.data?.message || 'Failed to reserve assets');
        } finally {
          setTopReserveBusy(false);
        }
      },
      'warning',
      'Reserve'
    );
  };

  const handleTopUnreserve = async () => {
    if (selectedIds.length === 0 || topReserveBusy) return;
    openConfirm(
      'Unreserve Assets',
      `Unreserve ${selectedIds.length} selected asset(s)?`,
      async () => {
        try {
          setTopReserveBusy(true);
          const res = await api.post('/assets/unreserve', { assetIds: selectedIds });
          const updatedItems = res.data?.items || [];
          const updatedMap = new Map(updatedItems.map((item) => [item._id, item]));
          setAssets((prev) => prev.map((a) => updatedMap.get(a._id) || a));
          fetchAssets(undefined, { silent: true });
          alert(res.data?.message || 'Asset(s) unreserved successfully');
        } catch (error) {
          console.error('Error unreserving assets:', error);
          alert(error?.response?.data?.message || 'Failed to unreserve assets');
        } finally {
          setTopReserveBusy(false);
        }
      },
      'info',
      'Unreserve'
    );
  };

  const handleTopDelete = () => {
    if (selectedIds.length === 0) return;
    if (selectedIds.length === 1) {
      handleDelete(selectedIds[0]);
    } else {
      handleBulkDelete();
    }
  };

  const normalizeUrlStatusFilter = useCallback((rawStatus) => {
    const value = String(rawStatus || '').trim();
    if (!value) return { status: '', condition: '' };
    if (ALLOWED_STATUS_FILTERS.has(value)) return { status: value, condition: '' };
    // Backward compatibility: older links use status=Faulty while UI filter is condition-based.
    if (value.toLowerCase() === 'faulty') return { status: '', condition: 'Faulty' };
    return { status: '', condition: '' };
  }, []);

  // Sync category & status params from URL
  useEffect(() => {
    const normalized = normalizeUrlStatusFilter(derivedStatusParam || statusParam);
    setSearchTerm(searchParam || '');
    setFilterProductName(productParam || '');
    setFilterStatus(normalized.status);
    setFilterCondition(conditionParam || normalized.condition);
    setFilterLocation(locationParam || '');
    setFilterStoreId(storeParam || '');
    // Keep vendor filter from URL (e.g. dashboard Siemens/G42 KPI click),
    // while backend still enforces SCY scope authorization.
    setFilterMaintenanceVendor(maintenanceVendorParam || '');
    setFilterReserved((reservedParam === 'true' || reservedParam === 'false') ? reservedParam : '');
    setFilterDisposed((disposedParam === 'true' || disposedParam === 'false' || disposedParam === 'all') ? disposedParam : '');
    setFilterDuplicate(duplicateParam === 'true' ? 'true' : '');
    if (actionParam === 'add') setShowAddModal(true);
  }, [searchParam, productParam, statusParam, derivedStatusParam, conditionParam, actionParam, locationParam, storeParam, maintenanceVendorParam, reservedParam, disposedParam, duplicateParam, isScyStoreContext, normalizeUrlStatusFilter]);


  // Hierarchical State for Add/Import
  const [selectedProduct, setSelectedProduct] = useState('');

  const fetchProducts = useCallback(async () => {
    try {
      const res = await api.get('/products');
      setFullProducts(res.data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  }, []);

  const flatProducts = useMemo(() => flattenProducts(fullProducts), [fullProducts]);
  const movementDestinationOptions = useMemo(() => {
    const out = new Set();
    (stores || []).forEach((s) => {
      const name = String(s?.name || '').trim();
      if (name) out.add(name);
    });
    (assets || []).forEach((a) => {
      const loc = String(a?.location || '').trim();
      if (loc) out.add(loc);
    });
    return Array.from(out);
  }, [stores, assets]);

  const fetchAssets = useCallback(async (params, options) => {
    const silent = options?.silent === true;
    const requestId = ++requestIdRef.current;

    if (activeControllerRef.current) {
      activeControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeControllerRef.current = controller;

    try {
      if (!silent) setLoading(true);
      const response = await api.get('/assets', {
        signal: controller.signal,
        params: {
          page,
          limit,
          recent_upload: showRecentUploads,
          q: searchTerm || undefined,
          derived_status: filterStatus || undefined,
          store: filterStoreId || undefined,
          location: filterLocation || undefined,
          condition: filterCondition || undefined, // Add condition filter
          // category removed
          manufacturer: filterManufacturer || undefined,
          maintenance_vendor: filterMaintenanceVendor || undefined,
          reserved: filterReserved || undefined,
          disposed: filterDisposed || undefined,
          duplicate: filterDuplicate || undefined,
          model_number: filterModelNumber || undefined,
          serial_number: filterSerialNumber || undefined,
          mac_address: filterMacAddress || undefined,
          // product_type removed
          product_name: filterProductName || undefined,
          ticket_number: filterTicket || undefined,
          rfid: filterRfid || undefined,
          qr_code: filterQr || undefined,
          date_from: filterDateFrom || undefined,
          date_to: filterDateTo || undefined,
          ...(params || {})
        }
      });

      if (requestId !== requestIdRef.current) return;
      const rawItems = response.data.items || [];
      if (filterDuplicate === 'true') {
        const onlyDuplicates = rawItems.filter((item) => item?.isDuplicate === true);
        setAssets(onlyDuplicates);
        setTotal(onlyDuplicates.length);
      } else {
        setAssets(rawItems);
        setTotal(response.data.total || 0);
      }
    } catch (error) {
      if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') return;
      console.error(error);
    } finally {
      if (requestId === requestIdRef.current && !silent) setLoading(false);
    }
  }, [
    page,
    limit,
    showRecentUploads,
    searchTerm,
    filterStatus,
    filterStoreId,
    filterLocation,
    filterCondition,
    filterManufacturer,
    filterMaintenanceVendor,
    filterReserved,
    filterDisposed,
    filterDuplicate,
    filterModelNumber,
    filterSerialNumber,
    filterMacAddress,
    filterProductName,
    filterTicket,
    filterRfid,
    filterQr,
    filterDateFrom,
    filterDateTo
  ]);

  const fetchStores = useCallback(async () => {
    try {
      if (activeStore && activeStore._id) {
        const response = await api.get(`/stores?parent=${activeStore._id}`);
        setStores(response.data || []);
      } else {
        const response = await api.get('/stores');
        setStores(response.data || []);
      }
    } catch (error) {
      console.error('Error fetching stores:', error);
    }
  }, [activeStore]);
  
  const fetchTechnicians = useCallback(async () => {
    try {
      const response = await api.get('/users');
      setTechnicians(response.data || []);
    } catch (error) {
      setTechnicians([]);
      console.error('Error fetching technicians:', error);
    }
  }, []);

  useEffect(() => {
    fetchStores();
    fetchTechnicians();
    fetchProducts();
  }, [fetchStores, fetchTechnicians, fetchProducts]);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('allowDuplicates', String(allowDup));
    if (selectedProduct) formData.append('product_name', selectedProduct);
    if (bulkLocationId) {
      const loc = stores.find(s => s._id === bulkLocationId);
      if (loc) formData.append('location', loc.name);
    }
    try {
      setManualLoading(true);
      const res = await api.post('/assets/import/preview', formData);
      const preview = res.data?.assets || [];
      setImportPreview(preview);
      setImportStep('preview');
    } catch (error) {
      const data = error.response?.data;
      if (data) {
        alert(data.message || data.error || 'Preview failed');
      } else {
        alert('Preview failed');
      }
      console.error('Bulk import error:', error);
    } finally {
      setManualLoading(false);
    }
  };

  const handleForceAdd = async () => {
    if (!importInfo?.skipped_duplicates?.length) return;
    
    const assetsToAdd = importInfo.skipped_duplicates
      .filter(d => d.asset)
      .map(d => d.asset);
      
    if (assetsToAdd.length === 0) {
      alert('No valid duplicate assets found to add.');
      return;
    }

    openConfirm(
      'Force Import Duplicates',
      `Are you sure you want to add ${assetsToAdd.length} duplicate assets?`,
      async () => {
        try {
          setForceLoading(true);
          const res = await api.post('/assets/bulk', { assets: assetsToAdd });
          alert(res.data.message);
          setImportInfo(null);
          fetchAssets(undefined, { silent: true });
        } catch (error) {
          console.error('Force add error:', error);
          alert(error.response?.data?.message || 'Failed to force add assets');
        } finally {
          setForceLoading(false);
        }
      },
      'warning',
      'Add Duplicates'
    );
  };

  const handleExport = async () => {
    try {
      const response = await api.get('/assets/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'assets.xlsx');
      document.body.appendChild(link);
      link.click();
    } catch (error) {
      console.error(error);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const headers = BULK_ASSET_EXCEL_HEADERS;
      const sample = BULK_ASSET_TEMPLATE_SAMPLE_ROW;
      const wb = XLSX.utils.book_new();
      const wsTemplate = XLSX.utils.aoa_to_sheet([headers]);
      const wsSample = XLSX.utils.aoa_to_sheet([headers, sample]);
      XLSX.utils.book_append_sheet(wb, wsTemplate, 'Template');
      XLSX.utils.book_append_sheet(wb, wsSample, 'Sample');
      XLSX.writeFile(wb, 'assets_import_template.xlsx', { bookType: 'xlsx' });
    } catch (error) {
      console.error('Error downloading template:', error);
      alert(error?.response?.data?.message || error?.message || 'Failed to download template');
    }
  };

  const handleEditClick = async (asset) => {
    setEditingAsset(asset);
    setupEditForm(asset);
  };

  const setupEditForm = (assetToEdit) => {
    const initialStatus = assetToEdit.disposed
      ? 'Disposed'
      : (assetToEdit.reserved ? 'Reserved' : assetToEdit.status);
    const initialCondition = assetToEdit.disposed ? 'Disposed' : (assetToEdit.condition || 'New');
    setFormData({
      name: assetToEdit.name,
      model_number: assetToEdit.model_number,
      serial_number: assetToEdit.serial_number,
      quantity: Number.parseInt(assetToEdit.quantity, 10) > 0 ? Number.parseInt(assetToEdit.quantity, 10) : 1,
      mac_address: assetToEdit.mac_address || '',
      manufacturer: assetToEdit.manufacturer || '',
      ticket_number: assetToEdit.ticket_number || '',
      po_number: assetToEdit.po_number || '',
      vendor_name: assetToEdit.vendor_name || '',
      device_group: assetToEdit.device_group || '',
      inbound_from: assetToEdit.inbound_from || '',
      outbound_to: pickAssetField(assetToEdit, ['outbound_to', 'outboundTo', 'outbound to']),
      expo_tag: pickAssetField(assetToEdit, ['expo_tag', 'expoTag', 'expo tag']),
      abs_code: pickAssetField(assetToEdit, ['abs_code', 'absCode', 'abs code']),
      product_number: pickAssetField(assetToEdit, ['product_number', 'productNumber', 'product number']),
      operating_system: pickAssetField(assetToEdit, ['operating_system', 'operatingSystem', 'operating system']),
      specification: pickAssetField(assetToEdit, ['specification', 'spec']),
      service_tag: pickAssetField(assetToEdit, ['service_tag', 'serviceTag', 'service tag']),
      assign_to_department: pickAssetField(assetToEdit, [
        'assign_to_department',
        'assignToDepartment',
        'assign to department',
        'assign to depratment',
        'assign_to_depratment'
      ]),
      ip_address: assetToEdit.ip_address || '',
      building: assetToEdit.building || '',
      state_comments: assetToEdit.state_comments || '',
      remarks: assetToEdit.remarks || '',
      comments: assetToEdit.comments || '',
      delivered_by_name: assetToEdit.delivered_by_name || '',
      price: assetToEdit.price ?? '',
      rfid: assetToEdit.rfid || '',
      qr_code: assetToEdit.qr_code || '',
      store: assetToEdit.store?._id || assetToEdit.store || '',
      location: assetToEdit.location || '',
      status: initialStatus,
      condition: initialCondition
    });

    const nextCustomValues = {};
    customEditableColumns.forEach((column) => {
      const key = String(column?.key || '').trim();
      if (!key) return;
      let raw = getByPath(assetToEdit, key);
      if ((raw === undefined || raw === null) && !key.includes('.')) {
        raw = assetToEdit?.customFields?.[key];
      }
      nextCustomValues[key] = raw == null ? '' : String(raw);
    });
    setCustomEditValues(nextCustomValues);
    setEditAssignedToId(String(assetToEdit?.assigned_to?._id || assetToEdit?.assigned_to || ''));
    setEditAssignQuantity(Math.max(1, Number.parseInt(assetToEdit?.quantity, 10) > 0 ? Number.parseInt(assetToEdit?.quantity, 10) : 1));
    setEditInstallationLocation(String(assetToEdit?.location || ''));
    setEditNeedGatePass(false);
    setEditGatePassOrigin(String(assetToEdit?.location || ''));
    setEditGatePassDestination('');
    setEditGatePassJustification('');

    // Populate Hierarchy
    setSelectedProduct(assetToEdit.product_name || '');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const normalized = ['status', 'condition', 'store', 'location', 'quantity', 'price', 'expo_tag', 'abs_code', 'product_number', 'operating_system', 'specification', 'service_tag', 'assign_to_department'].includes(name)
      ? value
      : (typeof value === 'string' ? value.toUpperCase() : value);
    setFormData({ ...formData, [name]: normalized });
  };

  const handleSave = async () => {
    if (!editingAsset || editSaving) return;
    try {
      setEditSaving(true);
      const setNested = (target, path, val) => {
        const parts = String(path || '').split('.').filter(Boolean);
        if (parts.length === 0) return;
        let cursor = target;
        for (let i = 0; i < parts.length - 1; i += 1) {
          const part = parts[i];
          if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
          cursor = cursor[part];
        }
        cursor[parts[parts.length - 1]] = val;
      };

      const customFieldsPayload = {};
      Object.entries(customEditValues || {}).forEach(([rawKey, rawValue]) => {
        const key = String(rawKey || '').trim();
        if (!key) return;
        const value = rawValue == null ? '' : String(rawValue);
        if (key.startsWith('customFields.')) {
          setNested(customFieldsPayload, key.replace(/^customFields\./, ''), value);
          return;
        }
        if (key.includes('.')) return; // avoid mutating nested protected paths
        customFieldsPayload[key] = value;
      });

      const updateData = { 
        ...formData,
        product_name: selectedProduct,
        customFields: customFieldsPayload
      };
      const markDisposed = formData.status === 'Disposed' || formData.condition === 'Disposed';
      const markReserved = formData.status === 'Reserved';
      const markUnderRepair = formData.status === 'Under Repair/Workshop';
      if (markDisposed) {
        updateData.disposed = true;
        updateData.reserved = false;
        updateData.status = 'In Store';
        updateData.condition = 'Faulty';
      } else if (editingAsset?.disposed) {
        updateData.disposed = false;
      }
      if (!markDisposed) {
        updateData.reserved = markReserved;
        if (markReserved) {
          updateData.status = 'In Store';
        }
        if (markUnderRepair) {
          updateData.status = 'Under Repair/Workshop';
          updateData.condition = 'Under Repair/Workshop';
        }
      }

      // Remove empty store to prevent CastError
      if (!updateData.store) {
        delete updateData.store;
      }

      const res = await api.put(`/assets/${editingAsset._id}`, updateData);
      let updated = res.data;

      const selectedTechId = String(editAssignedToId || '').trim();
      const currentAssignedId = String(updated?.assigned_to?._id || updated?.assigned_to || '');
      const hasExternalAssignee = Boolean(updated?.assigned_to_external?.name);
      const shouldUnassign = (!selectedTechId && (currentAssignedId || hasExternalAssignee))
        || (selectedTechId && currentAssignedId && currentAssignedId !== selectedTechId)
        || (selectedTechId && hasExternalAssignee);

      if (shouldUnassign) {
        updated = await api.post('/assets/unassign', { assetId: editingAsset._id }).then((r) => r.data);
      }

      if (selectedTechId && String(updated?.assigned_to?._id || updated?.assigned_to || '') !== selectedTechId) {
        if (updated?.reserved === true || String(updated?.condition || '').trim().toLowerCase() === 'faulty') {
          throw new Error('Cannot assign: asset is faulty or reserved.');
        }
        const selectedTech = (technicians || []).find((t) => String(t?._id) === selectedTechId);
        const targetEmail = String(selectedTech?.email || '').trim();
        if (!targetEmail) {
          throw new Error('Selected technician has no email. Cannot assign from Edit form.');
        }
        const availableQty = Math.max(1, Number.parseInt(updated?.quantity, 10) > 0 ? Number.parseInt(updated?.quantity, 10) : 1);
        const qtyToAssign = Number.parseInt(editAssignQuantity, 10);
        if (!Number.isFinite(qtyToAssign) || qtyToAssign <= 0 || qtyToAssign > availableQty) {
          throw new Error(`Assign quantity must be between 1 and ${availableQty}.`);
        }
        if (!String(editInstallationLocation || '').trim()) {
          setEditInstallationLocationError('Installation location is required for technician assignment.');
          throw new Error('Installation location is required for technician assignment.');
        }
        setEditInstallationLocationError('');
        if (editNeedGatePass && !String(formData.ticket_number || '').trim()) {
          throw new Error('Ticket number is required when gate pass is enabled.');
        }
        const finalOrigin = String(editGatePassOrigin || formData.location || updated?.location || '').trim();
        const finalDestination = String(editGatePassDestination || selectedTech?.name || '').trim();
        if (editNeedGatePass && (!finalOrigin || !finalDestination)) {
          throw new Error('Gate pass "Moving From" and "Moving To" are required.');
        }
        const assignRes = await api.post('/assets/assign', {
          assetId: editingAsset._id,
          assetIds: [editingAsset._id],
          assignQuantity: qtyToAssign,
          technicianId: selectedTechId,
          recipientEmail: targetEmail,
          recipientPhone: String(selectedTech?.phone || ''),
          ticketNumber: formData.ticket_number || '',
          installationLocation: String(editInstallationLocation || '').trim(),
          needGatePass: Boolean(editNeedGatePass),
          gatePassOrigin: finalOrigin,
          gatePassDestination: finalDestination,
          gatePassJustification: String(editGatePassJustification || '').trim()
        });
        updated = assignRes.data?.asset || updated;
      }

      setEditingAsset(null);
      setEditAssignedToId('');
      setEditAssignQuantity(1);
      setEditInstallationLocation('');
      setEditInstallationLocationError('');
      setEditNeedGatePass(false);
      setEditGatePassOrigin('');
      setEditGatePassDestination('');
      setEditGatePassJustification('');
      setAssets(prev => prev.map(a => a._id === updated._id ? { ...a, ...updated } : a));
      fetchAssets(undefined, { silent: true });
      fetchProducts();
      alert('Asset updated successfully');
    } catch (error) {
      console.error('Error updating asset:', error);
      alert(error?.response?.data?.message || error?.message || 'Failed to update asset');
    } finally {
      setEditSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingAsset(null);
    setCustomEditValues({});
    setEditAssignedToId('');
    setEditAssignQuantity(1);
    setEditInstallationLocation('');
    setEditInstallationLocationError('');
    setEditNeedGatePass(false);
    setEditGatePassOrigin('');
    setEditGatePassDestination('');
    setEditGatePassJustification('');
  };
  
  const handleAddChange = (e) => {
    const { name, value } = e.target;
    const normalized = ['status', 'condition', 'store', 'location', 'expo_tag', 'abs_code', 'product_number', 'operating_system', 'specification', 'service_tag', 'assign_to_department'].includes(name)
      ? value
      : (typeof value === 'string' ? value.toUpperCase() : value);
    setAddForm({ ...addForm, [name]: normalized });
  };
  const handleAddSubmit = async () => {
    // Validate required fields (Store is optional now)
    if (!addForm.name || !addForm.serial_number) {
      alert('Please fill required fields (Name/Type, Serial)');
      return;
    }
    try {
      setAddLoading(true);
      const payload = {
        ...addForm,
        product_name: selectedProduct
      };
      const selectedLocation = stores.find(
        (s) => String(s?.name || '').toLowerCase() === String(payload.location || '').toLowerCase()
      );
      if (selectedLocation?._id) {
        // Keep asset ownership aligned with selected location for accurate per-location counts.
        payload.store = selectedLocation._id;
      }
      
      // Remove empty store to prevent CastError
      if (!payload.store) {
        delete payload.store;
      }

      const res = await api.post('/assets', payload);
      const created = res.data;
      setAddForm({
        name: '',
        model_number: '',
        serial_number: '',
        quantity: 1,
        mac_address: '',
        manufacturer: '',
        ticket_number: '',
        po_number: '',
        vendor_name: '',
        device_group: '',
        inbound_from: '',
        outbound_to: '',
        expo_tag: '',
        abs_code: '',
        product_number: '',
        operating_system: '',
        specification: '',
        service_tag: '',
        assign_to_department: '',
        ip_address: '',
        building: '',
        state_comments: '',
        remarks: '',
        comments: '',
        price: '',
        store: '',
        location: '',
        status: 'In Store',
        condition: 'New',
        rfid: '',
        qr_code: ''
      });
      setSelectedProduct('');
      setAssets(prev => [created, ...prev]);
      fetchAssets(undefined, { silent: true });
      fetchProducts();
      setShowAddModal(false);
      // Optional: toast style message if desired
    } catch (error) {
      console.error('Error adding asset:', error);
      alert(error?.response?.data?.message || 'Failed to add asset');
    } finally {
      setAddLoading(false);
    }
  };

  const handleAssignClick = (asset, ids = [asset?._id]) => {
    setAssigningAsset(asset);
    setAssigningAssetIds((ids || []).filter(Boolean));
    setAssignForm({
      technicianId: '',
      recipientEmail: '',
      recipientPhone: '',
      assignQuantity: Math.max(1, Number.parseInt(asset?.quantity, 10) > 0 ? Number.parseInt(asset?.quantity, 10) : 1),
      installationLocation: asset?.location || '',
      ticketNumber: '',
      needGatePass: false,
      gatePassOrigin: asset?.location || '',
      gatePassDestination: '',
      gatePassJustification: ''
    });
    setAssignInstallationLocationError('');
    setTechSearch('');
    setShowTechSuggestions(false);
    setRecipientType('Technician');
    setOtherRecipient({ name: '', email: '', phone: '', note: '' });
  };

  const handleAssignSubmit = async () => {
    if (assignSubmitting) return;
    const idsForGuard = (assigningAssetIds.length ? assigningAssetIds : [assigningAsset?._id]).filter(Boolean);
    const resolvedGuard = idsForGuard
      .map((id) => assets.find((a) => String(a._id) === String(id)))
      .filter(Boolean);
    const guardList = resolvedGuard.length ? resolvedGuard : assigningAsset ? [assigningAsset] : [];
    if (recipientType === 'Technician' && guardList.some(cannotIssueToTechnician)) {
      alert('Faulty or reserved assets cannot be issued to technicians.');
      return;
    }
    if (recipientType === 'Technician' && !assignForm.technicianId) {
      alert('Please select a technician');
      return;
    }
    if (recipientType === 'Technician' && !assignForm.recipientEmail) {
      alert('Please enter recipient email for notification');
      return;
    }
    if (recipientType === 'Technician' && !String(assignForm.installationLocation || '').trim()) {
      setAssignInstallationLocationError('Installation location is required for technician assignment.');
      alert('Please enter installation location for technician assignment');
      return;
    }
    setAssignInstallationLocationError('');
    if (recipientType === 'Other') {
      if (!otherRecipient.name) {
        alert('Please enter recipient name');
        return;
      }
      if (!otherRecipient.email) {
        alert('Please enter recipient email for notification');
        return;
      }
    }
    if (assignForm.needGatePass) {
      if (!assignForm.ticketNumber) {
        alert('Ticket number is required when gate pass is enabled');
        return;
      }
      if (!assignForm.gatePassOrigin || !assignForm.gatePassDestination) {
        alert('Please fill gate pass "Moving From" and "Moving To"');
        return;
      }
      if (recipientType === 'Other' && !otherRecipient.phone) {
        alert('Recipient phone is required for external gate pass');
        return;
      }
    }
    if (assigningAssetIds.length <= 1) {
      const availableQty = Math.max(1, Number.parseInt(assigningAsset?.quantity, 10) > 0 ? Number.parseInt(assigningAsset?.quantity, 10) : 1);
      const qtyToAssign = Number.parseInt(assignForm.assignQuantity, 10);
      if (!Number.isFinite(qtyToAssign) || qtyToAssign <= 0 || qtyToAssign > availableQty) {
        alert(`Assign quantity must be between 1 and ${availableQty}`);
        return;
      }
    }
    try {
      setAssignSubmitting(true);
      const payload = {
        assetId: assigningAsset._id,
        assetIds: assigningAssetIds.length > 0 ? assigningAssetIds : [assigningAsset._id],
        assignQuantity: assigningAssetIds.length <= 1 ? assignForm.assignQuantity : undefined,
        ticketNumber: assignForm.ticketNumber,
        installationLocation: assignForm.installationLocation,
        needGatePass: Boolean(assignForm.needGatePass),
        recipientEmail: assignForm.recipientEmail,
        recipientPhone: recipientType === 'Technician' ? assignForm.recipientPhone : otherRecipient.phone,
        gatePassOrigin: assignForm.gatePassOrigin,
        gatePassDestination: assignForm.gatePassDestination,
        gatePassJustification: assignForm.gatePassJustification
      };
      if (recipientType === 'Technician') {
        payload.technicianId = assignForm.technicianId;
      } else {
        payload.otherRecipient = otherRecipient;
      }
      const res = await api.post(`/assets/assign`, payload);
      setAssigningAsset(null);
      setAssigningAssetIds([]);
      fetchAssets(undefined, { silent: true });
      if (res.data?.gatePass?.pass_number) {
        alert(`${res.data?.assignedCount || payload.assetIds.length} asset(s) assigned successfully. Single gate pass created: ${res.data.gatePass.pass_number}`);
      } else {
        alert(`${res.data?.assignedCount || payload.assetIds.length} asset(s) assigned successfully`);
      }
    } catch (error) {
      console.error('Error assigning asset:', error);
      alert(error?.response?.data?.message || error?.message || 'Failed to assign asset');
    } finally {
      setAssignSubmitting(false);
    }
  };

  const handleUnassign = async (asset) => {
    const assigneeName = asset.assigned_to?.name || asset.assigned_to_external?.name || 'External User';
    
    openConfirm(
      'Unassign Asset',
      `Are you sure you want to unassign ${asset.name} from ${assigneeName}?`,
      async () => {
        try {
          await api.post('/assets/unassign', { assetId: asset._id });
          fetchAssets(undefined, { silent: true });
          alert('Asset unassigned successfully');
        } catch (error) {
          console.error('Error unassigning asset:', error);
          alert('Failed to unassign asset');
        }
      },
      'warning',
      'Unassign'
    );
  };

  const handleReserve = async (asset) => {
    if (reserveBusy) return;
    openConfirm(
      'Reserve Asset',
      `Reserve ${asset.name}? Reserved assets cannot be issued to technicians.`,
      async () => {
        try {
          setReserveBusy(true);
          await api.post('/assets/reserve', { assetId: asset._id });
          fetchAssets(undefined, { silent: true });
          alert('Asset reserved successfully');
        } catch (error) {
          console.error('Error reserving asset:', error);
          alert(error?.response?.data?.message || 'Failed to reserve asset');
        } finally {
          setReserveBusy(false);
        }
      },
      'warning',
      'Reserve'
    );
  };

  const handleUnreserve = async (asset) => {
    if (reserveBusy) return;
    openConfirm(
      'Unreserve Asset',
      `Unreserve ${asset.name}?`,
      async () => {
        try {
          setReserveBusy(true);
          await api.post('/assets/unreserve', { assetId: asset._id });
          fetchAssets(undefined, { silent: true });
          alert('Asset unreserved successfully');
        } catch (error) {
          console.error('Error unreserving asset:', error);
          alert(error?.response?.data?.message || 'Failed to unreserve asset');
        } finally {
          setReserveBusy(false);
        }
      },
      'info',
      'Unreserve'
    );
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const toggleSelectAll = () => {
    setSelectedIds(prev => prev.length === assets.length ? [] : assets.map(a => a._id));
  };
  const handleBulkEditSubmit = async () => {
    if (selectedIds.length === 0) return;
    try {
      setBulkLoading(true);
      const updates = {};
      if (bulkForm.status) updates.status = bulkForm.status;
      if (bulkForm.condition) updates.condition = bulkForm.condition;
      if (bulkForm.manufacturer) updates.manufacturer = bulkForm.manufacturer;
      if (bulkForm.device_group) updates.device_group = bulkForm.device_group;
      if (bulkForm.inbound_from) updates.inbound_from = bulkForm.inbound_from;
      if (bulkForm.outbound_to) updates.outbound_to = bulkForm.outbound_to;
      if (bulkForm.expo_tag) updates.expo_tag = bulkForm.expo_tag;
      if (bulkForm.abs_code) updates.abs_code = bulkForm.abs_code;
      if (bulkForm.product_number) updates.product_number = bulkForm.product_number;
      if (bulkForm.operating_system) updates.operating_system = bulkForm.operating_system;
      if (bulkForm.specification) updates.specification = bulkForm.specification;
      if (bulkForm.service_tag) updates.service_tag = bulkForm.service_tag;
      if (bulkForm.assign_to_department) updates.assign_to_department = bulkForm.assign_to_department;
      if (bulkForm.ip_address) updates.ip_address = bulkForm.ip_address;
      if (bulkForm.building) updates.building = bulkForm.building;
      if (bulkForm.state_comments) updates.state_comments = bulkForm.state_comments;
      if (bulkForm.remarks) updates.remarks = bulkForm.remarks;
      if (bulkForm.comments) updates.comments = bulkForm.comments;
      // category/product_type removed
      if (bulkForm.product_name) updates.product_name = bulkForm.product_name;
      if (bulkForm.locationId) {
        const loc = stores.find(s => s._id === bulkForm.locationId);
        if (loc) updates.location = loc.name;
      }
      const res = await api.post('/assets/bulk-update', { ids: selectedIds, updates });
      const updated = res.data?.items || [];
      const updatedMap = new Map(updated.map(u => [u._id, u]));
      setAssets(prev => prev.map(a => updatedMap.has(a._id) ? { ...a, ...updatedMap.get(a._id) } : a));
      setShowBulkEditModal(false);
      setSelectedIds([]);
      fetchAssets(undefined, { silent: true });
      fetchProducts();
      alert(res.data?.message || 'Bulk update completed');
    } catch (error) {
      console.error('Bulk update error:', error);
      alert(error.response?.data?.message || 'Bulk update failed');
    } finally {
      setBulkLoading(false);
    }
  };
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    
    openConfirm(
      'Bulk Delete',
      `Delete ${selectedIds.length} selected asset(s)? This cannot be undone.`,
      async () => {
        try {
          setBulkLoading(true);
          const res = await api.post('/assets/bulk-delete', { ids: selectedIds });
          const deletedIds = res.data?.deletedIds || selectedIds;
          setAssets(prev => prev.filter(a => !deletedIds.includes(a._id)));
          setSelectedIds([]);
          fetchAssets(undefined, { silent: true });
          alert(res.data?.message || 'Bulk delete completed');
        } catch (error) {
          console.error('Bulk delete error:', error);
          alert(error.response?.data?.message || 'Bulk delete failed');
        } finally {
          setBulkLoading(false);
        }
      },
      'danger',
      'Delete All'
    );
  };

  const handleDelete = async (id) => {
    openConfirm(
      'Delete Asset',
      'Are you sure you want to delete this asset?',
      async () => {
        try {
          await api.delete(`/assets/${id}`);
          setAssets(prev => prev.filter(a => a._id !== id));
          fetchAssets(undefined, { silent: true });
          alert('Asset deleted successfully');
        } catch (error) {
          console.error('Error deleting asset:', error);
          alert('Failed to delete asset');
        }
      },
      'danger',
      'Delete'
    );
  };

  const getDerivedStatus = (asset) => {
    if (asset?.reserved === true) return { label: 'Reserved', color: 'bg-amber-50 text-amber-800 border border-amber-200' };
    if (asset?.disposed === true) return { label: 'Disposed', color: 'bg-slate-100 text-slate-700 border border-slate-300' };
    const s = asset.status;
    const cond = String(asset.condition || '').toLowerCase();
    // Status should reflect the explicit status field first.
    if (s === 'Under Repair/Workshop' || s === 'Under Repair') {
      return { label: 'Under Repair/Workshop', color: 'bg-orange-700 text-orange-50 border border-orange-800' };
    }
    if (s === 'In Use') return { label: 'In Use', color: 'bg-emerald-50 text-emerald-700 border border-emerald-100' };
    if (s === 'In Store') return { label: 'In Store', color: 'bg-sky-50 text-sky-700 border border-sky-100' };
    if (s === 'Missing') return { label: 'Missing', color: 'bg-orange-50 text-orange-700 border border-orange-100' };
    // Fallbacks for legacy/edge rows with unusual status values.
    if (cond.includes('faulty')) return { label: 'Faulty', color: 'bg-rose-50 text-rose-700 border border-rose-100' };
    if (cond.includes('repair')) return { label: 'Repaired', color: 'bg-orange-50 text-orange-700 border border-orange-100' };
    return { label: s || '-', color: 'bg-slate-100 text-slate-700 border border-slate-200' };
  };

  // Debounced filter/search effect
  useEffect(() => {
    const t = setTimeout(() => {
      const hasAnyActiveFilter = Boolean(
        showRecentUploads ||
        searchTerm ||
        filterLocation ||
        filterStatus ||
        filterCondition ||
        filterManufacturer ||
        (isScyStoreContext && filterMaintenanceVendor) ||
        filterReserved ||
        filterModelNumber ||
        filterSerialNumber ||
        filterMacAddress ||
        filterProductName ||
        filterTicket ||
        filterRfid ||
        filterQr ||
        filterDateFrom ||
        filterDateTo
      );

      if (!hasHydratedFiltersRef.current) {
        hasHydratedFiltersRef.current = true;
        // If URL/query preloads filters (e.g. /assets?status=Missing),
        // run the first filtered fetch immediately instead of skipping it.
        if (!hasAnyActiveFilter) return;
      }
      if (page !== 1) {
        setPage(1); // This will trigger the page effect
      } else {
        fetchAssets(); // Directly fetch if already on page 1
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRecentUploads, searchTerm, filterLocation, filterStatus, filterCondition, filterManufacturer, filterMaintenanceVendor, filterReserved, filterDisposed, filterDuplicate, isScyStoreContext, filterModelNumber, filterSerialNumber, filterMacAddress, filterProductName, filterTicket, filterRfid, filterQr, filterDateFrom, filterDateTo]);

  // Page/Limit change effect
  useEffect(() => {
    fetchAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit]);

  useEffect(() => {
    return () => {
      if (activeControllerRef.current) {
        activeControllerRef.current.abort();
      }
    };
  }, []);

  const columnDefinitionMap = useMemo(() => {
    return new Map((columnDefinitions || []).map((column) => [column.id, column]));
  }, [columnDefinitions]);

  const customEditableColumns = useMemo(() => {
    const candidates = (columnDefinitions || []).filter((column) => {
      const key = String(column?.key || '').trim();
      if (!key || key === 'action') return false;
      if (NON_EDITABLE_CUSTOM_KEYS.has(key)) return false;
      if (key.includes('.') && !key.startsWith('customFields.')) return false;
      if (!isScyStoreContext && isMaintenanceVendorColumn(column)) return false;
      return !KNOWN_EDIT_KEYS.has(key);
    });
    // Store config can add a second column for the same field (e.g. key `customFields.maintenance_vendor`
    // alongside builtin `maintenance_vendor`); both write to customFields.maintenance_vendor — keep one UI.
    const maintCols = candidates.filter((c) => isMaintenanceVendorColumn(c));
    if (maintCols.length <= 1) return candidates;
    const maintenanceVendorColScore = (c) => {
      const k = String(c?.key || '').trim();
      if (String(c?.id) === 'maintenanceVendor') return 4;
      if (k === 'maintenance_vendor') return 3;
      if (k === 'customFields.maintenance_vendor') return 2;
      return 1;
    };
    const keepMaint = maintCols.reduce((best, c) =>
      (maintenanceVendorColScore(c) > maintenanceVendorColScore(best) ? c : best), maintCols[0]);
    return candidates.filter((c) => !isMaintenanceVendorColumn(c) || c === keepMaint);
  }, [columnDefinitions, isScyStoreContext]);

  function isMaintenanceVendorColumn(column) {
    const key = String(column?.key || '').trim().toLowerCase();
    const label = String(column?.label || '').trim().toLowerCase();
    const normalizedKey = key.replace(/[^a-z0-9]/g, '');
    return (
      normalizedKey.includes('maintenancevendor')
      || normalizedKey.includes('maintenancevandor')
      || label.includes('maintenance vendor')
      || label.includes('maintenance vandor')
    );
  }

  const columnMeta = useMemo(() => ({
    uniqueId: { label: 'Unique ID', thClass: 'hidden lg:table-cell', tdClass: 'hidden lg:table-cell font-mono text-xs text-gray-600' },
    expoTag: { label: 'Expo Tag', thClass: 'hidden lg:table-cell', tdClass: 'hidden lg:table-cell text-xs' },
    absCode: { label: 'ABS Code', thClass: 'hidden lg:table-cell', tdClass: 'hidden lg:table-cell text-xs' },
    name: { label: 'Name', thClass: '', tdClass: 'text-sm' },
    model: { label: 'Model', thClass: 'hidden md:table-cell', tdClass: 'hidden md:table-cell text-sm' },
    productNumber: { label: 'Product Number', thClass: 'hidden lg:table-cell', tdClass: 'hidden lg:table-cell text-xs' },
    operatingSystem: { label: 'Operating System', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    specification: { label: 'Specification', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    serviceTag: { label: 'Service Tag', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    assignToDepartment: { label: 'Assign To Department', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    serial: { label: 'Serial', thClass: '', tdClass: 'text-sm' },
    serialLast4: { label: 'Serial Last 4', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    ticket: { label: 'Ticket', thClass: 'hidden lg:table-cell', tdClass: 'hidden lg:table-cell text-sm' },
    poNumber: { label: 'PO Number', thClass: 'hidden lg:table-cell', tdClass: 'hidden lg:table-cell text-sm' },
    mac: { label: 'MAC Address', thClass: 'hidden lg:table-cell', tdClass: 'hidden lg:table-cell text-sm' },
    rfid: { label: 'RFID', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    qr: { label: 'QR Code', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    manufacturer: { label: 'Manufacturer', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-sm' },
    condition: { label: 'Condition', thClass: 'hidden lg:table-cell', tdClass: 'hidden lg:table-cell text-sm' },
    status: { label: 'Status', thClass: '', tdClass: 'text-sm font-medium text-slate-700' },
    prevStatus: { label: 'Prev Status', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    store: { label: 'Store', thClass: 'hidden sm:table-cell', tdClass: 'hidden sm:table-cell text-sm' },
    location: { label: 'Location', thClass: 'hidden md:table-cell', tdClass: 'hidden md:table-cell text-sm' },
    quantity: { label: 'Quantity', thClass: 'hidden lg:table-cell', tdClass: 'hidden lg:table-cell text-sm' },
    vendor: { label: 'Vendor', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    source: { label: 'Source', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    deliveredBy: { label: 'Delivered By', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    deliveredAt: { label: 'Delivered At', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    assignedTo: { label: 'Assigned To', thClass: 'hidden md:table-cell', tdClass: 'hidden md:table-cell text-sm' },
    dateTime: { label: 'Date & Time', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-sm' },
    price: { label: 'Price', thClass: 'hidden lg:table-cell', tdClass: 'hidden lg:table-cell text-sm' },
    deviceGroup: { label: 'Device Group', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    inboundFrom: { label: 'Inbound From', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    outboundTo: { label: 'Outbound To', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    ipAddress: { label: 'IP Address', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    building: { label: 'Building', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    stateComments: { label: 'State Comments', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    remarks: { label: 'Remarks', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    comments: { label: 'Comments', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    maintenanceVendor: { label: 'Maintenance Vendor', thClass: 'hidden xl:table-cell', tdClass: 'hidden xl:table-cell text-xs' },
    action: { label: 'Action', thClass: '', tdClass: 'text-sm' }
  }), []);

  const orderedVisibleColumns = useMemo(() => {
    return columnOrder.filter((key) => {
      const colDef = columnDefinitionMap.get(key);
      if (isMaintenanceVendorColumn(colDef)) return true; // Permanent column
      if (!visibleColumns[key]) return false;
      if (key === 'action' && user?.role === 'Viewer') return false;
      return true;
    });
  }, [columnOrder, visibleColumns, user?.role, columnDefinitionMap]);

  const renderActionCell = (asset, key = 'action') => (
    <td key={key} className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-col gap-1 sm:flex-row justify-center">
        <button
          onClick={() => handleEditClick(asset)}
          className="text-amber-600 hover:text-amber-700 font-medium text-sm md:text-base"
        >
          Edit
        </button>
        <button
          onClick={() => openCommentModal(asset)}
          className="text-sky-600 hover:text-sky-800 font-medium text-sm md:text-base inline-flex items-center gap-1"
          title="Add comment to asset history"
        >
          <MessageSquarePlus size={14} />
          Comment
        </button>
        {asset.quantity > 1 && (
          <button
            onClick={() => handleSplitClick(asset)}
            className="text-purple-600 hover:text-purple-900 font-medium text-sm md:text-base flex items-center gap-1"
            title="Split / Report Faulty"
          >
            <Scissors size={14} />
            Split
          </button>
        )}
        {asset.reserved ? (
          <button
            onClick={() => handleUnreserve(asset)}
            className="text-amber-700 hover:text-amber-900 font-medium text-sm md:text-base inline-flex items-center gap-1"
          >
            <LockOpen size={14} />
            Unreserve
          </button>
        ) : (asset.assigned_to || (asset.assigned_to_external && asset.assigned_to_external.name)) ? (
          <button
            onClick={() => handleUnassign(asset)}
            className="text-orange-600 hover:text-orange-900 font-medium text-sm md:text-base"
          >
            Unassign
          </button>
        ) : (
          <button
            onClick={() => handleAssignClick(asset)}
            className="text-green-600 hover:text-green-900 font-medium text-sm md:text-base"
          >
            Assign
          </button>
        )}
        {!asset.reserved && !(asset.assigned_to || (asset.assigned_to_external && asset.assigned_to_external.name)) && (
          <button
            onClick={() => handleReserve(asset)}
            className="text-amber-600 hover:text-amber-800 font-medium text-sm md:text-base inline-flex items-center gap-1"
          >
            <Lock size={14} />
            Reserve
          </button>
        )}
        <button
          onClick={() => handleDelete(asset._id)}
          className="text-red-600 hover:text-red-900 font-medium text-sm md:text-base"
        >
          Delete
        </button>
      </div>
    </td>
  );

  const normalizeMaintenanceVendorKey = (v) =>
    String(v || '')
      .trim()
      .toLowerCase()
      .replace(/[\s\-_.]+/g, '');

  const getMaintenanceVendorValue = (asset = {}) => {
    const fromCustom = asset?.customFields || {};
    const candidates = [
      asset?.maintenance_vendor,
      asset?.maintenanceVendor,
      fromCustom?.maintenance_vendor,
      fromCustom?.maintenance_vandor,
      fromCustom?.maintenanceVendor,
      fromCustom?.['maintenance vendor'],
      fromCustom?.['maintenance vandor']
    ];
    for (const raw of candidates) {
      const value = String(raw || '').trim();
      if (!value) continue;
      const key = normalizeMaintenanceVendorKey(value);
      if (key === 'siemens') return 'Siemens';
      if (key === 'g42') return 'G42';
      return value;
    }
    // Fallback: if vendor_name itself is Siemens/G42, show it in maintenance vendor column.
    const vendorKey = normalizeMaintenanceVendorKey(asset?.vendor_name || '');
    if (vendorKey === 'siemens') return 'Siemens';
    if (vendorKey === 'g42') return 'G42';
    return '-';
  };

  const renderAssetCell = (asset, key) => {
    if (key === 'action') return renderActionCell(asset, key);

    const searchQ = searchTerm.trim();

    let value = '-';
    if (key === 'uniqueId') value = asset.uniqueId || '-';
    if (key === 'expoTag') value = getValueByAliases(asset, ['expo_tag', 'expoTag', 'expo tag']);
    if (key === 'absCode') value = getValueByAliases(asset, ['abs_code', 'absCode', 'abs code']);
    if (key === 'name') value = asset.name || '-';
    if (key === 'model') value = asset.model_number || '-';
    if (key === 'productNumber') value = getValueByAliases(asset, ['product_number', 'productNumber', 'product number']);
    if (key === 'operatingSystem') value = getValueByAliases(asset, ['operating_system', 'operatingSystem', 'operating system']);
    if (key === 'specification') value = getValueByAliases(asset, ['specification', 'spec']);
    if (key === 'serviceTag') value = getValueByAliases(asset, ['service_tag', 'serviceTag', 'service tag']);
    if (key === 'assignToDepartment') {
      value = getValueByAliases(asset, [
        'assign_to_department',
        'assignToDepartment',
        'assign to department',
        'assign to depratment',
        'assign_to_depratment'
      ]);
    }
    if (key === 'serial') value = asset.serial_number || '-';
    if (key === 'serialLast4') value = asset.serial_last_4 || '-';
    if (key === 'ticket') value = asset.ticket_number || '-';
    if (key === 'poNumber') value = asset.po_number || '-';
    if (key === 'mac') value = asset.mac_address || '-';
    if (key === 'rfid') value = asset.rfid || '-';
    if (key === 'qr') value = asset.qr_code || '-';
    if (key === 'manufacturer') value = asset.manufacturer || '-';
    if (key === 'condition') value = asset.condition || 'New / Excellent';
    if (key === 'prevStatus') value = asset.previous_status || '-';
    if (key === 'store') value = (asset.store?.parentStore?.name) || (asset.store?.name) || (activeStore?.name) || '-';
    if (key === 'location') value = asset.location || '-';
    if (key === 'quantity') value = asset.quantity ?? '-';
    if (key === 'vendor') value = asset.vendor_name || '-';
    if (key === 'maintenanceVendor') value = getMaintenanceVendorValue(asset);
    if (key === 'deviceGroup') value = asset.device_group || '-';
    if (key === 'inboundFrom') value = asset.inbound_from || '-';
    if (key === 'outboundTo') value = getValueByAliases(asset, ['outbound_to', 'outboundTo', 'outbound to']);
    if (key === 'ipAddress') value = asset.ip_address || '-';
    if (key === 'building') value = asset.building || '-';
    if (key === 'stateComments') value = asset.state_comments || '-';
    if (key === 'remarks') value = asset.remarks || '-';
    if (key === 'comments') value = asset.comments || '-';
    if (key === 'source') value = asset.source || '-';
    if (key === 'deliveredBy') value = asset.delivered_by_name || '-';
    if (key === 'deliveredAt') value = asset.delivered_at ? new Date(asset.delivered_at).toLocaleString() : '-';
    if (key === 'assignedTo') value = asset.assigned_to?.name || asset.assigned_to_external?.name || '-';
    if (key === 'dateTime') value = asset.updatedAt ? new Date(asset.updatedAt).toLocaleString() : '-';
    if (key === 'price') value = typeof asset.price === 'number' ? `${asset.price.toFixed(2)} AED` : '-';
    if (value === '-' && !columnMeta[key]) {
      const colDef = columnDefinitionMap.get(key);
      const rawValue = colDef?.key ? getByPath(asset, colDef.key) : undefined;
      const fallbackCustomValue = (rawValue === undefined || rawValue === null || rawValue === '')
        && colDef?.key
        && !String(colDef.key).includes('.')
        ? asset?.customFields?.[colDef.key]
        : rawValue;
      if (fallbackCustomValue !== undefined && fallbackCustomValue !== null && fallbackCustomValue !== '') {
        if (fallbackCustomValue instanceof Date) {
          value = fallbackCustomValue.toLocaleString();
        } else if (typeof fallbackCustomValue === 'object') {
          value = Array.isArray(fallbackCustomValue) ? fallbackCustomValue.join(', ') : JSON.stringify(fallbackCustomValue);
        } else {
          value = String(fallbackCustomValue);
        }
      }
      if (value === '-' && isMaintenanceVendorColumn(colDef)) {
        value = getMaintenanceVendorValue(asset);
      }
    }

    if (key === 'status') {
      const derived = getDerivedStatus(asset);
      return (
        <td key={key} className={`px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center ${columnMeta[key]?.tdClass || ''}`}>
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${derived.color}`}>
            {highlightSearchInText(derived.label, searchQ)}
          </span>
        </td>
      );
    }

    if (key === 'condition') {
      const faulty = isConditionFaulty(asset);
      const inner = highlightSearchInText(value, searchQ);
      return (
        <td key={key} className={`px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center ${columnMeta[key]?.tdClass || ''}`}>
          {faulty ? (
            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
              {inner}
            </span>
          ) : (
            inner
          )}
        </td>
      );
    }

    return (
      <td key={key} className={`px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center ${columnMeta[key]?.tdClass || ''}`}>
        {highlightSearchInText(value, searchQ)}
      </td>
    );
  };

  return (
    <div className="min-h-screen bg-app-page text-app-main">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">
          {productParam ? `${productParam} Management` : 'Assets Management'}
        </h1>
        <div className="flex flex-wrap gap-2 items-center">
           {user?.role !== 'Viewer' && (
             <>
               <button 
                 onClick={() => {
                   setSelectedProduct('');
                   setAddForm(prev => ({ ...prev, store: activeStore?._id || prev.store, status: prev.status || 'In Store', condition: prev.condition || 'New' }));
                   setShowAddModal(true);
                 }} 
                 className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
               >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                   <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                 </svg>
                 Add New Asset
               </button>
              <button
                onClick={() => setShowBulkEditModal(true)}
                disabled={selectedIds.length === 0}
                className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-sm shadow-sm ${selectedIds.length === 0 ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                 Bulk Edit ({selectedIds.length})
               </button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.length === 0 || bulkLoading}
                className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-sm shadow-sm ${selectedIds.length === 0 || bulkLoading ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                 {bulkLoading ? 'Deleting…' : `Delete Selected (${selectedIds.length})`}
               </button>
              <button onClick={() => setShowImportModal(true)} className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm">Bulk Import</button>
              <button onClick={handleDownloadTemplate} className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm">Download Sample</button>
             </>
           )}
          <button onClick={handleExport} className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm">Export</button>
        </div>
      </div>
      
      {importInfo && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded mb-4">
          <div>Imported: {importInfo.message}</div>
          {importInfo.warnings && importInfo.warnings.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-sm">Warnings:</div>
              <ul className="text-sm list-disc ml-5">
                {importInfo.warnings.slice(0, 10).map((w, idx) => (
                  <li key={idx}>{String(w)}</li>
                ))}
              </ul>
              {importInfo.warnings.length > 10 && (
                <div className="text-xs text-gray-600 mt-1">and {importInfo.warnings.length - 10} more...</div>
              )}
            </div>
          )}
          {importInfo.skipped_duplicates && importInfo.skipped_duplicates.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-sm">Skipped duplicates:</div>
              <ul className="text-sm list-disc ml-5">
                {importInfo.skipped_duplicates.slice(0, 10).map((d, idx) => (
                  <li key={idx}>{d.serial} — {d.reason}</li>
                ))}
              </ul>
              {importInfo.skipped_duplicates.length > 10 && (
                <div className="text-xs text-gray-600 mt-1">and {importInfo.skipped_duplicates.length - 10} more...</div>
              )}
              <div className="mt-2">
                <button 
                  onClick={handleForceAdd}
                  disabled={forceLoading}
                  className={`px-3 py-1 rounded text-sm shadow-sm text-white ${forceLoading ? 'bg-yellow-400 cursor-not-allowed' : 'bg-yellow-600 hover:bg-yellow-700'}`}
                >
                  {forceLoading ? 'Adding duplicates…' : 'Add These Duplicates Anyway'}
                </button>
              </div>
            </div>
          )}
          {importInfo.invalid_rows && importInfo.invalid_rows.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-sm">Invalid rows:</div>
              <ul className="text-sm list-disc ml-5">
                {importInfo.invalid_rows.slice(0, 10).map((d, idx) => (
                  <li key={idx}>
                    {d.serial || '(no-serial)'} — {d.reason} {d.store ? `(store: ${d.store})` : ''}
                  </li>
                ))}
              </ul>
              {importInfo.invalid_rows.length > 10 && (
                <div className="text-xs text-gray-600 mt-1">and {importInfo.invalid_rows.length - 10} more...</div>
              )}
            </div>
          )}
          {importInfo.updated_rows && importInfo.updated_rows.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-sm">
                Updated existing serials: {importInfo.updated_rows.length}
                {importInfo.totals?.columns_updated ? ` (columns changed: ${importInfo.totals.columns_updated})` : ''}
              </div>
              <ul className="text-sm list-disc ml-5">
                {importInfo.updated_rows.slice(0, 10).map((row, idx) => (
                  <li key={idx}>
                    {row.serial || '(no serial)'} - {(row.changed_fields || []).length} column(s) changed
                  </li>
                ))}
              </ul>
              {importInfo.updated_rows.length > 10 && (
                <div className="text-xs text-gray-600 mt-1">and {importInfo.updated_rows.length - 10} more...</div>
              )}
            </div>
          )}
          {importInfo.import_update_batch_id && (
            <div className="mt-3">
              <div className="text-xs text-gray-700 mb-2">
                Latest reversible import update batch: <span className="font-mono">{importInfo.import_update_batch_id}</span>
                {importInfo.import_update_batch_created_at
                  ? ` at ${new Date(importInfo.import_update_batch_created_at).toLocaleString()}`
                  : ''}
              </div>
              <button
                onClick={handleRevertLastImportUpdates}
                disabled={revertingImport}
                className={`px-3 py-1 rounded text-sm shadow-sm text-white ${revertingImport ? 'bg-red-300 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {revertingImport ? 'Reverting updates...' : 'Revert Last Import Updates'}
              </button>
            </div>
          )}
          <div className="mt-2 text-sm text-gray-600">
            Excel headers supported: Category, Product Type, Product Name, Model Number, Quantity, Serial Number, MAC Address, Manufacturer, Ticket Number, PO Number, Vendor Name, Price, RFID, QR Code, Store Location, Status, Condition, Maintenance Vendor, Device Group, Inbound From, IP Address, Building, State Comments, Remarks, Comments, Delivered By, Delivered At (date & time)
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-2xl relative">
            <h2 className="text-xl font-bold mb-4">Bulk Import Assets</h2>
            {importStep === 'select' && (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Template</label>
                    <div className="flex gap-2">
                      <button onClick={handleDownloadTemplate} className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-2 rounded">Download Sample Sheet</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Default Product (optional)</label>
                    <select
                      value={selectedProduct}
                      onChange={(e) => setSelectedProduct(e.target.value)}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    >
                      <option value="">Select Product</option>
                      {flatProducts.map(p => (
                        <option key={p._id || p.name} value={p.name}>
                            {p.fullPath}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Default Location (optional)</label>
                    <select
                      value={bulkLocationId}
                      onChange={(e) => setBulkLocationId(e.target.value)}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    >
                      <option value="">Select Location</option>
                      {stores.map(s => (
                        <option key={s._id} value={s._id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="allowDup"
                      checked={allowDup}
                      onChange={(e) => setAllowDup(e.target.checked)}
                      disabled={!(user?.role === 'Admin' || user?.role === 'Super Admin')}
                    />
                    <label htmlFor="allowDup" className="text-sm text-gray-700">Allow duplicates in same store (Admin only)</label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Excel File</label>
                    <input type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm" />
                  </div>
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    onClick={() => { setShowImportModal(false); setFile(null); }}
                    className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpload}
                    disabled={manualLoading}
                    className={`text-white px-4 py-2 rounded ${manualLoading ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                  >
                    {manualLoading ? 'Uploading, please wait…' : 'Preview'}
                  </button>
                </div>
              </>
            )}
            {importStep === 'preview' && (
              <>
                <div className="mb-4 text-sm text-gray-700">
                  Previewing {importPreview?.length || 0} assets
                </div>
                <div className="mb-3 text-xs text-gray-600">
                  Duplicate serial rows are highlighted in yellow. They will be blocked unless Admin enables &quot;Allow duplicates in same store&quot;.
                </div>
                <div className="max-h-80 overflow-auto border rounded">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-2 text-left">Name</th>
                        <th className="px-2 py-2 text-left">Model</th>
                        <th className="px-2 py-2 text-left">Serial</th>
                        <th className="px-2 py-2 text-left">Status</th>
                        <th className="px-2 py-2 text-left">Condition</th>
                        <th className="px-2 py-2 text-left">Location</th>
                        <th className="px-2 py-2 text-left">Assigned To</th>
                        <th className="px-2 py-2 text-left">Vendor</th>
                        <th className="px-2 py-2 text-left">Delivered By</th>
                        <th className="px-2 py-2 text-left">Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(importPreview || []).slice(0, 50).map((a, idx) => (
                        <tr key={idx} className={`border-t ${a._duplicateSerial ? 'bg-yellow-100' : ''}`}>
                          <td className="px-2 py-2">{a.name}</td>
                          <td className="px-2 py-2">{a.model_number || '-'}</td>
                          <td className="px-2 py-2">
                            {a.serial_number || '-'}
                            {a._duplicateSerial && (
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-200 text-yellow-900 border border-yellow-300">
                                Duplicate
                              </span>
                            )}
                            {a._duplicateSerial && a._duplicateReason && (
                              <div className="text-[10px] text-yellow-800 mt-1">{a._duplicateReason}</div>
                            )}
                          </td>
                          <td className="px-2 py-2">{a.status || '-'}</td>
                          <td className="px-2 py-2">{a.condition || '-'}</td>
                          <td className="px-2 py-2">{a.location || '-'}</td>
                          <td className="px-2 py-2">{a._assignedToLabel || '-'}</td>
                          <td className="px-2 py-2">{a.vendor_name || '-'}</td>
                          <td className="px-2 py-2">{a.delivered_by_name || '-'}</td>
                          <td className="px-2 py-2">{a.quantity ?? 1}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    onClick={() => { setImportStep('select'); setImportPreview(null); }}
                    className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirmImport}
                    disabled={manualLoading}
                    className={`text-white px-4 py-2 rounded ${manualLoading ? 'bg-green-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                  >
                    {manualLoading ? 'Importing…' : 'Confirm Import'}
                  </button>
                </div>
              </>
            )}
            {manualLoading && (
              <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  <div className="text-sm font-medium text-gray-700">Processing upload, please wait…</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow border border-gray-100 p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-center">
          <input
            type="text"
            placeholder="Search tags, serials, IDs, OS, spec, dept, vendor, store, assignee, history, custom fields…"
            title="Substring search (case ignored) across asset fields, effective maintenance vendor, all custom field values, activity history, external assignee, return/disposal/import metadata, matching technician (User) and store names. r, re, res… also includes Reserved rows. Highlights follow visible columns."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <input
            type="text"
            list="assets-location-options"
            placeholder="All Locations"
            value={filterLocation}
            onChange={(e) => {
              const nextLocation = e.target.value;
              setFilterLocation(nextLocation);
              if (!nextLocation) {
                // If user clears location, clear hidden location-originated store filter too.
                setFilterStoreId('');
                if (location.search) {
                  navigate('/assets', { replace: true });
                }
              }
            }}
            className="h-10 px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <datalist id="assets-location-options">
            {stores.map((s) => (
              <option key={s._id} value={s.name} />
            ))}
          </datalist>
          <select
            value={filterCondition}
            onChange={(e) => setFilterCondition(e.target.value)}
            className="h-10 px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">All Conditions</option>
            <option value="New">New</option>
            <option value="Used">Used</option>
            <option value="Faulty">Faulty</option>
            <option value="Repaired">Repaired</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-10 px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="In Store">In Store</option>
            <option value="In Use">In Use</option>
            <option value="Missing">Missing</option>
            <option value="Reserved">Reserved</option>
            <option value="Disposed">Disposed</option>
            <option value="Under Repair/Workshop">Under Repair/Workshop</option>
          </select>
          <select
            value={filterDuplicate}
            onChange={(e) => setFilterDuplicate(e.target.value)}
            className="h-10 px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">All Assets</option>
            <option value="true">Duplicates Only</option>
          </select>
          {isScyStoreContext && (
            <select
              value={filterMaintenanceVendor}
              onChange={(e) => setFilterMaintenanceVendor(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">All Vendors</option>
              <option value="Siemens">Siemens</option>
              <option value="G42">G42</option>
            </select>
          )}
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4 items-center">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 shadow-sm"
            >
              <Filter className="w-4 h-4" />
              {showAdvancedFilters ? 'Hide Filters' : 'Filters'}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowColumnMenu(v => !v)}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Columns
              </button>
              {showColumnMenu && (
                <div className="absolute z-20 mt-2 right-0 bg-white border border-gray-200 shadow-xl rounded-lg p-3 w-64 max-h-72 overflow-auto">
                  <p className="text-[11px] text-slate-500 mb-2">Drag to reorder columns</p>
                  <button
                    type="button"
                    onClick={() => { handleSaveColumnLayout(); }}
                    disabled={savingColumnPrefs || !user?._id}
                    className="mb-2 w-full text-xs font-medium py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingColumnPrefs ? 'Saving…' : 'Save layout to my account'}
                  </button>
                  {columnOrder.map((key) => {
                    const label = columnDefinitionMap.get(key)?.label || key;
                    return (
                      <div
                        key={key}
                        draggable
                        onDragStart={() => setDragColumnKey(key)}
                        onDragEnd={() => setDragColumnKey('')}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          moveColumnOrder(dragColumnKey, key);
                          setDragColumnKey('');
                        }}
                        className="flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-gray-50 cursor-move"
                      >
                        <GripVertical className="w-4 h-4 text-slate-400" />
                        <input
                          type="checkbox"
                          checked={isMaintenanceVendorColumn(columnDefinitionMap.get(key)) ? true : visibleColumns[key]}
                          disabled={isMaintenanceVendorColumn(columnDefinitionMap.get(key))}
                          onChange={(e) => {
                            if (isMaintenanceVendorColumn(columnDefinitionMap.get(key))) return;
                            setVisibleColumns(prev => ({ ...prev, [key]: e.target.checked }));
                          }}
                        />
                        <span>{label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowRecentUploads(prev => !prev)}
              className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl border shadow-sm ${showRecentUploads ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
              title="Show only the most recently uploaded assets"
            >
              <Clock className="w-4 h-4" />
              Recent Uploads
            </button>
            <button
              onClick={() => {
                setSearchTerm(''); setFilterLocation(''); setFilterStatus(''); setFilterCondition('');
                setFilterStoreId('');
                setFilterManufacturer(''); setFilterMaintenanceVendor(''); setFilterProductName('');
                setFilterReserved('');
                setFilterDisposed('');
                setFilterDuplicate('');
                setFilterModelNumber(''); setFilterSerialNumber(''); setFilterMacAddress('');
                setFilterTicket(''); setFilterRfid(''); setFilterQr('');
                setFilterDateFrom(''); setFilterDateTo('');
                setShowRecentUploads(false);
                if (location.search) {
                  navigate('/assets', { replace: true });
                }
              }}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              <RotateCcw className="w-4 h-4" />
              Clear
            </button>
            <button
              onClick={handleExportSelected}
              disabled={selectedIds.length === 0}
              className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm shadow-sm ${selectedIds.length === 0 ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'} border`}
              title="Download selected rows as Excel"
            >
              <Download className="w-4 h-4" />
              Download Selected
            </button>
            <div className="ml-auto flex gap-2">
              {user?.role !== 'Viewer' && (
                <>
                  <button
                    onClick={handleTopEdit}
                    disabled={selectedIds.length === 0}
                    className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm shadow-sm ${selectedIds.length === 0 ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'} border`}
                    title="Edit selected (single = Edit; multiple = Bulk Edit)"
                  >
                    <Edit size={16} />
                    {selectedIds.length > 1 ? 'Bulk Edit' : 'Edit'}
                  </button>
                  <button
                    onClick={handleTopAssign}
                disabled={topAssignDisabled}
                className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm shadow-sm ${topAssignDisabled ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'} border`}
                title={topAssignDisabled && selectedIds.length > 0 ? 'Faulty or reserved assets cannot be issued to technicians' : 'Assign selected asset(s)'}
                  >
                    <UserCheck size={16} />
                {selectedIds.length > 1 ? 'Bulk Assign' : 'Assign'}
                  </button>
                  <button
                    onClick={handleTopReserve}
                    disabled={selectedIds.length === 0 || topReserveBusy}
                    className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm shadow-sm ${selectedIds.length === 0 || topReserveBusy ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed' : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'} border`}
                    title="Reserve selected assets"
                  >
                    <Lock size={16} />
                    {topReserveBusy ? 'Working...' : 'Reserve'}
                  </button>
                  <button
                    onClick={handleTopUnreserve}
                    disabled={selectedIds.length === 0 || topReserveBusy}
                    className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm shadow-sm ${selectedIds.length === 0 || topReserveBusy ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed' : 'border-amber-200 bg-white text-amber-800 hover:bg-amber-50'} border`}
                    title="Unreserve selected assets"
                  >
                    <LockOpen size={16} />
                    {topReserveBusy ? 'Working...' : 'Unreserve'}
                  </button>
                  <button
                    onClick={handleTopDelete}
                    disabled={selectedIds.length === 0}
                    className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm shadow-sm ${selectedIds.length === 0 ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'} border`}
                    title="Delete selected"
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {showAdvancedFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3 pt-3 border-t border-gray-100">
            <input
              type="text"
              placeholder="Manufacturer"
              value={filterManufacturer}
              onChange={(e) => setFilterManufacturer(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <select
              value={filterReserved}
              onChange={(e) => setFilterReserved(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">Reserved: All</option>
              <option value="true">Reserved Only</option>
              <option value="false">Non-Reserved</option>
            </select>
            {isScyStoreContext && (
              <select
                value={filterMaintenanceVendor}
                onChange={(e) => setFilterMaintenanceVendor(e.target.value)}
                className="h-10 px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="">Maintenance Vendor</option>
                {MAINTENANCE_VENDOR_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            )}
            <input
              type="text"
              placeholder="Model Number"
              value={filterModelNumber}
              onChange={(e) => setFilterModelNumber(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="Serial Number"
              value={filterSerialNumber}
              onChange={(e) => setFilterSerialNumber(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="MAC Address"
              value={filterMacAddress}
              onChange={(e) => setFilterMacAddress(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            {/* Product Type filter removed */}
            <input
              type="text"
              placeholder="Product Name"
              value={filterProductName}
              onChange={(e) => setFilterProductName(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="Ticket Number"
              value={filterTicket}
              onChange={(e) => setFilterTicket(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="RFID"
              value={filterRfid}
              onChange={(e) => setFilterRfid(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="QR Code"
              value={filterQr}
              onChange={(e) => setFilterQr(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-10">From:</span>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="h-10 px-3 border border-gray-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-10">To:</span>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="h-10 px-3 border border-gray-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Loading Indicator */}
      {loading && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 text-center text-slate-500">
          Loading assets...
        </div>
      )}

      {/* Desktop Table View — scroll X/Y inside card; wide tables get a horizontal scrollbar */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-auto max-h-[min(72vh,calc(100dvh-14rem))] overscroll-contain [scrollbar-gutter:stable]">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              {user?.role !== 'Viewer' && (
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 md:px-4 md:py-3 text-center shadow-[inset_0_-1px_0_0_rgb(226,232,240)]">
                  <input onClick={(e) => e.stopPropagation()} type="checkbox" checked={selectedIds.length === assets.length && assets.length > 0} onChange={toggleSelectAll} />
                </th>
              )}
              {orderedVisibleColumns.map((key) => (
                <th
                  key={key}
                  className={`sticky top-0 z-20 bg-slate-50 px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap shadow-[inset_0_-1px_0_0_rgb(226,232,240)] ${columnMeta[key]?.thClass || ''}`}
                >
                  {columnDefinitionMap.get(key)?.label || columnMeta[key]?.label || key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-100">
            {displayedAssets.map((asset) => (
              <tr key={asset._id} className={`hover:bg-slate-50 ${asset.isDuplicate ? 'bg-yellow-50' : ''} cursor-pointer`} onClick={() => window.open(`/asset/${asset._id}`, '_blank')}>
                {user?.role !== 'Viewer' && (
                  <td className="px-3 py-2 md:px-4 md:py-4 text-center" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.includes(asset._id)} onChange={() => toggleSelect(asset._id)} />
                  </td>
                )}
                {orderedVisibleColumns.map((key) => renderAssetCell(asset, key))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-4 mb-4 max-h-[min(72vh,calc(100dvh-12rem))] overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
        {displayedAssets.map((asset) => (
          <div key={asset._id} className={`bg-white p-4 rounded-lg shadow-sm border ${asset.isDuplicate ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200'}`} onClick={() => window.open(`/asset/${asset._id}`, '_blank')}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="font-bold text-gray-900 text-base">{asset.name}</h3>
                <p className="text-xs text-gray-500 font-mono mt-0.5">{asset.uniqueId || '-'}</p>
              </div>
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full 
                ${(() => {
                  const { color } = getDerivedStatus(asset);
                  return color;
                })()}`}>
                {getDerivedStatus(asset).label}
              </span>
            </div>
            
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-gray-700 mb-4">
              {/* Category removed */}
              <div>
                <span className="text-xs text-gray-500 block">Model</span>
                <span className="font-medium">{asset.model_number}</span>
              </div>
              <div className="col-span-2">
                <span className="text-xs text-gray-500 block">Condition</span>
                {isConditionFaulty(asset) ? (
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                    {asset.condition || 'Faulty'}
                  </span>
                ) : (
                  <span className="font-medium">{asset.condition || 'New / Excellent'}</span>
                )}
              </div>
              <div className="col-span-2">
                <span className="text-xs text-gray-500 block">Status</span>
                <span className="font-medium">{asset.status || '-'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-xs text-gray-500 block">Serial</span>
                <span className="font-mono font-medium">{asset.serial_number}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Store</span>
                <span className="font-medium">{(asset.store?.parentStore?.name) || (asset.store?.name) || (activeStore?.name) || '-'}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Location</span>
                <span className="font-medium">{asset.location || '-'}</span>
              </div>
               <div>
                <span className="text-xs text-gray-500 block">Ticket</span>
                <span className="font-medium">{asset.ticket_number || '-'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-xs text-gray-500 block">Assigned To</span>
                <span className="font-medium">{asset.assigned_to?.name || asset.assigned_to_external?.name || '-'}</span>
              </div>
            </div>

            {user?.role !== 'Viewer' && (
              <div className="flex gap-3 pt-3 border-t border-gray-100">
                <button 
                  onClick={(e) => { e.stopPropagation(); handleEditClick(asset); }}
                  className="flex-1 flex items-center justify-center gap-2 bg-gray-50 text-gray-700 py-2 rounded-md text-sm font-medium hover:bg-gray-100 transition-colors border border-gray-200"
                >
                  <Edit size={16} /> Edit
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); openCommentModal(asset); }}
                  className="flex-1 flex items-center justify-center gap-2 bg-sky-50 text-sky-700 py-2 rounded-md text-sm font-medium hover:bg-sky-100 transition-colors border border-sky-200"
                >
                  <MessageSquarePlus size={16} /> Comment
                </button>
                {user?.role !== 'Viewer' && asset.quantity > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSplitClick(asset); }}
                    className="flex-none flex items-center justify-center bg-purple-50 text-purple-700 p-2 rounded-md hover:bg-purple-100 transition-colors border border-purple-200"
                    aria-label="Split"
                  >
                    <Scissors size={16} />
                  </button>
                )}
                {asset.reserved ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleUnreserve(asset); }}
                    disabled={reserveBusy}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors border ${reserveBusy ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-200'}`}
                  >
                    <LockOpen size={16} /> Unreserve
                  </button>
                ) : (asset.assigned_to || (asset.assigned_to_external && asset.assigned_to_external.name)) ? (
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleUnassign(asset); }}
                    className="flex-1 flex items-center justify-center gap-2 bg-orange-50 text-orange-700 py-2 rounded-md text-sm font-medium hover:bg-orange-100 transition-colors border border-orange-200"
                  >
                    <UserX size={16} /> Unassign
                  </button>
                ) : (
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleAssignClick(asset); }}
                    className="flex-1 flex items-center justify-center gap-2 bg-green-50 text-green-700 py-2 rounded-md text-sm font-medium hover:bg-green-100 transition-colors border border-green-200"
                  >
                    <UserCheck size={16} /> Assign
                  </button>
                )}
                {!asset.reserved && !(asset.assigned_to || (asset.assigned_to_external && asset.assigned_to_external.name)) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleReserve(asset); }}
                    disabled={reserveBusy}
                    className={`flex-none flex items-center justify-center p-2 rounded-md transition-colors border ${reserveBusy ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-200'}`}
                    aria-label="Reserve"
                  >
                    <Lock size={16} />
                  </button>
                )}
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDelete(asset._id); }}
                  className="flex-none flex items-center justify-center bg-red-50 text-red-700 p-2 rounded-md hover:bg-red-100 transition-colors border border-red-200"
                  aria-label="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination Controls */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row items-center justify-between gap-4 mt-4">
          <div className="text-sm text-slate-600">
            Showing {(total === 0) ? 0 : ((page - 1) * limit + 1)}–
            {Math.min(page * limit, total)} of {total}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={limit}
              onChange={(e) => { setLimit(parseInt(e.target.value, 10)); setPage(1); }}
              className="border border-slate-200 p-2 rounded-xl text-sm"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button
              onClick={() => { if (page > 1) { setPage(page - 1); } }}
              disabled={page <= 1}
              className="px-3 py-2 border border-slate-200 rounded-xl disabled:opacity-50"
            >
              Prev
            </button>
            <button
              onClick={() => { const maxPage = Math.ceil(total / limit) || 1; if (page < maxPage) { setPage(page + 1); } }}
              disabled={page >= (Math.ceil(total / limit) || 1)}
              className="px-3 py-2 border border-slate-200 rounded-xl disabled:opacity-50"
            >
              Next
            </button>
            <button
              onClick={handleExportSelected}
              disabled={selectedIds.length === 0}
              className={`px-3 py-2 rounded-xl text-sm ${selectedIds.length === 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
              title="Download selected rows as Excel"
            >
              Download Selected
            </button>
          </div>
        </div>

      {/* Assign Modal — wide landscape layout so fields fit without tall narrow scrolling */}
      {assigningAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-600/50 p-3 sm:p-4">
          <div
            role="dialog"
            aria-labelledby="assign-asset-title"
            className="flex max-h-[min(92vh,56rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
          >
            <div className="shrink-0 border-b border-gray-200 px-5 py-4">
              <h2 id="assign-asset-title" className="text-xl font-bold text-gray-900">
                Assign Asset
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Assigning {assigningAssetIds.length || 1} asset(s)
                {assigningAsset ? (
                  <>
                    : <span className="font-semibold text-gray-800">{assigningAsset.name}</span>{' '}
                    <span className="font-mono text-gray-700">({assigningAsset.serial_number})</span>
                  </>
                ) : null}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-x-10 lg:items-start">
                {/* Left column: recipient + primary picker */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Recipient Type</label>
                    <div className="mt-1 flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="recipientType"
                          checked={recipientType === 'Technician'}
                          onChange={() => setRecipientType('Technician')}
                        />
                        Technician
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="recipientType"
                          checked={recipientType === 'Other'}
                          onChange={() => setRecipientType('Other')}
                        />
                        Other Person
                      </label>
                    </div>
                  </div>

                  {recipientType === 'Technician' && (
                    <div className="relative">
                      <label className="block text-sm font-medium text-gray-700">Technician</label>
                      <input
                        type="text"
                        value={techSearch}
                        onChange={(e) => {
                          setTechSearch(e.target.value);
                          setShowTechSuggestions(true);
                          setAssignForm((prev) => ({ ...prev, technicianId: '' }));
                        }}
                        onFocus={() => setShowTechSuggestions(true)}
                        placeholder="Search by name, username or phone"
                        className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                      />
                      {showTechSuggestions && (
                        <div className="absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg">
                          {technicians.filter(
                            (t) =>
                              (t.name || '').toLowerCase().includes(techSearch.toLowerCase()) ||
                              (t.username || '').toLowerCase().includes(techSearch.toLowerCase()) ||
                              (t.phone || '').includes(techSearch)
                          ).length > 0 ? (
                            technicians
                              .filter(
                                (t) =>
                                  (t.name || '').toLowerCase().includes(techSearch.toLowerCase()) ||
                                  (t.username || '').toLowerCase().includes(techSearch.toLowerCase()) ||
                                  (t.phone || '').includes(techSearch)
                              )
                              .map((tech) => (
                                <div
                                  key={tech._id}
                                  onClick={() => {
                                    setAssignForm((prev) => ({
                                      ...prev,
                                      technicianId: tech._id,
                                      recipientEmail: tech.email || '',
                                      recipientPhone: tech.phone || '',
                                      gatePassDestination: prev.gatePassDestination || tech.name || ''
                                    }));
                                    setTechSearch(tech.name);
                                    setShowTechSuggestions(false);
                                  }}
                                  className="cursor-pointer border-b p-2 last:border-b-0 hover:bg-amber-50"
                                >
                                  <div className="font-medium">{tech.name}</div>
                                  <div className="text-xs text-gray-500">
                                    {tech.username} {tech.phone ? `| ${tech.phone}` : ''}
                                  </div>
                                </div>
                              ))
                          ) : (
                            <div className="p-2 text-sm text-gray-500">No technicians found</div>
                          )}
                        </div>
                      )}
                      {assignForm.technicianId && (
                        <div className="mt-1 text-xs text-green-600">✓ Technician selected</div>
                      )}
                    </div>
                  )}

                  {recipientType === 'Other' && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700">Recipient Name</label>
                        <input
                          type="text"
                          value={otherRecipient.name}
                          onChange={(e) => {
                            const nextName = e.target.value;
                            setOtherRecipient({ ...otherRecipient, name: nextName });
                            setAssignForm((prev) => ({
                              ...prev,
                              gatePassDestination: prev.gatePassDestination || nextName
                            }));
                          }}
                          placeholder="Enter person name"
                          className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Recipient Email</label>
                        <input
                          type="email"
                          value={otherRecipient.email}
                          onChange={(e) => setOtherRecipient({ ...otherRecipient, email: e.target.value })}
                          placeholder="Enter email"
                          className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Recipient Phone</label>
                        <input
                          type="text"
                          value={otherRecipient.phone}
                          onChange={(e) => setOtherRecipient({ ...otherRecipient, phone: e.target.value })}
                          placeholder="Enter phone"
                          className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700">Note</label>
                        <input
                          type="text"
                          value={otherRecipient.note}
                          onChange={(e) => setOtherRecipient({ ...otherRecipient, note: e.target.value })}
                          placeholder="Department or reference"
                          className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                        />
                      </div>
                    </div>
                  )}

                  {assigningAssetIds.length <= 1 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Assign Quantity</label>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(
                          1,
                          Number.parseInt(assigningAsset?.quantity, 10) > 0
                            ? Number.parseInt(assigningAsset?.quantity, 10)
                            : 1
                        )}
                        value={assignForm.assignQuantity}
                        onChange={(e) =>
                          setAssignForm((prev) => ({ ...prev, assignQuantity: Number.parseInt(e.target.value, 10) || 1 }))
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Available:{' '}
                        {Math.max(
                          1,
                          Number.parseInt(assigningAsset?.quantity, 10) > 0
                            ? Number.parseInt(assigningAsset?.quantity, 10)
                            : 1
                        )}
                        . Partial assign leaves the rest in store.
                      </p>
                    </div>
                  )}
                </div>

                {/* Right column: contact, location, gate pass */}
                <div className="space-y-4">
                  {recipientType === 'Technician' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Recipient Email</label>
                        <input
                          type="email"
                          value={assignForm.recipientEmail}
                          onChange={(e) => setAssignForm({ ...assignForm, recipientEmail: e.target.value })}
                          placeholder="technician email"
                          className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                        />
                      </div>
                      {assignForm.needGatePass && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Recipient Phone (Gate Pass)</label>
                          <input
                            type="text"
                            value={assignForm.recipientPhone}
                            onChange={(e) => setAssignForm({ ...assignForm, recipientPhone: e.target.value })}
                            placeholder="Technician contact number"
                            className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Installation Location *</label>
                        <input
                          type="text"
                          value={assignForm.installationLocation || ''}
                          onChange={(e) => {
                            setAssignForm({ ...assignForm, installationLocation: e.target.value });
                            if (e.target.value.trim()) setAssignInstallationLocationError('');
                          }}
                          placeholder="e.g. Server room, office, site"
                          className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                        />
                        {assignInstallationLocationError && (
                          <p className="mt-1 text-xs text-rose-600">{assignInstallationLocationError}</p>
                        )}
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Need Gate Pass?</label>
                    <div className="mt-1 flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="needGatePass"
                          checked={assignForm.needGatePass === true}
                          onChange={() => setAssignForm({ ...assignForm, needGatePass: true })}
                        />
                        Yes
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="needGatePass"
                          checked={assignForm.needGatePass === false}
                          onChange={() => setAssignForm({ ...assignForm, needGatePass: false })}
                        />
                        No
                      </label>
                    </div>
                  </div>

                  {assignForm.needGatePass && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Moving From</label>
                        <input
                          type="text"
                          value={assignForm.gatePassOrigin}
                          onChange={(e) => setAssignForm({ ...assignForm, gatePassOrigin: e.target.value })}
                          placeholder="Origin location"
                          className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Moving To</label>
                        <input
                          type="text"
                          list="movement-destination-options"
                          value={assignForm.gatePassDestination}
                          onChange={(e) => setAssignForm({ ...assignForm, gatePassDestination: e.target.value })}
                          placeholder="Destination"
                          className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700">Justification</label>
                        <input
                          type="text"
                          value={assignForm.gatePassJustification}
                          onChange={(e) => setAssignForm({ ...assignForm, gatePassJustification: e.target.value })}
                          placeholder="Reason for movement"
                          className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Ticket / Reference {assignForm.needGatePass ? '(required if Gate Pass)' : '(optional)'}
                    </label>
                    <input
                      type="text"
                      value={assignForm.ticketNumber}
                      onChange={(e) => setAssignForm({ ...assignForm, ticketNumber: e.target.value })}
                      placeholder="Ticket number or reference"
                      className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 justify-end gap-3 border-t border-gray-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setAssigningAsset(null);
                  setAssigningAssetIds([]);
                }}
                disabled={assignSubmitting}
                className="rounded-md bg-gray-200 px-4 py-2 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssignSubmit}
                disabled={assignSubmitting}
                className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {assignSubmitting ? 'Assigning...' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingAsset && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Edit Asset</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Product Selector */}
              <div className="md:col-span-2 grid grid-cols-1 gap-4 bg-gray-50 p-3 rounded mb-2 border">
                 <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Product</label>
                    <select
                      value={selectedProduct}
                      onChange={(e) => {
                         const val = e.target.value;
                         setSelectedProduct(val);
                         if (val) {
                            setFormData(prev => ({ ...prev, name: String(val).toUpperCase(), model_number: String(val).toUpperCase() }));
                         }
                      }}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    >
                      <option value="">Select Product</option>
                      {flatProducts.map(p => (
                        <option key={p._id || p.name} value={p.name}>
                          {p.fullPath}
                        </option>
                      ))}
                    </select>
                 </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Name / Asset Type</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Model</label>
                <input
                  type="text"
                  name="model_number"
                  value={formData.model_number}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Serial</label>
                <input
                  type="text"
                  name="serial_number"
                  value={formData.serial_number}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Ticket Number</label>
                <input
                  type="text"
                  name="ticket_number"
                  value={formData.ticket_number || ''}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">PO Number</label>
                <input
                  type="text"
                  name="po_number"
                  value={formData.po_number || ''}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Vendor Name</label>
                <input
                  type="text"
                  name="vendor_name"
                  value={formData.vendor_name || ''}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Device Group</label>
                <input type="text" name="device_group" value={formData.device_group || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Inbound From</label>
                <input type="text" name="inbound_from" value={formData.inbound_from || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Outbound To</label>
                <input type="text" name="outbound_to" value={formData.outbound_to || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Expo Tag</label>
                <input type="text" name="expo_tag" value={formData.expo_tag || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">ABS Code</label>
                <input type="text" name="abs_code" value={formData.abs_code || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Product Number</label>
                <input type="text" name="product_number" value={formData.product_number || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Operating System</label>
                <input type="text" name="operating_system" value={formData.operating_system || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Specification</label>
                <input type="text" name="specification" value={formData.specification || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Service Tag</label>
                <input type="text" name="service_tag" value={formData.service_tag || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Assign To Department</label>
                <input type="text" name="assign_to_department" value={formData.assign_to_department || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">IP Address</label>
                <input type="text" name="ip_address" value={formData.ip_address || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Building</label>
                <input type="text" name="building" value={formData.building || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">State Comments</label>
                <input type="text" name="state_comments" value={formData.state_comments || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Remarks</label>
                <input type="text" name="remarks" value={formData.remarks || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Comments</label>
                <input type="text" name="comments" value={formData.comments || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Delivered By</label>
                <input
                  type="text"
                  name="delivered_by_name"
                  value={formData.delivered_by_name || ''}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Price</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="price"
                  value={formData.price ?? ''}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Quantity</label>
                <input
                  type="number"
                  min="1"
                  name="quantity"
                  value={formData.quantity ?? 1}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
                {Boolean(editingAsset?.assigned_to || editingAsset?.assigned_to_external?.name) &&
                  Number.parseInt(formData.quantity, 10) > 0 &&
                  Number.parseInt(formData.quantity, 10) < (Number.parseInt(editingAsset?.quantity, 10) > 0 ? Number.parseInt(editingAsset?.quantity, 10) : 1) && (
                  <p className="mt-1 text-xs text-amber-700">
                    Warning: this asset is assigned. Reducing quantity is blocked; unassign or split first.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">RFID</label>
                <input
                  type="text"
                  name="rfid"
                  value={formData.rfid || ''}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">QR Code</label>
                <input
                  type="text"
                  name="qr_code"
                  value={formData.qr_code || ''}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">MAC Address</label>
                <input
                  type="text"
                  name="mac_address"
                  value={formData.mac_address}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Manufacturer</label>
                <input
                  type="text"
                  name="manufacturer"
                  value={formData.manufacturer || ''}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Location</label>
                <select
                  name="location"
                  value={formData.location || ''}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="">Select Location</option>
                  {stores.map(s => (
                    <option key={s._id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
        {/* Store field removed per requirements */}
              <div>
                <label className="block text-sm font-medium text-gray-700">Condition</label>
                <select
                  name="condition"
                  value={formData.condition}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="New">New</option>
                  <option value="Used">Used</option>
                  <option value="Faulty">Faulty</option>
                  <option value="Repaired">Repaired</option>
                  <option value="Under Repair/Workshop">Under Repair/Workshop</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Status</label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="In Store">In Store</option>
                  <option value="In Use">In Use</option>
                  <option value="Missing">Missing</option>
                  <option value="Reserved">Reserved</option>
                  <option value="Disposed">Disposed</option>
                  <option value="Under Repair/Workshop">Under Repair/Workshop</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Assigned To</label>
                <select
                  value={editAssignedToId}
                  onChange={(e) => {
                    const v = e.target.value;
                    const blocked =
                      String(formData.condition || '').trim().toLowerCase() === 'faulty'
                      || editingAsset?.reserved === true;
                    if (blocked && v) {
                      alert('Faulty or reserved assets cannot be issued to technicians.');
                      return;
                    }
                    setEditAssignedToId(v);
                  }}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="">Unassigned</option>
                  {(technicians || []).map((tech) => (
                    <option key={tech._id} value={tech._id}>
                      {tech.name}{tech.email ? ` (${tech.email})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {editAssignedToId && (
                <div className="md:col-span-2 border border-indigo-100 rounded-md p-3 bg-indigo-50/40">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Assign Quantity</label>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, Number.parseInt(formData?.quantity, 10) > 0 ? Number.parseInt(formData?.quantity, 10) : 1)}
                        value={editAssignQuantity}
                        onChange={(e) => setEditAssignQuantity(Number.parseInt(e.target.value, 10) || 1)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Available: {Math.max(1, Number.parseInt(formData?.quantity, 10) > 0 ? Number.parseInt(formData?.quantity, 10) : 1)}.
                        Remaining quantity stays in store if you assign less.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Installation Location *</label>
                      <input
                        type="text"
                        value={editInstallationLocation}
                        onChange={(e) => {
                          setEditInstallationLocation(e.target.value);
                          if (e.target.value.trim()) setEditInstallationLocationError('');
                        }}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                        placeholder="e.g. Data Center Rack A / Office 12"
                      />
                      {editInstallationLocationError && (
                        <p className="mt-1 text-xs text-rose-600">{editInstallationLocationError}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-sm font-medium text-gray-700">Create Gate Pass and email technician?</label>
                    <div className="flex items-center gap-4 text-sm">
                      <label className="inline-flex items-center gap-1">
                        <input type="radio" checked={editNeedGatePass === true} onChange={() => setEditNeedGatePass(true)} />
                        Yes
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <input type="radio" checked={editNeedGatePass === false} onChange={() => setEditNeedGatePass(false)} />
                        No
                      </label>
                    </div>
                  </div>
                  {editNeedGatePass && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Moving From *</label>
                        <input type="text" value={editGatePassOrigin} onChange={(e) => setEditGatePassOrigin(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Moving To *</label>
                        <input type="text" list="movement-destination-options" value={editGatePassDestination} onChange={(e) => setEditGatePassDestination(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm" placeholder="Technician / destination" />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-600">Justification (optional)</label>
                        <input type="text" value={editGatePassJustification} onChange={(e) => setEditGatePassJustification(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm" />
                      </div>
                      <div className="md:col-span-2 text-xs text-gray-600">
                        Ticket Number is required when gate pass is enabled. Gate pass + assignment email will be sent through existing assign flow.
                      </div>
                    </div>
                  )}
                </div>
              )}
              {customEditableColumns.length > 0 && (
                <div className="md:col-span-2 border-t border-gray-100 pt-3 mt-1">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Custom Columns</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {customEditableColumns.map((column) => {
                      const key = String(column?.key || '').trim();
                      const useVendorSelect = isMaintenanceVendorColumn(column);
                      return (
                        <div key={column.id}>
                          <label className="block text-sm font-medium text-gray-700">{column.label}</label>
                          {useVendorSelect ? (
                            <select
                              value={customEditValues[key] || ''}
                              onChange={(e) => setCustomEditValues((prev) => ({ ...prev, [key]: e.target.value }))}
                              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                            >
                              <option value="">Select Maintenance Vendor</option>
                              {MAINTENANCE_VENDOR_OPTIONS.map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={customEditValues[key] || ''}
                              onChange={(e) => setCustomEditValues((prev) => ({ ...prev, [key]: e.target.value }))}
                              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={handleCancel}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={editSaving}
                className={`text-black px-4 py-2 rounded ${editSaving ? 'bg-amber-300 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700'}`}
              >
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Add New Asset</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Product Selector */}
              <div className="md:col-span-2 grid grid-cols-1 gap-4 bg-gray-50 p-3 rounded mb-2 border">
                 <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Product</label>
                    <select
                      value={selectedProduct}
                      onChange={(e) => {
                         const val = e.target.value;
                         setSelectedProduct(val);
                         if (val) {
                            setAddForm(prev => ({ ...prev, name: String(val).toUpperCase(), model_number: String(val).toUpperCase() }));
                         }
                      }}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    >
                      <option value="">Select Product</option>
                      {flatProducts.map(p => (
                        <option key={p._id || p.name} value={p.name}>
                          {p.level > 0 ? '\u00A0'.repeat(p.level * 4) + '└ ' : ''}{p.name}
                        </option>
                      ))}
                    </select>
                 </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Name / Asset Type</label>
                <input
                  type="text"
                  name="name"
                  value={addForm.name}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Model</label>
                <input
                  type="text"
                  name="model_number"
                  value={addForm.model_number}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Serial</label>
                <input
                  type="text"
                  name="serial_number"
                  value={addForm.serial_number}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Quantity</label>
                <input
                  type="number"
                  name="quantity"
                  min="1"
                  value={addForm.quantity}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Ticket Number</label>
                <input
                  type="text"
                  name="ticket_number"
                  value={addForm.ticket_number || ''}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">PO Number</label>
                <input
                  type="text"
                  name="po_number"
                  value={addForm.po_number || ''}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Vendor Name</label>
                <input
                  type="text"
                  name="vendor_name"
                  value={addForm.vendor_name || ''}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Device Group</label>
                <input type="text" name="device_group" value={addForm.device_group || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Inbound From</label>
                <input type="text" name="inbound_from" value={addForm.inbound_from || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Outbound To</label>
                <input type="text" name="outbound_to" value={addForm.outbound_to || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Expo Tag</label>
                <input type="text" name="expo_tag" value={addForm.expo_tag || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">ABS Code</label>
                <input type="text" name="abs_code" value={addForm.abs_code || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Product Number</label>
                <input type="text" name="product_number" value={addForm.product_number || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Operating System</label>
                <input type="text" name="operating_system" value={addForm.operating_system || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Specification</label>
                <input type="text" name="specification" value={addForm.specification || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Service Tag</label>
                <input type="text" name="service_tag" value={addForm.service_tag || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Assign To Department</label>
                <input type="text" name="assign_to_department" value={addForm.assign_to_department || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">IP Address</label>
                <input type="text" name="ip_address" value={addForm.ip_address || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Building</label>
                <input type="text" name="building" value={addForm.building || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">State Comments</label>
                <input type="text" name="state_comments" value={addForm.state_comments || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Remarks</label>
                <input type="text" name="remarks" value={addForm.remarks || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Comments</label>
                <input type="text" name="comments" value={addForm.comments || ''} onChange={handleAddChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Price</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="price"
                  value={addForm.price ?? ''}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">RFID</label>
                <input
                  type="text"
                  name="rfid"
                  value={addForm.rfid || ''}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">QR Code</label>
                <input
                  type="text"
                  name="qr_code"
                  value={addForm.qr_code || ''}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">MAC Address</label>
                <input
                  type="text"
                  name="mac_address"
                  value={addForm.mac_address}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Manufacturer</label>
                <input
                  type="text"
                  name="manufacturer"
                  value={addForm.manufacturer}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Location</label>
                <select
                  name="location"
                  value={addForm.location || ''}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="">Select Location</option>
                  {stores.map(s => (
                    <option key={s._id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
        {/* Store field removed per requirements */}
              <div>
                <label className="block text-sm font-medium text-gray-700">Condition</label>
                <select
                  name="condition"
                  value={addForm.condition}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="New">New</option>
                  <option value="Used">Used</option>
                  <option value="Faulty">Faulty</option>
                  <option value="Repaired">Repaired</option>
                  <option value="Disposed">Disposed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Status</label>
                <select
                  name="status"
                  value={addForm.status}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="In Store">In Store</option>
                  <option value="In Use">In Use</option>
                  <option value="Missing">Missing</option>
                  <option value="Reserved">Reserved</option>
                  <option value="Under Repair/Workshop">Under Repair/Workshop</option>
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleAddSubmit}
                disabled={addLoading}
                className={`text-white px-4 py-2 rounded ${addLoading ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
              >
                {addLoading ? 'Adding…' : 'Add Asset'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Bulk Edit Modal */}
      {showBulkEditModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Bulk Edit Assets</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-purple-50 p-3 rounded text-sm text-purple-800 mb-2">
                Select fields to update for all selected assets. Leave blank to keep existing values.
              </div>

              {/* Product Selector for Bulk Edit */}
              <div className="grid grid-cols-1 gap-3 border-b pb-4 mb-2 md:col-span-2">
                 <div>
                    <label className="block text-sm font-medium text-gray-700">Product (Optional)</label>
                    <select
                      value={bulkForm.product_name || ''}
                      onChange={(e) => setBulkForm({ ...bulkForm, product_name: e.target.value })}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                    >
                      <option value="">No change</option>
                      {flatProducts.map(p => (
                        <option key={p._id || p.name} value={p.name}>
                          {p.fullPath}
                        </option>
                      ))}
                    </select>
                 </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Status (Optional)</label>
                <select
                  value={bulkForm.status}
                  onChange={(e) => setBulkForm({ ...bulkForm, status: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="">No change</option>
                  <option value="In Store">In Store</option>
                  <option value="In Use">In Use</option>
                  <option value="Missing">Missing</option>
                  <option value="Under Repair/Workshop">Under Repair/Workshop</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Condition (Optional)</label>
                <select
                  value={bulkForm.condition}
                  onChange={(e) => setBulkForm({ ...bulkForm, condition: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="">No change</option>
                  <option value="New">New</option>
                  <option value="Used">Used</option>
                  <option value="Faulty">Faulty</option>
                  <option value="Repaired">Repaired</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Manufacturer (Optional)</label>
                <input
                  type="text"
                  value={bulkForm.manufacturer}
                  onChange={(e) => setBulkForm({ ...bulkForm, manufacturer: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                  placeholder="e.g., SIEMENS"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Location (Optional)</label>
                <select
                  value={bulkForm.locationId}
                  onChange={(e) => setBulkForm({ ...bulkForm, locationId: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="">No change</option>
                  {stores.map(s => (
                    <option key={s._id} value={s._id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Device Group (Optional)</label>
                <input type="text" value={bulkForm.device_group || ''} onChange={(e) => setBulkForm({ ...bulkForm, device_group: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Inbound From (Optional)</label>
                <input type="text" value={bulkForm.inbound_from || ''} onChange={(e) => setBulkForm({ ...bulkForm, inbound_from: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Outbound To (Optional)</label>
                <input type="text" value={bulkForm.outbound_to || ''} onChange={(e) => setBulkForm({ ...bulkForm, outbound_to: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Expo Tag (Optional)</label>
                <input type="text" value={bulkForm.expo_tag || ''} onChange={(e) => setBulkForm({ ...bulkForm, expo_tag: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">ABS Code (Optional)</label>
                <input type="text" value={bulkForm.abs_code || ''} onChange={(e) => setBulkForm({ ...bulkForm, abs_code: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Product Number (Optional)</label>
                <input type="text" value={bulkForm.product_number || ''} onChange={(e) => setBulkForm({ ...bulkForm, product_number: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Operating System (Optional)</label>
                <input type="text" value={bulkForm.operating_system || ''} onChange={(e) => setBulkForm({ ...bulkForm, operating_system: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Specification (Optional)</label>
                <input type="text" value={bulkForm.specification || ''} onChange={(e) => setBulkForm({ ...bulkForm, specification: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Service Tag (Optional)</label>
                <input type="text" value={bulkForm.service_tag || ''} onChange={(e) => setBulkForm({ ...bulkForm, service_tag: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Assign To Department (Optional)</label>
                <input type="text" value={bulkForm.assign_to_department || ''} onChange={(e) => setBulkForm({ ...bulkForm, assign_to_department: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">IP Address (Optional)</label>
                <input type="text" value={bulkForm.ip_address || ''} onChange={(e) => setBulkForm({ ...bulkForm, ip_address: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Building (Optional)</label>
                <input type="text" value={bulkForm.building || ''} onChange={(e) => setBulkForm({ ...bulkForm, building: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">State Comments (Optional)</label>
                <input type="text" value={bulkForm.state_comments || ''} onChange={(e) => setBulkForm({ ...bulkForm, state_comments: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Remarks (Optional)</label>
                <input type="text" value={bulkForm.remarks || ''} onChange={(e) => setBulkForm({ ...bulkForm, remarks: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Comments (Optional)</label>
                <input type="text" value={bulkForm.comments || ''} onChange={(e) => setBulkForm({ ...bulkForm, comments: e.target.value })} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" placeholder="No change" />
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3 md:col-span-2">
              <button
                onClick={() => setShowBulkEditModal(false)}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkEditSubmit}
                disabled={bulkLoading}
                className={`text-white px-4 py-2 rounded ${bulkLoading ? 'bg-purple-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'}`}
              >
                {bulkLoading ? 'Updating…' : `Apply to ${selectedIds.length} asset(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
      <datalist id="movement-destination-options">
        {movementDestinationOptions.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>

      {/* Custom Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-[100]">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-sm mx-4">
            <h2 className={`text-xl font-bold mb-2 ${confirmModal.type === 'danger' ? 'text-red-600' : 'text-gray-800'}`}>
              {confirmModal.title}
            </h2>
            <p className="text-gray-600 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={closeConfirm}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                className={`text-white px-4 py-2 rounded ${
                  confirmModal.type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 
                  confirmModal.type === 'warning' ? 'bg-amber-600 hover:bg-amber-700' : 
                  'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Asset Comment Modal */}
      {assetCommentModal.isOpen && assetCommentModal.asset && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-[100]">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg mx-4">
            <h2 className="text-xl font-bold mb-2">Add Asset Comment</h2>
            <p className="text-sm text-gray-500 mb-4">
              Asset: <strong>{assetCommentModal.asset.name}</strong> ({assetCommentModal.asset.serial_number || '-'})
            </p>
            <textarea
              value={assetCommentModal.comment}
              onChange={(e) => setAssetCommentModal((prev) => ({ ...prev, comment: e.target.value }))}
              rows={4}
              maxLength={500}
              className="w-full border border-gray-300 rounded-md shadow-sm p-2 resize-y"
              placeholder="Write your comment here..."
            />
            <p className="text-xs text-gray-500 mt-1">
              {String(assetCommentModal.comment || '').length}/500
            </p>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setAssetCommentModal({ isOpen: false, asset: null, comment: '' })}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
                disabled={savingComment}
              >
                Cancel
              </button>
              <button
                onClick={submitAssetComment}
                disabled={savingComment}
                className="bg-sky-600 text-white px-4 py-2 rounded hover:bg-sky-700 disabled:opacity-50"
              >
                {savingComment ? 'Saving...' : 'Save Comment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Split Asset Modal */}
      {splitModal.isOpen && splitModal.asset && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-[100]">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md mx-4">
            <h2 className="text-xl font-bold mb-2">Split / Report Faulty</h2>
            <p className="text-sm text-gray-500 mb-4">
              Splitting from: <strong>{splitModal.asset.name}</strong> (Qty: {splitModal.asset.quantity})
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Quantity to Split</label>
                <input
                  type="number"
                  min="1"
                  max={splitModal.asset.quantity - 1}
                  value={splitModal.quantity}
                  onChange={(e) => setSplitModal(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
                <p className="text-xs text-gray-500 mt-1">Remaining quantity will be: {splitModal.asset.quantity - splitModal.quantity}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">New Status</label>
                <select
                  value={splitModal.status}
                  onChange={(e) => setSplitModal(prev => ({ ...prev, status: e.target.value }))}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="In Store">In Store</option>
                  <option value="In Use">In Use</option>
                  <option value="Missing">Missing</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">New Condition</label>
                <select
                  value={splitModal.condition}
                  onChange={(e) => setSplitModal(prev => ({ ...prev, condition: e.target.value }))}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="Faulty">Faulty</option>
                  <option value="Used">Used</option>
                  <option value="Repaired">Repaired</option>
                  <option value="New">New</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setSplitModal(prev => ({ ...prev, isOpen: false }))}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSplitSubmit}
                disabled={splitModal.quantity >= splitModal.asset.quantity || splitModal.quantity < 1}
                className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 disabled:opacity-50"
              >
                Split Asset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Assets;
