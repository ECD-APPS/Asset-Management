import { useCallback, useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import {
  Users,
  ArrowLeft,
  Database,
  AlertTriangle,
  X,
  Store,
  Building2,
  ChevronRight,
  Settings,
  ShieldCheck,
  Activity,
  Search,
  Lock,
  LogOut,
  Mail,
  Send,
  Info,
  RefreshCw
} from 'lucide-react';

const formatArtifactDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const formatArtifactSize = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

const isPbmArtifact = (b) => String(b?.metadata?.backupTool || '') === 'pbm' || Boolean(b?.metadata?.pbmBackupName);
import AddMembers from './AddMembers';
import ChangePasswordModal from '../components/ChangePasswordModal';
import LoadingLogo from '../components/LoadingLogo';
import { CLIENT_APP_VERSION } from '../appMeta';

const Portal = () => {
  const { user, selectStore, activeStore, logout, branding, refreshBranding } = useAuth();
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
  const [deletionRequests, setDeletionRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showMembers, setShowMembers] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetStoreId, setResetStoreId] = useState('');
  const [includeUsers, setIncludeUsers] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [bulkFiles, setBulkFiles] = useState([]);
  const [_uploadProgress, _setUploadProgress] = useState({});
  const [_bulkConflicts, _setBulkConflicts] = useState([]);
  const [bulkScanIds, setBulkScanIds] = useState([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [_defaultConflictAction, _setDefaultConflictAction] = useState('skip');
  const [_conflictActions, _setConflictActions] = useState({});
  const [_bulkSummary, _setBulkSummary] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [backupArtifacts, setBackupArtifacts] = useState([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [localMongodumpEnabled, setLocalMongodumpEnabled] = useState(false);
  const [mongodumpAvailable, setMongodumpAvailable] = useState(null);
  const [mongorestoreAvailable, setMongorestoreAvailable] = useState(null);
  const [localDumpLoading, setLocalDumpLoading] = useState(false);
  const [restoreUploading, setRestoreUploading] = useState(false);
  const restoreArchiveInputRef = useRef(null);
  const [_emergencyRestoreLoading, _setEmergencyRestoreLoading] = useState(false);
  const [cloudConfig, setCloudConfig] = useState({
    enabled: false,
    provider: 's3',
    bucket: '',
    region: '',
    endpoint: '',
    accessKeyId: '',
    secretAccessKey: '',
    forcePathStyle: false,
    url: '',
    serviceRoleKey: ''
  });
  const [_cloudLoading, _setCloudLoading] = useState(false);
  const [_cloudSaving, _setCloudSaving] = useState(false);
  const [emailStoreId, setEmailStoreId] = useState('');
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
    notificationRecipients: '',
    technicianRecipients: '',
    adminRecipients: '',
    viewerRecipients: '',
    managerRecipients: '',
    lineManagerRecipients: '',
    requireLineManagerApprovalForCollection: false,
    collectionApprovalRecipients: '',
    enabled: true
  });
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [gatePassLogoUrl, setGatePassLogoUrl] = useState('/gatepass-logo.svg');
  const [appLogoPreviewUrl, setAppLogoPreviewUrl] = useState('');

  const fetchPortalStores = useCallback(async () => {
    try {
      setLoading(true);
      const promises = [api.get('/stores?main=true')];
      // Only Super Admin can see deletion requests
      if (user?.role === 'Super Admin') {
        promises.push(api.get('/stores?deletionRequested=true'));
      }
      const [storesRes, requestsRes] = await Promise.all(promises);
      let availableStores = storesRes.data || [];
      // Filter stores for Viewers based on accessScope
      if (user?.role === 'Viewer' && user?.accessScope && user.accessScope !== 'All') {
        availableStores = availableStores.filter(store =>
          store.name.toUpperCase().includes(user.accessScope.toUpperCase()) ||
          store.code?.toUpperCase() === user.accessScope.toUpperCase()
        );
      }
      setStores(availableStores);
      if (requestsRes) {
        setDeletionRequests(requestsRes.data);
      }
    } catch (error) {
      console.error('Error fetching stores:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.role, user?.accessScope]);

  useEffect(() => {
    const isGlobalViewer = user?.role === 'Viewer' && !user?.assignedStore;
    if (user?.role !== 'Super Admin' && !isGlobalViewer) {
      navigate('/');
      return;
    }
    fetchPortalStores();
  }, [user, navigate, fetchPortalStores]);

  useEffect(() => {
    if (user?.role !== 'Super Admin') return;
    if (!emailStoreId && stores.length > 0) {
      setEmailStoreId(stores[0]._id);
    }
  }, [user?.role, emailStoreId, stores]);

  useEffect(() => {
    if (user?.role !== 'Super Admin') return;
    const loadGatePassLogo = async () => {
      try {
        const res = await api.get('/system/public-config');
        const stamp = Date.now();
        setGatePassLogoUrl(res.data?.gatePassLogoUrl ? `${res.data.gatePassLogoUrl}?v=${stamp}` : '/gatepass-logo.svg');
        setAppLogoPreviewUrl(res.data?.logoUrl ? `${res.data.logoUrl}?v=${stamp}` : '');
      } catch {
        setGatePassLogoUrl('/gatepass-logo.svg');
        setAppLogoPreviewUrl('');
      }
    };
    loadGatePassLogo();
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'Super Admin') return;
    if (!emailStoreId) return;
    const loadEmailConfig = async () => {
      try {
        setEmailLoading(true);
        const res = await api.get('/system/email-config', { params: { storeId: emailStoreId } });
        const cfg = res.data?.emailConfig || {};
        setEmailConfig({
          smtpHost: cfg.smtpHost || '',
          smtpPort: cfg.smtpPort || 587,
          username: cfg.username || '',
          password: cfg.password || '',
          encryption: cfg.encryption || 'TLS',
          fromEmail: cfg.fromEmail || '',
          fromName: cfg.fromName || '',
          ppmNotificationSubject: cfg.ppmNotificationSubject || 'Expo City Dubai PPM Notification',
          assetNotificationSubject: cfg.assetNotificationSubject || 'Expo City Dubai Asset Notification',
          notificationRecipients: Array.isArray(cfg.notificationRecipients) ? cfg.notificationRecipients.join(', ') : '',
          technicianRecipients: Array.isArray(cfg.technicianRecipients) ? cfg.technicianRecipients.join(', ') : '',
          adminRecipients: Array.isArray(cfg.adminRecipients) ? cfg.adminRecipients.join(', ') : '',
          viewerRecipients: Array.isArray(cfg.viewerRecipients) ? cfg.viewerRecipients.join(', ') : '',
          managerRecipients: Array.isArray(cfg.managerRecipients) ? cfg.managerRecipients.join(', ') : '',
          lineManagerRecipients: Array.isArray(cfg.lineManagerRecipients) ? cfg.lineManagerRecipients.join(', ') : '',
          requireLineManagerApprovalForCollection: Boolean(cfg.requireLineManagerApprovalForCollection),
          collectionApprovalRecipients: Array.isArray(cfg.collectionApprovalRecipients) ? cfg.collectionApprovalRecipients.join(', ') : '',
          enabled: Boolean(cfg.enabled)
        });
        setTestEmail(user?.email || '');
      } catch (error) {
        console.error('Error loading email configuration:', error);
      } finally {
        setEmailLoading(false);
      }
    };
    loadEmailConfig();
  }, [user?.role, emailStoreId, user?.email]);

  const fetchBackupArtifacts = async () => {
    if (user?.role !== 'Super Admin') return;
    try {
      setBackupsLoading(true);
      const res = await api.get('/system/backups?limit=100');
      const body = res.data;
      if (Array.isArray(body)) {
        setBackupArtifacts(body);
        setLocalMongodumpEnabled(false);
        setMongodumpAvailable(null);
        setMongorestoreAvailable(null);
      } else {
        setBackupArtifacts(Array.isArray(body?.backups) ? body.backups : []);
        setLocalMongodumpEnabled(body?.localMongodumpEnabled === true);
        setMongodumpAvailable(typeof body?.mongodumpAvailable === 'boolean' ? body.mongodumpAvailable : null);
        setMongorestoreAvailable(typeof body?.mongorestoreAvailable === 'boolean' ? body.mongorestoreAvailable : null);
      }
    } catch (error) {
      console.error('Failed to load backups:', error);
    } finally {
      setBackupsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role !== 'Super Admin') return;
    fetchBackupArtifacts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  useEffect(() => {
    if (!showResetModal || user?.role !== 'Super Admin') return;
    fetchBackupArtifacts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResetModal]);

  const fetchCloudBackupConfig = async () => {
    if (user?.role !== 'Super Admin') return;
    try {
      _setCloudLoading(true);
      const res = await api.get('/system/backup-cloud-config');
      setCloudConfig((prev) => ({ ...prev, ...(res.data || {}) }));
    } catch (error) {
      console.error('Failed to load cloud backup config:', error);
    } finally {
      _setCloudLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role !== 'Super Admin') return;
    fetchCloudBackupConfig();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  const _saveCloudBackupConfig = async () => {
    try {
      _setCloudSaving(true);
      await api.put('/system/backup-cloud-config', cloudConfig);
      alert('Cloud backup configuration saved.');
      await fetchCloudBackupConfig();
    } catch (error) {
      alert('Save failed: ' + (error.response?.data?.message || error.message));
    } finally {
      _setCloudSaving(false);
    }
  };

  const handleSelectStore = (store) => {
    selectStore(store);
    // Use setTimeout to ensure state update propagates before navigation
    // This prevents a potential redirect loop where ProtectedRoute sees the old null activeStore
    setTimeout(() => {
      navigate('/');
    }, 100);
  };

  const handleInitializeSystem = async () => {
    if (!window.confirm('This will create default main stores (SCY, IT, NOC). Continue?')) return;
    
    try {
      setLoading(true);
      await api.post('/system/seed');
      await fetchPortalStores();
      alert('System initialized successfully.');
    } catch (err) {
      console.error(err);
      alert('Failed to initialize system: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleResetDatabase = async () => {
    if (!resetPassword) return alert('Password required');
    if (!resetStoreId) return alert('Please select a scope');
    if (!window.confirm(`WARNING: Are you sure you want to reset data for ${resetStoreId === 'all' ? 'ALL STORES' : 'selected store'}? This cannot be undone.`)) return;

    try {
      setResetLoading(true);
      await api.post('/system/reset', {
        password: resetPassword,
        storeId: resetStoreId,
        includeUsers
      });
      alert('Reset successful');
      setResetPassword('');
      setResetStoreId('');
      setIncludeUsers(false);
      await fetchPortalStores();
      await fetchBackupArtifacts();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || 'Reset failed');
    } finally {
      setResetLoading(false);
    }
  };

  const handleRestoreArchiveFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (mongorestoreAvailable === false) {
      alert('mongorestore is not available on the server. Install MongoDB Database Tools and restart the API.');
      return;
    }
    const ok = window.confirm(
      'This will run mongorestore into the database configured by MONGO_URI on the server.\n\n' +
        '• Use only archives you trust (same app / same Mongo version ideally).\n' +
        '• By default collections are merged; server can set LOCAL_MONGORESTORE_DROP=true to drop each collection before restore (more destructive).\n' +
        '• Everyone should refresh the browser after; restart the Node server if data still looks wrong.\n\n' +
        `Continue with file: ${file.name}?`
    );
    if (!ok) return;
    const formData = new FormData();
    formData.append('backup', file);
    try {
      setRestoreUploading(true);
      const res = await api.post('/system/backups/upload-restore', formData, {
        timeout: 4 * 60 * 60 * 1000
      });
      alert(res.data?.message || 'Restore completed.');
      await fetchBackupArtifacts();
    } catch (error) {
      alert('Restore failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setRestoreUploading(false);
    }
  };

  const handleLocalMongodumpBackup = async () => {
    if (localDumpLoading) return;
    if (!mongodumpAvailable) {
      alert(
        'The server cannot find mongodump. Install MongoDB Database Tools on the same machine as the API, ensure mongodump is on PATH (or set MONGODUMP_PATH in server/.env), then restart the server.'
      );
      return;
    }
    if (!window.confirm('Create a full logical backup file on this server? Large databases can take several minutes.')) return;
    try {
      setLocalDumpLoading(true);
      const res = await api.post('/system/backups/local-mongodump', {}, { timeout: 2 * 60 * 60 * 1000 });
      alert(res.data?.message || 'Local backup created.');
      await fetchBackupArtifacts();
    } catch (error) {
      alert('Local backup failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setLocalDumpLoading(false);
    }
  };

  const handleDownloadBackupArtifact = (backup) => {
    if (backup?.metadata?.backupTool === 'pbm') {
      alert('PBM keeps snapshot data in remote storage configured for your cluster. Use Restore, or manage files with the pbm CLI on the database side.');
      return;
    }
    const id = backup?._id;
    if (!id) {
      alert('Download failed: missing backup id.');
      return;
    }
    const fileName = backup.fileName || `${backup.name || 'backup'}.archive.gz`;
    // Use a real navigation-style download so the browser sends cookies and we avoid axios
    // default 15s timeout + blob buffering issues through the Vite dev proxy ("Network Error").
    const a = document.createElement('a');
    a.href = `/api/system/backups/${id}/download`;
    a.setAttribute('download', fileName);
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDeleteBackupArtifact = async (backup) => {
    const label = backup?.metadata?.pbmBackupName || backup?.fileName || backup?.name || 'this snapshot';
    const isPbm = String(backup?.metadata?.backupTool || '') === 'pbm';
    const detail = isPbm ? 'from the catalog and remote PBM storage' : 'and remove the file on this server';
    if (!window.confirm(`Delete backup "${label}" ${detail}?`)) return;
    try {
      await api.delete(`/system/backups/${backup._id}`);
      await fetchBackupArtifacts();
    } catch (error) {
      alert('Delete failed: ' + (error.response?.data?.message || error.message));
    }
  };

  const allowedBackupTypes = ['application/gzip', 'application/x-gzip', 'application/octet-stream'];
  const maxBackupFileSize = 1024 * 1024 * 1024;

  const validateBackupFiles = (files) => {
    const valid = [];
    const errors = [];
    files.forEach((file) => {
      const lowerName = file.name.toLowerCase();
      const byName = lowerName.endsWith('.archive.gz') || lowerName.endsWith('.archive') || lowerName.endsWith('.gz');
      const byMime = allowedBackupTypes.includes(file.type) || file.type === '';
      if (!byName && !byMime) {
        errors.push(`${file.name}: invalid type`);
        return;
      }
      if (file.size > maxBackupFileSize) {
        errors.push(`${file.name}: exceeds 1024MB limit`);
        return;
      }
      valid.push(file);
    });
    return { valid, errors };
  };

  const _handleBulkFilePick = (files) => {
    const fileList = Array.from(files || []);
    const { valid, errors } = validateBackupFiles(fileList);
    if (errors.length > 0) {
      alert(`Some files were rejected:\n${errors.join('\n')}`);
    }
    setBulkFiles(valid);
    _setBulkConflicts([]);
    _setConflictActions({});
    setBulkScanIds([]);
    _setBulkSummary(null);
    const initialProgress = {};
    valid.forEach((f) => { initialProgress[f.name] = 0; });
    _setUploadProgress(initialProgress);
  };

  const _handleBulkScanUpload = async () => {
    if (bulkUploading || bulkFiles.length === 0) return;
    if (!window.confirm('Scan selected backup files for duplicates?')) return;

    try {
      setBulkUploading(true);
      const allConflicts = [];
      const scanIds = [];
      for (const file of bulkFiles) {
        const formData = new FormData();
        formData.append('backup', file);
        const res = await api.post('/system/backup-upload/scan', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (event) => {
            const percent = event.total ? Math.round((event.loaded * 100) / event.total) : 0;
            _setUploadProgress((prev) => ({ ...prev, [file.name]: percent }));
          }
        });
        if (res.data?.scanId) scanIds.push(res.data.scanId);
        if (Array.isArray(res.data?.conflicts)) {
          allConflicts.push(...res.data.conflicts);
        }
      }
      setBulkScanIds(scanIds);
      _setBulkConflicts(allConflicts);
      if (allConflicts.length === 0) {
        alert('No conflicts detected. You can now apply restore directly.');
      }
    } catch (error) {
      alert('Bulk scan failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setBulkUploading(false);
    }
  };

  const _setConflictAction = (rowId, action) => {
    _setConflictActions((prev) => ({ ...prev, [rowId]: { ...(prev[rowId] || {}), action } }));
  };

  const _handleApplyBulkRestore = async () => {
    if (bulkApplying || bulkScanIds.length === 0) return;
    if (!window.confirm('Apply backup restore with selected conflict actions?')) return;

    try {
      setBulkApplying(true);
      const res = await api.post('/system/backup-upload/apply', {
        scanIds: bulkScanIds,
        actions: _conflictActions,
        defaultAction: _defaultConflictAction,
        applyActionToAll: false
      });
      _setBulkSummary(res.data?.summary || null);
      alert('Bulk restore completed successfully.');
    } catch (error) {
      alert('Bulk restore failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setBulkApplying(false);
    }
  };

  const handleEmailField = (field, value) => {
    setEmailConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveEmailConfig = async () => {
    if (!emailStoreId) return alert('Please select a store first.');
    try {
      setEmailSaving(true);
      const split = (raw) => String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const mergedLegacy = Array.from(new Set([
        ...split(emailConfig.technicianRecipients),
        ...split(emailConfig.adminRecipients),
        ...split(emailConfig.viewerRecipients),
        ...split(emailConfig.managerRecipients)
      ])).join(', ');
      await api.put('/system/email-config', {
        storeId: emailStoreId,
        ...emailConfig,
        notificationRecipients: mergedLegacy
      });
      alert('Email configuration saved successfully.');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to save email configuration');
    } finally {
      setEmailSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!emailStoreId) return alert('Please select a store first.');
    if (!testEmail) return alert('Enter recipient email for test.');
    try {
      setTestingEmail(true);
      await api.post('/system/email-config/test', { storeId: emailStoreId, to: testEmail });
      alert('Test email sent successfully.');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to send test email');
    } finally {
      setTestingEmail(false);
    }
  };

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-app-page px-4">
      <LoadingLogo message="Loading portal…" subMessage="Preparing stores and access." sizeClass="w-24 h-24" className="text-app-main" />
    </div>
  );

  if (showMembers) {
    return (
      <div className="min-h-screen bg-app-page text-app-main">
        <header className="bg-white shadow-sm border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button 
                onClick={() => setShowMembers(false)}
                className="flex items-center text-slate-500 hover:text-slate-900 transition-colors"
              >
                <ArrowLeft size={20} className="mr-2" />
                <span className="font-medium">Back to Portal</span>
              </button>
              <div className="h-6 w-px bg-slate-300"></div>
              <h1 className="text-xl font-bold text-slate-900">Member Management</h1>
            </div>
          </div>
        </header>
        <div className="max-w-7xl mx-auto p-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
             <AddMembers />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans text-app-main bg-app-page relative overflow-x-hidden">
      
      {/* Navbar */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 md:h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 md:gap-4">
             <img src={(branding?.logoUrl) || '/logo.svg'} alt="Expo City Dubai" className="h-10 md:h-14 w-auto" />
             <div>
               <h1 className="text-lg md:text-xl font-bold tracking-tight text-slate-900 uppercase drop-shadow-sm leading-tight">Expo City Dubai</h1>
               <div className="flex items-center gap-2">
                 <div className="h-0.5 w-4 bg-amber-500 rounded-full"></div>
                 <p className="text-[8px] md:text-[10px] text-slate-500 tracking-[0.2em] uppercase font-bold">Asset Management Portal</p>
               </div>
             </div>
          </div>
          
          <div className="flex items-center gap-4 md:gap-6">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-bold text-slate-800 tracking-wide">{user?.name}</div>
              <div className="flex items-center justify-end gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                <div className="text-[10px] text-amber-600 font-bold uppercase tracking-widest">
                  {user?.role === 'Super Admin' ? 'Super Admin Access' : 'Viewer Access'}
                </div>
              </div>
            </div>
            
            <div 
              onClick={() => setShowPasswordModal(true)}
              className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-all cursor-pointer shadow-sm"
              title="Change Password"
            >
              <Lock size={16} className="md:w-[18px] md:h-[18px]" />
            </div>

            {user?.role === 'Super Admin' && (
              <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-all cursor-pointer shadow-sm">
                <ShieldCheck size={18} className="md:w-[20px] md:h-[20px]" />
              </div>
            )}

            <button
              onClick={async () => {
                if (window.confirm('Are you sure you want to logout?')) {
                  await logout();
                  navigate('/login');
                }
              }}
              className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center text-red-600 hover:bg-red-100 hover:text-red-700 transition-all cursor-pointer shadow-sm"
              title="Logout"
            >
              <LogOut size={16} className="md:w-[18px] md:h-[18px]" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 md:py-12 relative z-10">
        
        {/* Welcome Section */}
        <div className="mb-8 md:mb-10 text-center">
          <h2 className="text-2xl md:text-4xl font-bold text-slate-900 mb-2 md:mb-3 tracking-tight">Welcome Back, {user?.name}</h2>
          <p className="text-slate-500 text-sm md:text-lg max-w-2xl mx-auto px-4">
            Select a workspace to manage assets or use the admin tools below.
          </p>
        </div>

        {/* Pending Deletion Requests - Moved to Top for Visibility */}
        {user?.role === 'Super Admin' && deletionRequests.length > 0 && (
          <div className="mb-10 animate-fade-in-up">
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 md:p-6">
              <h3 className="text-lg font-bold text-red-800 mb-4 flex items-center gap-2">
                <AlertTriangle className="text-red-600" size={24} />
                Pending Deletion Requests
                <span className="bg-red-200 text-red-800 text-xs px-2 py-0.5 rounded-full">{deletionRequests.length}</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {deletionRequests.map(store => (
                  <div key={store._id} className="bg-white rounded-lg shadow-sm border border-red-200 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <h4 className="font-bold text-slate-900">{store.name}</h4>
                      <div className="text-sm text-slate-500 mt-1 space-y-0.5">
                         <p>Requested: {store.deletionRequestedAt ? new Date(store.deletionRequestedAt).toLocaleDateString() : 'N/A'}</p>
                         {store.deletionRequestedBy && (
                           <p className="text-xs text-slate-400">By: {store.deletionRequestedBy}</p>
                         )}
                      </div>
                    </div>
                    <button
                      onClick={() => setShowResetModal(true)}
                      className="w-full sm:w-auto px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm transition-colors shadow-sm"
                    >
                      Review & Approve
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Stores Grid Section */}
        <div className="mb-12 md:mb-16">
          <h3 className="text-xs md:text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 md:mb-6 border-b border-slate-200 pb-2">
             Active Workspaces
          </h3>
          
          {stores.length === 0 ? (
             <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 border-dashed">
                <Store size={48} className="mx-auto text-slate-300 mb-3" />
                <h3 className="text-lg font-semibold text-slate-900">No Stores Found</h3>
                <p className="text-slate-500 text-sm mb-4">No active stores are currently available.</p>
                <button 
                  onClick={handleInitializeSystem}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium text-sm shadow-sm"
                >
                  <Database size={16} />
                  Initialize System Defaults
                </button>
             </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8">
              {/* Global View Card */}
              <button
                  onClick={() => handleSelectStore('all')}
                  className="group relative bg-white border border-slate-200 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-xl hover:border-blue-500/30 transition-all duration-300 text-left flex flex-col justify-between h-auto min-h-[180px] md:h-56 overflow-hidden"
                >
                    <div className="absolute top-0 right-0 w-24 h-24 md:w-32 md:h-32 bg-gradient-to-br from-blue-500/10 to-transparent rounded-bl-full -mr-8 -mt-8 md:-mr-10 md:-mt-10 transition-transform group-hover:scale-110 opacity-50 group-hover:opacity-100"></div>
                    <div className="relative z-10 w-full">
                        <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 mb-4 group-hover:scale-110 transition-transform duration-300 shadow-sm">
                            <Activity size={24} />
                        </div>
                        <h3 className="text-lg md:text-xl font-bold text-slate-900 mb-1 group-hover:text-blue-700 transition-colors">Global View</h3>
                        <p className="text-xs md:text-sm text-slate-500 font-medium">View All Assets & Stores</p>
                    </div>
                    <div className="relative z-10 flex items-center text-blue-600 font-bold text-xs md:text-sm mt-4 group-hover:translate-x-1 transition-transform">
                        <span>Enter System</span>
                        <ChevronRight size={16} className="ml-1" />
                    </div>
                </button>

              {stores.map((store) => (
                <button
                  key={store._id}
                  onClick={() => handleSelectStore(store)}
                  className={`group relative bg-white border border-slate-200 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-xl hover:border-amber-500/30 transition-all duration-300 text-left flex flex-col justify-between h-auto min-h-[180px] md:h-56 overflow-hidden ${
                    activeStore?._id === store._id 
                      ? 'ring-2 ring-amber-500 shadow-amber-500/10' 
                      : ''
                  }`}
                >
                  <div className="absolute top-0 right-0 w-24 h-24 md:w-32 md:h-32 bg-gradient-to-br from-amber-500/10 to-transparent rounded-bl-full -mr-8 -mt-8 md:-mr-10 md:-mt-10 transition-transform group-hover:scale-110 opacity-50 group-hover:opacity-100"></div>
                  
                  <div className="relative z-10 w-full">
                    <div className="flex items-center justify-between mb-4 md:mb-6">
                      <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl md:rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-700 group-hover:bg-amber-500 group-hover:text-white group-hover:border-amber-500 transition-all shadow-inner">
                        <Building2 size={24} className="md:w-[28px] md:h-[28px]" />
                      </div>
                      {activeStore?._id === store._id && (
                        <span className="inline-flex items-center px-2 py-0.5 md:px-3 md:py-1 rounded-full text-[10px] md:text-xs font-bold bg-green-50 text-green-600 border border-green-200">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    
                    <h4 className="text-xl md:text-2xl font-bold text-slate-900 mb-1 group-hover:text-amber-600 transition-colors tracking-wide truncate">
                      {store.name}
                    </h4>
                    <p className="text-xs md:text-sm text-slate-400 font-mono">
                      ID: {String(store?._id || 'N/A').slice(-6).toUpperCase()}
                    </p>
                  </div>

                  <div className="relative z-10 pt-4 border-t border-slate-100 mt-4 md:mt-auto flex justify-between items-center w-full">
                    <span className="text-[10px] md:text-xs font-medium text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${store.isActive ? 'bg-green-500' : 'bg-green-500'}`}></div>
                      {store.openingTime} - {store.closingTime}
                    </span>
                    <div className="flex items-center text-amber-500 text-xs md:text-sm font-bold opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all transform translate-x-0 md:translate-x-4 md:group-hover:translate-x-0">
                      ENTER <ChevronRight size={14} className="ml-1 md:w-[16px] md:h-[16px]" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions Grid - Admin Tools */}
        {user?.role === 'Super Admin' && (
        <div className="mb-8">
           <h3 className="text-xs md:text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 md:mb-6 border-b border-slate-200 pb-2">
             Admin Utilities
           </h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
             {/* Manage Members Card */}
             <div 
               onClick={() => setShowMembers(true)}
               className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 hover:bg-slate-50 hover:border-blue-500/30 cursor-pointer transition-all group flex items-center gap-4 md:gap-5 shadow-sm"
             >
               <div className="p-3 md:p-4 bg-blue-50 rounded-lg text-blue-600 group-hover:bg-blue-500 group-hover:text-white transition-colors border border-blue-100">
                 <Users size={20} className="md:w-[24px] md:h-[24px]" />
               </div>
               <div>
                 <h3 className="text-base md:text-lg font-bold text-slate-900 mb-0.5 md:mb-1 group-hover:text-blue-600 transition-colors">Manage Members</h3>
                 <p className="text-slate-500 text-xs md:text-sm">Add/Remove Admins & Technicians</p>
               </div>
               <ChevronRight size={18} className="ml-auto text-slate-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all md:w-[20px] md:h-[20px]" />
             </div>

             {/* Local file backup / USB + optional controlled reset */}
             <div
               onClick={() => setShowResetModal(true)}
               className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 hover:bg-slate-50 hover:border-indigo-300/80 cursor-pointer transition-all group flex items-center gap-4 md:gap-5 shadow-sm"
             >
               <div className="p-3 md:p-4 bg-indigo-50 rounded-lg text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors border border-indigo-100">
                 <Database size={20} className="md:w-[24px] md:h-[24px]" />
               </div>
               <div>
                <h3 className="text-base md:text-lg font-bold text-slate-900 mb-0.5 md:mb-1 group-hover:text-indigo-700 transition-colors">Backups &amp; database</h3>
                <p className="text-slate-500 text-xs md:text-sm">Download a local archive (USB-friendly) and restore from file</p>
               </div>
               <Settings size={18} className="ml-auto text-slate-400 group-hover:text-indigo-500 group-hover:rotate-45 transition-all md:w-[20px] md:h-[20px]" />
             </div>
            
            {/* Customize Application Logo */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 shadow-sm">
              <div className="flex items-center gap-4 md:gap-5">
                <div className="p-3 md:p-4 bg-amber-50 rounded-lg text-amber-600 border border-amber-100">
                  <Settings size={20} className="md:w-[24px] md:h-[24px]" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base md:text-lg font-bold text-slate-900 mb-1">Customize Application Logo</h3>
                  <p className="text-slate-500 text-xs md:text-sm mb-3">Upload PNG, JPG, or SVG. Max 2 MB.</p>
                  <div className="flex items-center gap-4">
                    <img src={appLogoPreviewUrl || branding?.logoUrl || '/logo.svg'} alt="Current Logo" className="h-10 w-auto rounded border border-slate-200 p-1 bg-white" />
                    <label className="inline-flex items-center px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 cursor-pointer text-sm font-medium border border-slate-200">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp,.png,.jpg,.jpeg,.svg,.webp"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 2 * 1024 * 1024) {
                            alert('File too large. Max size is 2 MB.');
                            e.target.value = '';
                            return;
                          }
                          const form = new FormData();
                          form.append('logo', file);
                          try {
                            const res = await api.post('/system/logo', form);
                            await refreshBranding();
                            const stamp = Date.now();
                            if (res.data?.logoUrl) {
                              setAppLogoPreviewUrl(`${res.data.logoUrl}?v=${stamp}`);
                            }
                            alert('Logo updated successfully.');
                          } catch (err) {
                            alert(err.response?.data?.message || 'Upload failed');
                          } finally {
                            e.target.value = '';
                          }
                        }}
                      />
                      <span>Select Logo…</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Customize Gate Pass Logo */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 shadow-sm">
              <div className="flex items-center gap-4 md:gap-5">
                <div className="p-3 md:p-4 bg-emerald-50 rounded-lg text-emerald-600 border border-emerald-100">
                  <ShieldCheck size={20} className="md:w-[24px] md:h-[24px]" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base md:text-lg font-bold text-slate-900 mb-1">Customize Gate Pass Logo</h3>
                  <p className="text-slate-500 text-xs md:text-sm mb-3">Used on gate pass preview, print/PDF, and gate pass emails. PNG, JPG, or SVG. Max 2 MB.</p>
                  <div className="flex items-center gap-4">
                    <img src={gatePassLogoUrl || '/gatepass-logo.svg'} alt="Current Gate Pass Logo" className="h-10 w-auto rounded border border-slate-200 p-1 bg-white" />
                    <label className="inline-flex items-center px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 cursor-pointer text-sm font-medium border border-slate-200">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp,.png,.jpg,.jpeg,.svg,.webp"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 2 * 1024 * 1024) {
                            alert('File too large. Max size is 2 MB.');
                            e.target.value = '';
                            return;
                          }
                          const form = new FormData();
                          form.append('logo', file);
                          try {
                            const res = await api.post('/system/gatepass-logo', form);
                            const stamp = Date.now();
                            setGatePassLogoUrl(res.data?.gatePassLogoUrl ? `${res.data.gatePassLogoUrl}?v=${stamp}` : '/gatepass-logo.svg');
                            alert('Gate pass logo updated successfully.');
                          } catch (err) {
                            alert(err.response?.data?.message || 'Upload failed');
                          } finally {
                            e.target.value = '';
                          }
                        }}
                      />
                      <span>Select Gate Pass Logo…</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Customize Email Configuration */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 shadow-sm">
              <div className="flex items-center gap-4 md:gap-5">
                <div className="p-3 md:p-4 bg-indigo-50 rounded-lg text-indigo-600 border border-indigo-100">
                  <Mail size={20} className="md:w-[24px] md:h-[24px]" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base md:text-lg font-bold text-slate-900 mb-1">Customize Email Configuration</h3>
                  <p className="text-slate-500 text-xs md:text-sm mb-3">
                    Configure notification email SMTP per store (Super Admin only).
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <select
                      value={emailStoreId}
                      onChange={(e) => setEmailStoreId(e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white text-slate-900"
                    >
                      <option value="">Select store</option>
                      {stores.map((store) => (
                        <option key={store._id} value={store._id}>{store.name}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={emailConfig.smtpHost}
                      onChange={(e) => handleEmailField('smtpHost', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm"
                      placeholder="SMTP Host"
                    />
                    <input
                      type="number"
                      value={emailConfig.smtpPort}
                      onChange={(e) => handleEmailField('smtpPort', Number(e.target.value || 0))}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm"
                      placeholder="SMTP Port"
                    />
                    <input
                      type="text"
                      value={emailConfig.username}
                      onChange={(e) => handleEmailField('username', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm"
                      placeholder="SMTP Username"
                    />
                    <input
                      type="password"
                      value={emailConfig.password}
                      onChange={(e) => handleEmailField('password', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm"
                      placeholder="SMTP Password"
                    />
                    <select
                      value={emailConfig.encryption}
                      onChange={(e) => handleEmailField('encryption', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm"
                    >
                      <option value="TLS">TLS</option>
                      <option value="SSL">SSL</option>
                    </select>
                    <input
                      type="text"
                      value={emailConfig.fromEmail}
                      onChange={(e) => handleEmailField('fromEmail', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm"
                      placeholder="From Email"
                    />
                    <input
                      type="text"
                      value={emailConfig.fromName}
                      onChange={(e) => handleEmailField('fromName', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm md:col-span-2"
                      placeholder="From Name"
                    />
                    <input
                      type="text"
                      value={emailConfig.ppmNotificationSubject}
                      onChange={(e) => handleEmailField('ppmNotificationSubject', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm md:col-span-2"
                      placeholder="PPM Notification Subject Prefix"
                    />
                    <input
                      type="text"
                      value={emailConfig.assetNotificationSubject}
                      onChange={(e) => handleEmailField('assetNotificationSubject', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm md:col-span-2"
                      placeholder="Asset Notification Subject Prefix"
                    />
                    <input
                      type="text"
                      value={emailConfig.technicianRecipients}
                      onChange={(e) => handleEmailField('technicianRecipients', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm md:col-span-2"
                      placeholder="Technician notification emails (comma-separated)"
                    />
                    <input
                      type="text"
                      value={emailConfig.adminRecipients}
                      onChange={(e) => handleEmailField('adminRecipients', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm md:col-span-2"
                      placeholder="Admin notification emails (comma-separated)"
                    />
                    <input
                      type="text"
                      value={emailConfig.viewerRecipients}
                      onChange={(e) => handleEmailField('viewerRecipients', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm md:col-span-2"
                      placeholder="Viewer notification emails (comma-separated)"
                    />
                    <input
                      type="text"
                      value={emailConfig.managerRecipients}
                      onChange={(e) => handleEmailField('managerRecipients', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm md:col-span-2"
                      placeholder="Manager notification emails (comma-separated)"
                    />
                    <label className="md:col-span-2 inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(emailConfig.requireLineManagerApprovalForCollection)}
                        onChange={(e) => handleEmailField('requireLineManagerApprovalForCollection', e.target.checked)}
                      />
                      Require line manager approval before technician can collect asset
                    </label>
                    <input
                      type="text"
                      value={emailConfig.collectionApprovalRecipients}
                      onChange={(e) => handleEmailField('collectionApprovalRecipients', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm md:col-span-2"
                      placeholder="Collection approval line manager emails (comma-separated)"
                    />
                  </div>
                  <div className="flex flex-wrap gap-3 mt-4 items-center">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={emailConfig.enabled}
                        onChange={(e) => handleEmailField('enabled', e.target.checked)}
                      />
                      Enable this store email configuration
                    </label>
                    <input
                      type="email"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      className="border border-slate-300 rounded-lg p-2 text-sm min-w-[220px]"
                      placeholder="Test recipient email"
                    />
                    <button
                      type="button"
                      onClick={handleTestEmail}
                      disabled={testingEmail || !emailStoreId || emailLoading}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
                    >
                      <Send size={14} />
                      {testingEmail ? 'Sending...' : 'Test Email'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEmailConfig}
                      disabled={emailSaving || !emailStoreId || emailLoading}
                      className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                      {emailSaving ? 'Saving...' : 'Save Configuration'}
                    </button>
                    {emailLoading && <span className="text-xs text-slate-400">Loading configuration...</span>}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white/60 backdrop-blur-md border-t border-slate-200 py-4 md:py-6 mt-auto relative z-10 text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-3 md:gap-4">
           <p className="text-xs md:text-sm">© {new Date().getFullYear()} Expo City Dubai. All rights reserved.</p>
           <div className="flex gap-4 md:gap-6 text-xs md:text-sm opacity-80">
             <span>v{CLIENT_APP_VERSION}</span>
             <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> System Status: Online</span>
           </div>
        </div>
      </footer>

      <ChangePasswordModal 
        isOpen={showPasswordModal} 
        onClose={() => setShowPasswordModal(false)} 
      />

      {/* Database maintenance modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 transition-opacity">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="maintenance-modal-title"
            className="bg-white rounded-2xl p-0 max-w-6xl w-[95vw] max-h-[92vh] shadow-2xl overflow-hidden border border-slate-200/80"
          >
            <div className="bg-gradient-to-r from-slate-50 to-indigo-50/40 px-6 py-5 border-b border-slate-200 flex justify-between items-start gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="p-2.5 bg-white rounded-xl text-indigo-600 border border-indigo-100 shadow-sm shrink-0">
                  <Database size={22} aria-hidden />
                </div>
                <div className="min-w-0">
                  <h2 id="maintenance-modal-title" className="text-lg font-semibold text-slate-900 tracking-tight">
                    Backup &amp; restore
                  </h2>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Local full backup files (copy to USB) and restore from an archive; optional data reset below
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="text-slate-500 hover:text-slate-800 p-2 hover:bg-white/80 rounded-lg transition-colors shrink-0"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(92vh-140px)]">
              {!localMongodumpEnabled && (
                <div className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 mb-6" role="status">
                  <Info className="text-slate-600 shrink-0 mt-0.5" size={18} aria-hidden />
                  <div className="text-sm text-slate-800 leading-relaxed space-y-1">
                    <p className="font-medium text-slate-900">Local backup and file restore are turned off on this server.</p>
                    <p className="text-xs text-slate-600">
                      Set <code className="font-mono text-[11px] bg-white px-1 py-0.5 rounded border border-slate-200">ENABLE_LOCAL_MONGODUMP=true</code> in{' '}
                      <code className="font-mono text-[11px] bg-white px-1 py-0.5 rounded border border-slate-200">server/.env</code>, install MongoDB Database Tools on the API host, restart the server, then open this dialog again. See{' '}
                      <code className="font-mono text-[11px]">HOW_TO_BACKUP_DATABASE.md</code> in the repository.
                    </p>
                  </div>
                </div>
              )}

              {localMongodumpEnabled && (
                <div className="flex gap-3 rounded-xl border border-emerald-200/90 bg-emerald-50/70 px-4 py-3 mb-6" role="region" aria-label="Local USB backup">
                  <Info className="text-emerald-700 shrink-0 mt-0.5" size={18} aria-hidden />
                  <div className="text-sm text-emerald-950 leading-relaxed space-y-3 flex-1">
                    <div>
                      <p className="font-medium text-emerald-900">Simple local backup (no cloud)</p>
                      <p className="text-xs text-emerald-900/90 mt-1">
                        Creates one <code className="rounded bg-white/80 px-1 border border-emerald-200/80">.archive.gz</code> file on this server using{' '}
                        <code className="rounded bg-white/80 px-1 border border-emerald-200/80">mongodump</code>. Then click <strong>Download</strong> on the new row — your browser saves the file — then copy that file to your USB drive in File Explorer or Finder.
                        There is <strong>no &quot;upload to USB&quot;</strong> in the app: the USB is just a folder on your computer.
                        In production, set <code className="font-mono text-[11px]">ENABLE_LOCAL_MONGODUMP=true</code> explicitly.
                      </p>
                    </div>
                    {mongodumpAvailable === false && (
                      <p className="text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1.5">
                        mongodump was not found on the server PATH. Install MongoDB Database Tools and restart the API.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handleLocalMongodumpBackup}
                      disabled={localDumpLoading || backupsLoading || mongodumpAvailable !== true}
                      className={`inline-flex items-center justify-center px-4 py-2.5 rounded-lg text-sm font-medium shadow-sm transition-colors ${
                        localDumpLoading || backupsLoading || mongodumpAvailable !== true
                          ? 'bg-emerald-200 text-emerald-900 cursor-not-allowed'
                          : 'bg-emerald-700 text-white hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2'
                      }`}
                    >
                      {localDumpLoading ? 'Creating local backup…' : 'Create local full backup (USB)'}
                    </button>
                    <div className="pt-3 mt-3 border-t border-emerald-200/80">
                      <p className="text-xs font-medium text-emerald-900 mb-2">Restore from a file (e.g. copy from USB back to this PC)</p>
                      <input
                        ref={restoreArchiveInputRef}
                        type="file"
                        accept=".archive,.archive.gz,.gz,application/gzip,application/x-gzip,application/octet-stream"
                        className="hidden"
                        onChange={handleRestoreArchiveFileChange}
                      />
                      {mongorestoreAvailable === false && (
                        <p className="text-xs text-slate-700 mb-2 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1.5">
                          mongorestore was not found on the server PATH. Install MongoDB Database Tools (same package as mongodump) and restart the API.
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => restoreArchiveInputRef.current?.click()}
                        disabled={restoreUploading || backupsLoading || mongorestoreAvailable === false}
                        className={`inline-flex items-center justify-center px-4 py-2.5 rounded-lg text-sm font-medium shadow-sm transition-colors border border-emerald-300 ${
                          restoreUploading || backupsLoading || mongorestoreAvailable === false
                            ? 'bg-slate-100 text-slate-500 cursor-not-allowed border-slate-200'
                            : 'bg-white text-emerald-900 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2'
                        }`}
                      >
                        {restoreUploading ? 'Restoring from file…' : 'Choose backup file to restore (.archive/.archive.gz)'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6">
                <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Database size={16} className="text-indigo-600" aria-hidden />
                      Local backup files
                    </h3>
                    <button
                      type="button"
                      onClick={() => fetchBackupArtifacts()}
                      disabled={backupsLoading}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-900 disabled:opacity-50 px-2 py-1 rounded-md hover:bg-indigo-50"
                    >
                      <RefreshCw size={14} className={backupsLoading ? 'animate-spin' : ''} aria-hidden />
                      Refresh list
                    </button>
                  </div>
                  <div className="p-4 space-y-4">
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Archives created on this server appear here. Use <strong>Download</strong> to save a copy (for example to a USB drive), or <strong>Delete</strong> to remove the file from disk and the catalog.
                    </p>
                    <div className="rounded-lg border border-slate-200 overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr className="text-left">
                            <th className="px-3 py-2 font-medium">File</th>
                            <th className="px-3 py-2 font-medium">Created</th>
                            <th className="px-3 py-2 font-medium">Size</th>
                            <th className="px-3 py-2 font-medium">Type</th>
                            <th className="px-3 py-2 font-medium">App</th>
                            <th className="px-3 py-2 font-medium text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {backupsLoading && (
                            <tr>
                              <td className="px-3 py-8 text-center text-slate-500" colSpan={6}>
                                <span className="inline-flex items-center gap-2">
                                  <RefreshCw size={14} className="animate-spin text-indigo-500" aria-hidden />
                                  Loading backups…
                                </span>
                              </td>
                            </tr>
                          )}
                          {!backupsLoading &&
                            backupArtifacts.filter((b) => !isPbmArtifact(b)).length === 0 && (
                            <tr>
                              <td className="px-3 py-10 text-center text-slate-500" colSpan={6}>
                                <p className="text-sm text-slate-600 mb-1">No local backup files yet</p>
                                <p className="text-xs text-slate-500 max-w-md mx-auto">
                                  When local backup is enabled, use <strong>Create local full backup (USB)</strong> above, then refresh this list.
                                </p>
                              </td>
                            </tr>
                          )}
                          {!backupsLoading &&
                            backupArtifacts
                              .filter((b) => !isPbmArtifact(b))
                              .map((b) => (
                            <tr key={b._id} className="hover:bg-slate-50/80">
                              <td className="px-3 py-2 text-slate-900 font-mono text-[10px] align-top break-all max-w-[200px] sm:max-w-xs">
                                {b.fileName || b.name}
                              </td>
                              <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{formatArtifactDate(b.createdAt)}</td>
                              <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{formatArtifactSize(b.sizeBytes)}</td>
                              <td className="px-3 py-2 text-slate-600">{b.backupType || '—'}</td>
                              <td className="px-3 py-2 text-slate-600">{b.appVersion || '—'}</td>
                              <td className="px-3 py-2 text-right">
                                <div className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1">
                                  <button type="button" onClick={() => handleDownloadBackupArtifact(b)} className="text-indigo-600 hover:text-indigo-800 font-medium">
                                    Download
                                  </button>
                                  <button type="button" onClick={() => handleDeleteBackupArtifact(b)} className="text-red-600 hover:text-red-800 font-medium">
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

                <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-4">
                  <h3 className="text-sm font-semibold text-red-800 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-red-700" />
                    Reset Database
                  </h3>
                  <p className="text-xs text-red-700">
                    This action removes transactional data for the selected scope.
                  </p>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Select Target Scope</label>
                    <select
                      value={resetStoreId}
                      onChange={(e) => setResetStoreId(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none bg-white text-slate-900"
                    >
                      <option value="">-- Select Store to Reset --</option>
                      <option value="all">⚠️ ENTIRE SYSTEM (All Stores)</option>
                      {stores.map((store) => (
                        <option key={store._id} value={store._id}>{store.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-white transition-colors bg-white">
                      <input
                        type="radio"
                        name="deletionOption"
                        checked={!includeUsers}
                        onChange={() => setIncludeUsers(false)}
                        className="w-4 h-4 text-red-600 focus:ring-red-500 border-gray-300"
                      />
                      <div className="ml-3">
                        <span className="block text-sm font-medium text-slate-900">Data Only (Standard)</span>
                        <span className="block text-xs text-slate-500">Deletes assets and logs. Keeps all users.</span>
                      </div>
                    </label>
                    <label className="flex items-center p-3 border border-red-200 rounded-lg cursor-pointer hover:bg-red-100 transition-colors bg-red-50/50">
                      <input
                        type="radio"
                        name="deletionOption"
                        checked={includeUsers}
                        onChange={() => setIncludeUsers(true)}
                        className="w-4 h-4 text-red-600 focus:ring-red-500 border-gray-300"
                      />
                      <div className="ml-3">
                        <span className="block text-sm font-bold text-red-700">Full Wipe (Data + Users)</span>
                        <span className="block text-xs text-red-600">Deletes data and all Admins/Technicians.</span>
                      </div>
                    </label>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Super Admin Password</label>
                    <input
                      type="password"
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-shadow"
                      placeholder="Enter password to confirm..."
                    />
                  </div>

                  <button
                    onClick={handleResetDatabase}
                    disabled={resetLoading || !resetStoreId || !resetPassword}
                    className="w-full bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-bold shadow-sm flex items-center justify-center gap-2"
                  >
                    {resetLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        <span>Processing Reset...</span>
                      </>
                    ) : (
                      <>
                        <Database size={16} />
                        <span>Confirm Database Reset</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="bg-slate-50 px-6 py-3 border-t border-slate-200">
              <p className="text-xs text-slate-500 text-center">
                Operations on this page affect live data. Close the dialog when you are finished.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Portal;
