import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Truck, FileText, Box, CheckSquare, RefreshCw, Trash2, Database, AlertTriangle, Mail, Send, Palette, SlidersHorizontal, ArrowUp, ArrowDown, Plus, Wrench } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

/** Keep in sync with server `BASE_ASSET_COLUMNS` in routes/system.js (store default + reset). */
const DEFAULT_ASSET_COLUMNS = [
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

const buildDefaultColumnsConfig = () => ({
  columns: DEFAULT_ASSET_COLUMNS.map((column) => ({ ...column }))
});

const Setup = () => {
  const { user, branding, refreshBranding } = useAuth();
  const [storage, setStorage] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [globalResetLoading, setGlobalResetLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [deletionRequests, setDeletionRequests] = useState([]);
  const [stores, setStores] = useState([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [emailConfig, setEmailConfig] = useState({
    smtpHost: '',
    smtpPort: 587,
    username: '',
    password: '',
    encryption: 'TLS',
    fromEmail: '',
    fromName: '',
    ppmNotificationSubject: 'Expo City Dubai PPM Notification',
    assetNotificationSubject: 'Expo City Dubai Asset Notification',
    enabled: true
  });
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const isMainAdmin = user?.role === 'Super Admin';
  const canManageEmail = user?.role === 'Super Admin';
  const [themeSaving, setThemeSaving] = useState(false);
  const [bulkLocationInput, setBulkLocationInput] = useState('');
  const [bulkLocationLoading, setBulkLocationLoading] = useState(false);
  const [bulkLocationResult, setBulkLocationResult] = useState(null);
  const [assetColumnsConfig, setAssetColumnsConfig] = useState(buildDefaultColumnsConfig);
  const [assetColumnsLoading, setAssetColumnsLoading] = useState(false);
  const [assetColumnsSaving, setAssetColumnsSaving] = useState(false);
  const [maintenanceVendorsText, setMaintenanceVendorsText] = useState('Siemens\nG42');
  const [maintenanceVendorsLoading, setMaintenanceVendorsLoading] = useState(false);
  const [maintenanceVendorsSaving, setMaintenanceVendorsSaving] = useState(false);
  const assetColumnsScrollRef = useRef(null);
  const assetColumnsLoadEpochRef = useRef(0);

  const resolveUserStoreId = () => {
    const raw = user?.assignedStore;
    if (!raw) return '';
    return typeof raw === 'string' ? raw : raw?._id || '';
  };
  const effectiveEmailStoreId = user?.role === 'Super Admin' ? selectedStoreId : resolveUserStoreId();

  useEffect(() => {
    if (isMainAdmin) {
      const fetchData = async () => {
        try {
          const [storageRes, storesRes] = await Promise.all([
            api.get('/system/storage'),
            api.get('/system/stores')
          ]);
          const safeStores = Array.isArray(storesRes.data) ? storesRes.data : [];
          setStorage(storageRes.data);
          setStores(safeStores);
          
          // Filter for deletion requests
          const requests = safeStores.filter((s) => s?.deletionRequested);
          setDeletionRequests(requests);
          if (safeStores.length > 0) {
            setSelectedStoreId((prev) => prev || safeStores[0]._id);
          }
        } catch (e) {
          console.error(e);
        }
      };
      fetchData();
    }
  }, [isMainAdmin]);

  useEffect(() => {
    if (!canManageEmail) return;
    const storeId = user?.role === 'Super Admin' ? selectedStoreId : resolveUserStoreId();
    if (!storeId) return;

    const fetchEmailConfig = async () => {
      try {
        setEmailLoading(true);
        const res = await api.get('/system/email-config', { params: { storeId } });
        if (res.data?.emailConfig) {
          setEmailConfig({
            smtpHost: res.data.emailConfig.smtpHost || '',
            smtpPort: res.data.emailConfig.smtpPort || 587,
            username: res.data.emailConfig.username || '',
            password: res.data.emailConfig.password || '',
            encryption: res.data.emailConfig.encryption || 'TLS',
            fromEmail: res.data.emailConfig.fromEmail || '',
            fromName: res.data.emailConfig.fromName || '',
            ppmNotificationSubject: res.data.emailConfig.ppmNotificationSubject || 'Expo City Dubai PPM Notification',
            assetNotificationSubject: res.data.emailConfig.assetNotificationSubject || 'Expo City Dubai Asset Notification',
            enabled: Boolean(res.data.emailConfig.enabled)
          });
          setTestEmail(user?.email || '');
        }
      } catch (error) {
        console.error(error);
      } finally {
        setEmailLoading(false);
      }
    };

    fetchEmailConfig();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageEmail, selectedStoreId, user?.role]);

  const canManageNotificationPreferences = user?.role === 'Admin' || user?.role === 'Super Admin';

  const handleEmailField = (field, value) => {
    setEmailConfig((prev) => ({ ...prev, [field]: value }));
  };

  useEffect(() => {
    if (!canManageNotificationPreferences) return;
    if (!effectiveEmailStoreId) return;
    let cancelled = false;
    const loadEpoch = ++assetColumnsLoadEpochRef.current;
    const loadAssetColumnsConfig = async () => {
      try {
        setAssetColumnsLoading(true);
        const res = await api.get('/system/assets-columns-config', { params: { storeId: effectiveEmailStoreId } });
        if (cancelled) return;
        if (loadEpoch !== assetColumnsLoadEpochRef.current) return;
        const nextConfig = res.data?.config || buildDefaultColumnsConfig();
        const nextColumns = Array.isArray(nextConfig.columns) ? nextConfig.columns : buildDefaultColumnsConfig().columns;
        setAssetColumnsConfig({
          columns: nextColumns.map((column, idx) => ({
            id: String(column?.id || `custom_${idx}`),
            label: String(column?.label || `Column ${idx + 1}`),
            key: String(column?.key || ''),
            visible: column?.visible !== false,
            builtin: Boolean(column?.builtin)
          }))
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load asset columns config:', error);
        }
      } finally {
        if (!cancelled) setAssetColumnsLoading(false);
      }
    };
    loadAssetColumnsConfig();
    return () => { cancelled = true; };
  }, [canManageNotificationPreferences, effectiveEmailStoreId]);

  useEffect(() => {
    if (!canManageNotificationPreferences || !effectiveEmailStoreId) return;
    let cancelled = false;
    const loadVendors = async () => {
      try {
        setMaintenanceVendorsLoading(true);
        const res = await api.get('/system/maintenance-vendors', { params: { storeId: effectiveEmailStoreId } });
        if (cancelled) return;
        const v = res.data?.vendors;
        if (Array.isArray(v) && v.length > 0) {
          setMaintenanceVendorsText(v.join('\n'));
        } else {
          setMaintenanceVendorsText('Siemens\nG42');
        }
      } catch (e) {
        if (!cancelled) console.error('Failed to load maintenance vendors:', e);
      } finally {
        if (!cancelled) setMaintenanceVendorsLoading(false);
      }
    };
    loadVendors();
    return () => { cancelled = true; };
  }, [canManageNotificationPreferences, effectiveEmailStoreId]);

  const saveMaintenanceVendorsConfig = async () => {
    if (!effectiveEmailStoreId) {
      alert(
        user?.role === 'Super Admin'
          ? 'Select a store first (same as column defaults / email settings).'
          : 'No store is assigned to your account.'
      );
      return;
    }
    try {
      setMaintenanceVendorsSaving(true);
      const vendors = maintenanceVendorsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await api.put('/system/maintenance-vendors', {
        storeId: effectiveEmailStoreId,
        vendors
      });
      alert('Maintenance vendors saved. They appear in Assets filters, bulk edit, and the dashboard vendor scope.');
    } catch (error) {
      alert('Failed to save maintenance vendors: ' + (error.response?.data?.message || error.message));
    } finally {
      setMaintenanceVendorsSaving(false);
    }
  };

  const moveAssetColumn = (index, direction) => {
    setAssetColumnsConfig((prev) => {
      const nextColumns = [...prev.columns];
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= nextColumns.length) return prev;
      const temp = nextColumns[index];
      nextColumns[index] = nextColumns[target];
      nextColumns[target] = temp;
      return { ...prev, columns: nextColumns };
    });
  };

  const updateAssetColumnField = (id, field, value) => {
    setAssetColumnsConfig((prev) => ({
      ...prev,
      columns: (prev.columns || []).map((column) => (
        column.id === id ? { ...column, [field]: value } : column
      ))
    }));
  };

  const toggleAssetColumnVisibility = (id, checked) => {
    updateAssetColumnField(id, 'visible', checked);
  };

  const addAssetColumn = () => {
    const stamp = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const fieldKey = `custom_${stamp}`;
    setAssetColumnsConfig((prev) => ({
      ...prev,
      columns: [
        ...(prev.columns || []),
        {
          id: `custom_${stamp}`,
          label: 'New field',
          key: `customFields.${fieldKey}`,
          visible: true,
          builtin: false
        }
      ]
    }));
    requestAnimationFrame(() => {
      const el = assetColumnsScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const deleteAssetColumn = (id) => {
    setAssetColumnsConfig((prev) => ({
      ...prev,
      columns: (prev.columns || []).filter((column) => column.id !== id)
    }));
  };

  const resetAssetColumnsConfig = () => {
    setAssetColumnsConfig(buildDefaultColumnsConfig());
  };

  const saveAssetColumnsConfig = async () => {
    if (!effectiveEmailStoreId) {
      alert(
        user?.role === 'Super Admin'
          ? 'Select a store first (use the store dropdown under Store Email Settings, or select one below).'
          : 'No store is assigned to your account; assign a store before saving column defaults.'
      );
      return;
    }
    try {
      setAssetColumnsSaving(true);
      await api.put('/system/assets-columns-config', {
        storeId: effectiveEmailStoreId,
        config: {
          columns: (assetColumnsConfig.columns || []).map((column) => ({
            id: String(column.id || '').trim(),
            label: String(column.label || '').trim(),
            key: String(column.key || '').trim(),
            visible: column.visible !== false
          }))
        }
      });
      alert('Asset columns configuration saved.');
    } catch (error) {
      alert('Failed to save asset columns config: ' + (error.response?.data?.message || error.message));
    } finally {
      setAssetColumnsSaving(false);
    }
  };

  const themeOptions = [
    { value: 'default', label: 'Default (Expo Amber)' },
    { value: 'ocean', label: 'Ocean Glass (Blue)' },
    { value: 'emerald', label: 'Emerald Glow (Green)' },
    { value: 'sunset', label: 'Sunset Flow (Warm)' },
    { value: 'midnight', label: 'Midnight Neon (Dark)' },
    { value: 'mono', label: 'Mono Pro (Minimal)' },
    { value: 'glossy', label: 'Astra Pro (Professional)' },
    { value: 'astraLight', label: 'Astra Light Pro (Clean)' },
    { value: 'astraExecutive', label: 'Astra Executive (Premium)' }
  ];

  const applyTheme = async (newTheme) => {
    if (!newTheme || themeSaving || (branding?.theme || 'default') === newTheme) return;
    try {
      setThemeSaving(true);
      await api.post('/system/theme', { theme: newTheme, storeId: effectiveEmailStoreId });
      await refreshBranding();
      alert('Theme updated successfully.');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to update theme');
    } finally {
      setThemeSaving(false);
    }
  };

  const handleSaveEmailConfig = async () => {
    try {
      setEmailSaving(true);
      await api.put('/system/email-config', { storeId: effectiveEmailStoreId, ...emailConfig });
      alert('Email configuration saved successfully.');
    } catch (error) {
      alert('Save failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setEmailSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail) return alert('Enter recipient email for test message.');
    try {
      setTestingEmail(true);
      await api.post('/system/email-config/test', { storeId: effectiveEmailStoreId, to: testEmail });
      alert('Test email sent successfully.');
    } catch (error) {
      alert('Test failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setTestingEmail(false);
    }
  };

  const handleBulkLocationAdd = async () => {
    if (bulkLocationLoading) return;
    const candidates = String(bulkLocationInput || '')
      .split(/[\n,]+/)
      .map((name) => name.trim())
      .filter(Boolean);
    const uniqueNames = Array.from(new Set(candidates.map((n) => n.toLowerCase())))
      .map((lower) => candidates.find((n) => n.toLowerCase() === lower))
      .filter(Boolean);

    if (uniqueNames.length === 0) {
      alert('Please enter at least one location name.');
      return;
    }
    if (uniqueNames.length > 1000) {
      alert('Maximum 1000 locations can be added at once.');
      return;
    }

    try {
      setBulkLocationLoading(true);
      setBulkLocationResult(null);
      const res = await api.post('/stores/bulk', { names: uniqueNames });
      const failed = (res.data?.skipped || []).map((item) => ({
        name: item.name,
        message: item.reason || 'Skipped'
      }));

      setBulkLocationResult({
        requested: Number(res.data?.normalized || uniqueNames.length),
        created: Number(res.data?.created || 0),
        failed
      });
      if (Number(res.data?.created || 0) > 0) {
        setBulkLocationInput('');
      }
    } catch (error) {
      alert('Bulk add failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setBulkLocationLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8 text-gray-800">System Setup & Management</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* Approval Process Section */}
        <div className="col-span-full mb-4">
           <h2 className="text-xl font-semibold text-gray-700 mb-4 border-b pb-2">Approval Process</h2>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             <Link to="/admin-requests" className="block group">
               <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-xl transition-shadow border border-gray-100 h-full">
                 <div className="flex items-center justify-between mb-4">
                   <div className="bg-blue-100 p-3 rounded-full">
                     <CheckSquare className="text-blue-600" size={32} />
                   </div>
                 </div>
                 <h2 className="text-xl font-bold mb-2 text-gray-800 group-hover:text-blue-600">Issuance</h2>
                 <p className="text-gray-600">Manage asset issuance requests.</p>
               </div>
             </Link>

             <Link to="/receive-process" className="block group">
               <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-xl transition-shadow border border-gray-100 h-full">
                 <div className="flex items-center justify-between mb-4">
                   <div className="bg-indigo-100 p-3 rounded-full">
                     <RefreshCw className="text-indigo-600" size={32} />
                   </div>
                 </div>
                 <h2 className="text-xl font-bold mb-2 text-gray-800 group-hover:text-indigo-600">Receive</h2>
                 <p className="text-gray-600">Process incoming returns and new stocks.</p>
               </div>
             </Link>

             <Link to="/disposal-process" className="block group">
               <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-xl transition-shadow border border-gray-100 h-full">
                 <div className="flex items-center justify-between mb-4">
                   <div className="bg-red-100 p-3 rounded-full">
                     <Trash2 className="text-red-600" size={32} />
                   </div>
                 </div>
                 <h2 className="text-xl font-bold mb-2 text-gray-800 group-hover:text-red-600">Disposal</h2>
                 <p className="text-gray-600">Manage asset disposal and write-offs.</p>
               </div>
             </Link>
           </div>
        </div>

        <h2 className="col-span-full text-xl font-semibold text-gray-700 mt-6 mb-4 border-b pb-2">General Setup</h2>

        <Link to="/vendors" className="block group">
          <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-xl transition-shadow border border-gray-100 h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-blue-100 p-3 rounded-full">
                <Truck className="text-blue-600" size={32} />
              </div>
            </div>
            <h2 className="text-xl font-bold mb-2 text-gray-800 group-hover:text-blue-600">Vendor Management</h2>
            <p className="text-gray-600">
              Add, edit, and manage vendors. Track contact details, tax IDs, and payment terms.
            </p>
          </div>
        </Link>

        <Link to="/purchase-orders" className="block group">
          <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-xl transition-shadow border border-gray-100 h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-green-100 p-3 rounded-full">
                <FileText className="text-green-600" size={32} />
              </div>
            </div>
            <h2 className="text-xl font-bold mb-2 text-gray-800 group-hover:text-green-600">Purchase Orders</h2>
            <p className="text-gray-600">
              Create and manage purchase orders. Track order status, deliveries, and costs.
            </p>
          </div>
        </Link>

        <Link to="/setup/products" className="block group">
          <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-xl transition-shadow border border-gray-100 h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-amber-100 p-3 rounded-full">
                <Box className="text-amber-600" size={32} />
              </div>
            </div>
            <h2 className="text-xl font-bold mb-2 text-gray-800 group-hover:text-amber-600">Products</h2>
            <p className="text-gray-600">
              Manage product categories, view stats, and handle product images. Add or remove products like Cameras, Readers, etc.
            </p>
          </div>
        </Link>

        

        <Link to="/permits" className="block group">
          <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-xl transition-shadow border border-gray-100 h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-purple-100 p-3 rounded-full">
                <FileText className="text-purple-600" size={32} />
              </div>
            </div>
            <h2 className="text-xl font-bold mb-2 text-gray-800 group-hover:text-purple-600">Permits & Records</h2>
            <p className="text-gray-600">
              Manage permits (Storage, PTW, Asset Movement). Upload and view permit files.
            </p>
          </div>
        </Link>

        {(user?.role === 'Admin' || user?.role === 'Super Admin') && (
          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100 h-full">
            <h3 className="text-lg font-bold text-gray-800 mb-2">Bulk Location Add</h3>
            <p className="text-sm text-gray-600 mb-3">
              Add multiple locations at once (up to 1000). Enter one location per line (or comma separated).
            </p>
            <textarea
              value={bulkLocationInput}
              onChange={(e) => setBulkLocationInput(e.target.value)}
              placeholder={'Example:\nA\nB\nC\nD'}
              className="w-full h-28 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                Duplicates are auto-skipped in input; existing locations will show in failed list.
              </p>
              <button
                type="button"
                onClick={handleBulkLocationAdd}
                disabled={bulkLocationLoading}
                className={`px-4 py-2 rounded-lg text-white font-medium ${
                  bulkLocationLoading ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {bulkLocationLoading ? 'Adding Locations...' : 'Add Locations'}
              </button>
            </div>
            {bulkLocationResult && (
              <div className="mt-4 text-sm">
                <p className="text-gray-700">
                  Requested: <span className="font-semibold">{bulkLocationResult.requested}</span> | Created:{' '}
                  <span className="font-semibold text-green-700">{bulkLocationResult.created}</span> | Failed:{' '}
                  <span className="font-semibold text-red-700">{bulkLocationResult.failed.length}</span>
                </p>
                {bulkLocationResult.failed.length > 0 && (
                  <div className="mt-2 max-h-36 overflow-auto rounded border border-red-100 bg-red-50 p-2 text-xs text-red-700">
                    {bulkLocationResult.failed.map((item) => (
                      <p key={`${item.name}-${item.message}`}>
                        {item.name}: {item.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Database Management Section (Admin Only) */}
      {isMainAdmin && storage && (
        <div className="mt-12 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <Database className="w-6 h-6 text-gray-500 mr-2" />
              <h2 className="text-xl font-bold text-gray-800">Database Management</h2>
            </div>
          </div>
          
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Storage Usage</h3>
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Used: {(storage.usedBytes / (1024 * 1024)).toFixed(1)} MB</span>
              <span>Limit: {(storage.limitBytes / (1024 * 1024)).toFixed(0)} MB</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  storage.percentUsed < 70 ? 'bg-green-500' : 
                  storage.percentUsed < 90 ? 'bg-amber-500' : 'bg-red-600'
                }`}
                style={{ width: `${Math.min(storage.percentUsed, 100)}%` }}
              />
            </div>
            <p className="text-right text-xs text-gray-400 mt-1">{storage.percentUsed}% Used</p>
          </div>

          <div className="pt-6 border-t border-gray-100">
            {/* Deletion Requests Section */}
            {deletionRequests.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center mb-4 text-amber-600">
                  <AlertTriangle className="w-5 h-5 mr-2" />
                  <h3 className="text-lg font-bold">Pending Deletion Requests</h3>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 space-y-4">
                  {deletionRequests.map(store => (
                    <div key={store._id} className="flex flex-col md:flex-row items-center justify-between bg-white p-4 rounded shadow-sm border border-amber-200">
                      <div>
                        <h4 className="font-bold text-gray-800">{store.name}</h4>
                        <p className="text-sm text-gray-600">
                          Requested: {new Date(store.deletionRequestedAt).toLocaleDateString()}
                        </p>
                        {store.deletionRequestedBy && (
                            <p className="text-xs text-gray-500 mt-1">By: {store.deletionRequestedBy}</p>
                        )}
                      </div>
                      <div className="flex gap-2 mt-2 md:mt-0">
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Reject deletion request for ${store.name}?`)) return;
                            try {
                              await api.post('/system/cancel-reset', { storeId: store._id });
                              setDeletionRequests(prev => prev.filter(s => s._id !== store._id));
                              alert('Request rejected.');
                            } catch (e) {
                              alert('Error: ' + (e.response?.data?.message || e.message));
                            }
                          }}
                          className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors text-sm font-medium"
                        >
                          Reject
                        </button>
                        <button
                          onClick={async () => {
                            const pwd = prompt(`Enter Super Admin Password to DELETE ALL DATA for ${store.name}:`);
                            if (!pwd) return;
                            try {
                              await api.post('/system/reset', { password: pwd, storeId: store._id });
                              setDeletionRequests(prev => prev.filter(s => s._id !== store._id));
                              alert(`Data for ${store.name} has been reset.`);
                              window.location.reload();
                            } catch (e) {
                              console.error(e);
                              alert('Reset failed: ' + (e.response?.data?.message || e.message));
                            }
                          }}
                          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-sm font-medium"
                        >
                          Approve & Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center mb-4 text-red-600">
               <AlertTriangle className="w-5 h-5 mr-2" />
               <h3 className="text-lg font-bold">Danger Zone</h3>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-lg p-4 space-y-4">
              <p className="text-red-700 text-sm">
                Actions here are irreversible. Please proceed with caution.
              </p>
              <div className="flex flex-col md:flex-row gap-3">
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Enter Super Admin password"
                  className="flex-1 border border-red-200 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                />
                <button
                  onClick={async () => {
                    if (globalResetLoading) return;
                    if (!resetPassword) {
                      alert('Please enter the Super Admin password to confirm this action.');
                      return;
                    }
                    const ok = window.confirm('WARNING: This will erase all stores, assets, requests, and logs. Users, Products and Categories will remain. This action cannot be undone. Continue?');
                    if (!ok) return;
                    try {
                      setGlobalResetLoading(true);
                      const pwd = String(resetPassword).trim();
                      const res = await api.post('/system/reset', { password: pwd, storeId: 'all' });
                      setResetPassword('');
                      alert(res.data?.message || 'System reset successful.');
                      window.location.reload();
                    } catch (e) {
                      console.error(e);
                      alert('Reset failed: ' + (e.response?.data?.message || e.message));
                    } finally {
                      setGlobalResetLoading(false);
                    }
                  }}
                  className={`px-6 py-2 rounded-lg transition-colors font-medium shadow-sm text-white ${globalResetLoading ? 'bg-red-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}
                >
                  {globalResetLoading ? 'Resetting…' : 'Reset Full System'}
                </button>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={async () => {
                    if (backupLoading) return;
                    const ok = window.confirm('Run full system backup now? This may take a moment.');
                    if (!ok) return;
                    try {
                      setBackupLoading(true);
                      const res = await api.post('/system/backup', {}, {
                        timeout: 4 * 60 * 60 * 1000
                      });
                      alert(res.data?.message || 'Backup completed successfully.');
                    } catch (e) {
                      console.error(e);
                      alert('Backup failed: ' + (e.response?.data?.message || e.message));
                    } finally {
                      setBackupLoading(false);
                    }
                  }}
                  className={`px-6 py-2 rounded-lg transition-colors font-medium shadow-sm ${
                    backupLoading ? 'bg-gray-400 cursor-not-allowed text-white' : 'bg-gray-800 text-white hover:bg-black'
                  }`}
                >
                  {backupLoading ? 'Backing up…' : 'Backup System Data'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Store Admin Deletion Request — Super Admin must use Database Management above */}
      {user?.role === 'Admin' && (
        <div className="mt-12 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
           <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <Database className="w-6 h-6 text-gray-500 mr-2" />
              <h2 className="text-xl font-bold text-gray-800">Store Data Management</h2>
            </div>
          </div>
           <div className="pt-6 border-t border-gray-100">
            <div className="flex items-center mb-4 text-red-600">
               <AlertTriangle className="w-5 h-5 mr-2" />
               <h3 className="text-lg font-bold">Danger Zone</h3>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-lg p-4">
              <p className="text-red-700 mb-4 text-sm">
                Request a full data reset for your store. This requires Super Admin approval.
                <br />
                <strong>Warning:</strong> All assets and logs for this store will be erased. Users will remain.
              </p>
              <button
                onClick={async () => {
                   if (!window.confirm('Are you sure you want to request a data reset for your store?')) return;
                   try {
                     await api.post('/system/request-reset');
                     alert('Deletion request submitted to Super Admin.');
                   } catch (e) {
                     console.error(e);
                     alert('Request failed: ' + (e.response?.data?.message || e.message));
                   }
                }}
                className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 transition-colors font-medium shadow-sm"
              >
                Request Data Deletion
              </button>
            </div>
          </div>
        </div>
      )}

      {canManageNotificationPreferences && (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center mb-4">
            <SlidersHorizontal className="w-6 h-6 text-indigo-600 mr-2" />
            <h2 className="text-xl font-bold text-gray-800">Assets Columns Customization</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Default column layout for the <strong>Assets</strong> page for this store. Users can still save a personal layout from Assets unless they clear it. New columns use{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">customFields.&lt;id&gt;</code> so values appear in the table, Add Asset, and Edit Asset.
          </p>
          {user?.role === 'Super Admin' && (
            <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50/80 px-4 py-3">
              <label className="block text-sm font-semibold text-gray-800 mb-1">Store (column defaults)</label>
              <select
                value={selectedStoreId}
                onChange={(e) => setSelectedStoreId(e.target.value)}
                className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                <option value="">Select store…</option>
                {stores.map((store) => (
                  <option key={store._id} value={store._id}>
                    {store.name}
                  </option>
                ))}
              </select>
              {!effectiveEmailStoreId && (
                <p className="mt-2 text-xs text-amber-800">Pick a store to load and save column defaults.</p>
              )}
            </div>
          )}
          {user?.role === 'Admin' && !effectiveEmailStoreId && (
            <p className="mb-4 text-sm text-amber-700 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              No store is assigned to your account; column defaults cannot be loaded until an administrator assigns you to a store.
            </p>
          )}
          {assetColumnsLoading ? (
            <p className="text-sm text-gray-500">Loading columns configuration...</p>
          ) : (
            <>
              <div ref={assetColumnsScrollRef} className="max-h-72 overflow-auto border border-gray-200 rounded-lg divide-y">
                {(assetColumnsConfig.columns || []).map((column, idx) => {
                  return (
                    <div key={column.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center px-3 py-2">
                      <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-3">
                        <input
                          type="checkbox"
                          checked={column.visible !== false}
                          onChange={(e) => toggleAssetColumnVisibility(column.id, e.target.checked)}
                        />
                        <span>Visible</span>
                      </label>
                      <input
                        value={column.label}
                        onChange={(e) => updateAssetColumnField(column.id, 'label', e.target.value)}
                        className="md:col-span-3 border border-gray-300 rounded px-2 py-1 text-sm"
                        placeholder="Column label"
                      />
                      <input
                        value={column.key}
                        onChange={(e) => updateAssetColumnField(column.id, 'key', e.target.value)}
                        className="md:col-span-4 border border-gray-300 rounded px-2 py-1 text-sm font-mono"
                        placeholder="e.g. model_number or customFields.my_field"
                      />
                      <div className="flex items-center gap-1 md:col-span-2 justify-end">
                        <button
                          type="button"
                          onClick={() => moveAssetColumn(idx, 'up')}
                          disabled={idx === 0}
                          className="p-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                          title="Move up"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveAssetColumn(idx, 'down')}
                          disabled={idx === (assetColumnsConfig.columns || []).length - 1}
                          className="p-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                          title="Move down"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteAssetColumn(column.id)}
                          className="p-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                          title="Delete column"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap justify-between gap-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={addAssetColumn}
                    className="inline-flex items-center gap-1 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-sm"
                  >
                    <Plus size={14} />
                    Add Column
                  </button>
                  <button
                    type="button"
                    onClick={resetAssetColumnsConfig}
                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
                  >
                    Reset Default
                  </button>
                </div>
                <button
                  type="button"
                  onClick={saveAssetColumnsConfig}
                  disabled={assetColumnsSaving || !effectiveEmailStoreId}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
                >
                  {assetColumnsSaving ? 'Saving...' : 'Save Columns Layout'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {canManageNotificationPreferences && (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center mb-4">
            <Wrench className="w-6 h-6 text-indigo-600 mr-2" />
            <h2 className="text-xl font-bold text-gray-800">Maintenance vendors</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Names used for the <strong>All Vendors</strong> filter on Assets, bulk edit, edit/add asset maintenance vendor fields, and the dashboard <strong>vendor scope</strong> buttons. Enter one vendor per line (max 50, duplicates removed).
          </p>
          {user?.role === 'Super Admin' && !effectiveEmailStoreId && (
            <p className="mb-4 text-xs text-amber-800 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              Select a store above (column defaults) to load and save this list.
            </p>
          )}
          {maintenanceVendorsLoading ? (
            <p className="text-sm text-gray-500">Loading vendors…</p>
          ) : (
            <>
              <textarea
                value={maintenanceVendorsText}
                onChange={(e) => setMaintenanceVendorsText(e.target.value)}
                rows={8}
                className="w-full max-w-xl border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder={'Siemens\nG42'}
                disabled={!effectiveEmailStoreId}
              />
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={saveMaintenanceVendorsConfig}
                  disabled={maintenanceVendorsSaving || !effectiveEmailStoreId}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
                >
                  {maintenanceVendorsSaving ? 'Saving…' : 'Save maintenance vendors'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {user?.role === 'Admin' && (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center mb-6">
            <Palette className="w-6 h-6 text-indigo-600 mr-2" />
            <h2 className="text-xl font-bold text-gray-800">Customize Application Theme</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Choose a professional theme for your workspace experience.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <select
              value={branding?.theme || 'default'}
              onChange={(e) => applyTheme(e.target.value)}
              className="w-full sm:w-72 border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white text-gray-900"
            >
              {themeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => applyTheme(branding?.theme || 'default')}
              disabled={themeSaving}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
            >
              {themeSaving ? 'Applying...' : 'Apply Theme'}
            </button>
          </div>
        </div>
      )}

      {canManageEmail && (
        <div className="mt-12 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <Mail className="w-6 h-6 text-blue-600 mr-2" />
              <h2 className="text-xl font-bold text-gray-800">Store Email Settings</h2>
            </div>
          </div>

          <div className="space-y-4">
            {user?.role === 'Super Admin' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Store</label>
                <select
                  value={selectedStoreId}
                  onChange={(e) => setSelectedStoreId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select store</option>
                  {stores.map((store) => (
                    <option key={store._id} value={store._id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {emailLoading ? (
              <p className="text-sm text-gray-500">Loading email configuration...</p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">SMTP Host</label>
                    <input className="w-full border border-gray-300 rounded-lg px-3 py-2" value={emailConfig.smtpHost} onChange={(e) => handleEmailField('smtpHost', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">SMTP Port</label>
                    <input type="number" className="w-full border border-gray-300 rounded-lg px-3 py-2" value={emailConfig.smtpPort} onChange={(e) => handleEmailField('smtpPort', Number(e.target.value || 0))} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Username</label>
                    <input className="w-full border border-gray-300 rounded-lg px-3 py-2" value={emailConfig.username} onChange={(e) => handleEmailField('username', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Password</label>
                    <input type="password" className="w-full border border-gray-300 rounded-lg px-3 py-2" value={emailConfig.password} onChange={(e) => handleEmailField('password', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Encryption</label>
                    <select className="w-full border border-gray-300 rounded-lg px-3 py-2" value={emailConfig.encryption} onChange={(e) => handleEmailField('encryption', e.target.value)}>
                      <option value="TLS">TLS</option>
                      <option value="SSL">SSL</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">From Email</label>
                    <input className="w-full border border-gray-300 rounded-lg px-3 py-2" value={emailConfig.fromEmail} onChange={(e) => handleEmailField('fromEmail', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">From Name</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2" value={emailConfig.fromName} onChange={(e) => handleEmailField('fromName', e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">PPM Notification Subject Prefix</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2" value={emailConfig.ppmNotificationSubject} onChange={(e) => handleEmailField('ppmNotificationSubject', e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Asset Notification Subject Prefix</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2" value={emailConfig.assetNotificationSubject} onChange={(e) => handleEmailField('assetNotificationSubject', e.target.value)} />
                </div>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={emailConfig.enabled} onChange={(e) => handleEmailField('enabled', e.target.checked)} />
                  Enable store email settings
                </label>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-end pt-2">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Test Recipient</label>
                    <input className="w-full border border-gray-300 rounded-lg px-3 py-2" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
                  </div>
                  <button onClick={handleTestEmail} disabled={testingEmail || !effectiveEmailStoreId} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                    <Send size={16} />
                    {testingEmail ? 'Sending...' : 'Test Email'}
                  </button>
                  <button onClick={handleSaveEmailConfig} disabled={emailSaving || !effectiveEmailStoreId} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {emailSaving ? 'Saving...' : 'Save Email Settings'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Setup;
