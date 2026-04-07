import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import { Users, ArrowLeft, Database, AlertTriangle, X, Store, Building2, ChevronRight, Settings, ShieldCheck, Activity, Search, Lock, LogOut, Mail, Send } from 'lucide-react';
import AddMembers from './AddMembers';
import ChangePasswordModal from '../components/ChangePasswordModal';
import LoadingLogo from '../components/LoadingLogo';

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
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreFileName, setRestoreFileName] = useState('');
  const [restoreFile, setRestoreFile] = useState(null);
  const [backupValidation, setBackupValidation] = useState(null);
  const [lastRestoreReport, setLastRestoreReport] = useState(null);
  const [validatingBackup, setValidatingBackup] = useState(false);
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
  const [lastBackupTime, setLastBackupTime] = useState(null);
  const [backupArtifacts, setBackupArtifacts] = useState([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [creatingFullBackup, setCreatingFullBackup] = useState(false);
  const [_emergencyRestoreLoading, _setEmergencyRestoreLoading] = useState(false);
  const [restoringBackupId, setRestoringBackupId] = useState('');
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

    const saved = window.localStorage.getItem('expo_last_backup_download');
    if (saved) {
      setLastBackupTime(saved);
    }
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
      setBackupArtifacts(Array.isArray(res.data) ? res.data : []);
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

  const handleDownloadBackup = async () => {
    if (backupLoading) return;
    if (!window.confirm('Download full system backup now? This may take a moment.')) return;
    try {
      setBackupLoading(true);
      const response = await api.get('/system/backup-file', {
        responseType: 'blob'
      });
      const blob = new Blob([response.data], { type: 'application/gzip' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const now = new Date();
      const iso = now.toISOString();
      const timestamp = iso.replace(/[:.]/g, '-');
      link.href = url;
      link.download = `expo-backup-${timestamp}.archive.gz`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      window.localStorage.setItem('expo_last_backup_download', iso);
      setLastBackupTime(iso);
    } catch (error) {
      console.error(error);
      alert('Backup download failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setBackupLoading(false);
    }
  };

  const handleCreateFullBackup = async () => {
    if (creatingFullBackup) return;
    try {
      setCreatingFullBackup(true);
      const res = await api.post('/system/backups/create', { backupType: 'Full', trigger: 'manual' });
      alert(res.data?.message || 'Full backup created successfully.');
      await fetchBackupArtifacts();
    } catch (error) {
      alert('Create backup failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setCreatingFullBackup(false);
    }
  };

  const handleDownloadBackupArtifact = async (backup) => {
    try {
      const response = await api.get(`/system/backups/${backup._id}/download`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/gzip' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = backup.fileName || `${backup.name || 'backup'}.archive.gz`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert('Download failed: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleDeleteBackupArtifact = async (backup) => {
    if (!window.confirm(`Delete backup "${backup.fileName}"?`)) return;
    try {
      await api.delete(`/system/backups/${backup._id}`);
      await fetchBackupArtifacts();
    } catch (error) {
      alert('Delete failed: ' + (error.response?.data?.message || error.message));
    }
  };

  const extractRestoreReport = (responseData) => {
    const result = responseData?.result;
    if (result?.restoreReport) return result.restoreReport;
    if (result && (result.verification || result.restoredCollections || result.backupFormatVersionDetected)) return result;
    if (responseData?.restoreReport) return responseData.restoreReport;
    return null;
  };

  const handleDownloadRestoreReport = () => {
    if (!lastRestoreReport) return;
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const payload = {
        generatedAt: new Date().toISOString(),
        generatedBy: user?.email || user?.name || 'unknown',
        report: lastRestoreReport
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `restore-report-${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert('Failed to download restore report: ' + (error?.message || 'Unknown error'));
    }
  };

  const handleRestoreBackupArtifact = async (backup) => {
    if (!window.confirm('This will overwrite current system data. Continue?')) return;
    try {
      setRestoringBackupId(backup._id);
      const res = await api.post(`/system/backups/${backup._id}/restore`);
      const report = extractRestoreReport(res.data);
      setLastRestoreReport(report);
      alert('Restore completed successfully. Review restore report below.');
    } catch (error) {
      alert('Restore failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setRestoringBackupId('');
    }
  };

  const validateRestoreFile = async (file) => {
    if (!file) return;
    const { valid, errors } = validateBackupFiles([file]);
    if (errors.length > 0 || valid.length === 0) {
      setRestoreFile(null);
      setBackupValidation(null);
      alert(`File rejected:\n${errors.join('\n') || 'Invalid backup file.'}`);
      return;
    }

    try {
      setValidatingBackup(true);
      const formData = new FormData();
      formData.append('backup', valid[0]);
      const res = await api.post('/system/backups/validate-upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setRestoreFile(valid[0]);
      setRestoreFileName(valid[0].name || '');
      setBackupValidation(res.data?.report || null);
    } catch (error) {
      setRestoreFile(null);
      setBackupValidation(null);
      alert('Validation failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setValidatingBackup(false);
    }
  };

  const handleRestoreFromFile = async () => {
    if (!restoreFile) {
      alert('Please select and validate a backup file first.');
      return;
    }
    if (restoreLoading) return;
    if (backupValidation?.status === 'blocked') {
      alert('This backup is blocked by compatibility checks. Use a compatible file.');
      return;
    }
    if (!window.confirm('Restoring will overwrite current data with the backup file. Continue?')) return;

    const formData = new FormData();
    formData.append('backup', restoreFile);

    try {
      setRestoreLoading(true);
      const res = await api.post('/system/backups/upload-restore', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const report = extractRestoreReport(res.data);
      setLastRestoreReport(report);
      alert('Restore completed successfully. Review restore report below.');
    } catch (error) {
      console.error(error);
      alert('Restore failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setRestoreLoading(false);
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
      await api.put('/system/email-config', { storeId: emailStoreId, ...emailConfig });
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
              onClick={() => {
                if (window.confirm('Are you sure you want to logout?')) {
                  logout();
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

             {/* System Maintenance Card */}
             <div 
               onClick={() => setShowResetModal(true)}
               className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 hover:bg-slate-50 hover:border-red-500/30 cursor-pointer transition-all group flex items-center gap-4 md:gap-5 shadow-sm"
             >
               <div className="p-3 md:p-4 bg-red-50 rounded-lg text-red-600 group-hover:bg-red-500 group-hover:text-white transition-colors border border-red-100">
                 <Database size={20} className="md:w-[24px] md:h-[24px]" />
               </div>
               <div>
                <h3 className="text-base md:text-lg font-bold text-slate-900 mb-0.5 md:mb-1 group-hover:text-red-600 transition-colors">Backup & Restore</h3>
                <p className="text-slate-500 text-xs md:text-sm">Mongodump backup management</p>
               </div>
               <Settings size={18} className="ml-auto text-slate-400 group-hover:text-red-500 group-hover:rotate-45 transition-all md:w-[20px] md:h-[20px]" />
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
                            const res = await api.post('/system/logo', form, {
                              headers: { 'Content-Type': 'multipart/form-data' }
                            });
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
                            const res = await api.post('/system/gatepass-logo', form, {
                              headers: { 'Content-Type': 'multipart/form-data' }
                            });
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
                      value={emailConfig.notificationRecipients}
                      onChange={(e) => handleEmailField('notificationRecipients', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm md:col-span-2"
                      placeholder="Notification recipients (comma-separated emails)"
                    />
                    <input
                      type="text"
                      value={emailConfig.lineManagerRecipients}
                      onChange={(e) => handleEmailField('lineManagerRecipients', e.target.value)}
                      className="border border-slate-300 rounded-lg p-2.5 text-sm md:col-span-2"
                      placeholder="Line manager emails (comma-separated)"
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
             <span>v2.5.0</span>
             <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> System Status: Online</span>
           </div>
        </div>
      </footer>

      <ChangePasswordModal 
        isOpen={showPasswordModal} 
        onClose={() => setShowPasswordModal(false)} 
      />

      {/* Backup & Restore Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 transition-opacity">
          <div className="bg-white rounded-2xl p-0 max-w-6xl w-[95vw] max-h-[92vh] shadow-2xl overflow-hidden animate-scale-in">
            {/* Modal Header */}
            <div className="bg-red-50 p-6 border-b border-red-100 flex justify-between items-start">
              <div className="flex items-center gap-3">
                 <div className="p-2 bg-red-100 rounded-lg text-red-600">
                    <AlertTriangle size={24} />
                 </div>
                 <div>
                    <h2 className="text-lg font-bold text-red-900">Backup & Restore</h2>
                    <p className="text-sm text-red-600">Backup & Restore</p>
                 </div>
              </div>
              <button 
                onClick={() => setShowResetModal(false)} 
                className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[calc(92vh-120px)]">
              <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-4 mb-6">
                 <p className="text-sm text-yellow-800 leading-relaxed">
                   <strong>Backup/Restore:</strong> Use this panel to create and restore `mongodump` backup archives only.
                 </p>
              </div>

              <div className="grid grid-cols-1 gap-5">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <Database size={16} className="text-slate-600" />
                    Backup & Restore
                  </h3>
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-slate-500">
                      Download a full backup file to your computer, or restore from a previously saved backup file.
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Last backup downloaded:{' '}
                      {lastBackupTime ? new Date(lastBackupTime).toLocaleString() : 'Not yet'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={handleCreateFullBackup}
                      disabled={creatingFullBackup}
                      className={`inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium shadow-sm ${
                        creatingFullBackup
                          ? 'bg-indigo-300 text-indigo-800 cursor-not-allowed'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {creatingFullBackup ? 'Creating Full Backup…' : 'Create Full Backup'}
                    </button>
                    <button
                      onClick={handleDownloadBackup}
                      disabled={backupLoading}
                      className={`inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium shadow-sm ${
                        backupLoading
                          ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                          : 'bg-slate-800 text-white hover:bg-black'
                      }`}
                    >
                      {backupLoading ? 'Preparing backup…' : 'Download Backup File'}
                    </button>
                    <label className="flex flex-col gap-2 text-xs text-slate-600 border border-slate-200 rounded-lg p-3 bg-white">
                      <span className="font-semibold text-slate-800">Upload Backup File From USB / Computer</span>
                      <input
                        type="file"
                        accept="application/gzip,.archive.gz,.archive,.gz,application/octet-stream"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setRestoreFileName(file.name);
                            setRestoreFile(null);
                            setBackupValidation(null);
                            validateRestoreFile(file);
                            e.target.value = '';
                          }
                        }}
                        className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
                      />
                      {restoreFileName && (
                        <span className="text-[11px] text-slate-500">
                          Selected: {restoreFileName} {validatingBackup ? '(validating...)' : restoreLoading ? '(restoring...)' : ''}
                        </span>
                      )}
                      {backupValidation && (
                        <div
                          className={`text-[11px] rounded p-2 border ${
                            backupValidation.status === 'safe'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                              : backupValidation.status === 'warning'
                                ? 'bg-amber-50 text-amber-700 border-amber-100'
                                : 'bg-red-50 text-red-700 border-red-100'
                          }`}
                        >
                          <div className="font-semibold uppercase">Compatibility: {backupValidation.status}</div>
                          <div>
                            Source: {backupValidation?.version?.sourceVersion || 'unknown'} | Current: {backupValidation?.version?.currentVersion || 'unknown'}
                          </div>
                          <div>
                            Format: {backupValidation?.format || '-'} | Type: {backupValidation?.backupType || '-'}
                          </div>
                          {backupValidation?.version?.reason && <div>{backupValidation.version.reason}</div>}
                          {Array.isArray(backupValidation?.issues) && backupValidation.issues.length > 0 && (
                            <div>Issues: {backupValidation.issues.join(' | ')}</div>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={handleRestoreFromFile}
                        disabled={!restoreFile || restoreLoading || validatingBackup || backupValidation?.status === 'blocked'}
                        className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium shadow-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {restoreLoading ? 'Restoring...' : 'Restore This Backup'}
                      </button>
                    </label>
                    {lastRestoreReport && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-900 space-y-1">
                        <div className="font-semibold uppercase">Restore Verification Report</div>
                        <div>
                          Backup Format: detected v{lastRestoreReport?.backupFormatVersionDetected ?? '-'} {'->'} applied v{lastRestoreReport?.backupFormatVersionApplied ?? '-'}
                        </div>
                        <div>
                          Verification: users={lastRestoreReport?.verification?.usersCount ?? 0}, stores={lastRestoreReport?.verification?.storesCount ?? 0}, assets={lastRestoreReport?.verification?.assetsCount ?? 0}, superAdmin={lastRestoreReport?.verification?.hasSuperAdmin ? 'yes' : 'no'}
                        </div>
                        <div>
                          Restored Collections: {
                            Object.entries(lastRestoreReport?.restoredCollections || {})
                              .map(([name, count]) => `${name}:${count}`)
                              .join(', ') || 'none'
                          }
                        </div>
                        {Array.isArray(lastRestoreReport?.skippedCollections) && lastRestoreReport.skippedCollections.length > 0 && (
                          <div>
                            Skipped Collections: {lastRestoreReport.skippedCollections.join(', ')}
                          </div>
                        )}
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={handleDownloadRestoreReport}
                            className="inline-flex items-center justify-center px-3 py-1.5 rounded-md text-[11px] font-medium bg-emerald-700 text-white hover:bg-emerald-800"
                          >
                            Download Restore Report (JSON)
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                      <table className="min-w-full text-[11px]">
                        <thead className="bg-slate-50">
                          <tr className="text-left text-slate-600">
                            <th className="px-2 py-1">Backup Name</th>
                            <th className="px-2 py-1">Date</th>
                            <th className="px-2 py-1">Size</th>
                            <th className="px-2 py-1">Type</th>
                            <th className="px-2 py-1">App Version</th>
                            <th className="px-2 py-1">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {backupsLoading && (
                            <tr><td className="px-2 py-2 text-slate-500" colSpan={6}>Loading backups...</td></tr>
                          )}
                          {!backupsLoading && backupArtifacts.length === 0 && (
                            <tr><td className="px-2 py-2 text-slate-500" colSpan={6}>No backups found.</td></tr>
                          )}
                          {!backupsLoading && backupArtifacts.map((b) => (
                            <tr key={b._id} className="border-t border-slate-100">
                              <td className="px-2 py-1 text-slate-800">{b.fileName || b.name}</td>
                              <td className="px-2 py-1 text-slate-600">{new Date(b.createdAt).toLocaleString()}</td>
                              <td className="px-2 py-1 text-slate-600">{((b.sizeBytes || 0) / (1024 * 1024)).toFixed(2)} MB</td>
                              <td className="px-2 py-1 text-slate-600">{b.backupType || '-'}</td>
                              <td className="px-2 py-1 text-slate-600">{b.appVersion || '-'}</td>
                              <td className="px-2 py-1">
                                <div className="flex gap-2">
                                  <button onClick={() => handleDownloadBackupArtifact(b)} className="text-indigo-600 hover:underline">Download</button>
                                  <button
                                    onClick={() => handleRestoreBackupArtifact(b)}
                                    disabled={restoringBackupId === b._id}
                                    className="text-emerald-600 hover:underline disabled:opacity-50"
                                  >
                                    {restoringBackupId === b._id ? 'Restoring...' : 'Restore'}
                                  </button>
                                  <button onClick={() => handleDeleteBackupArtifact(b)} className="text-red-600 hover:underline">Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

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
            
            <div className="bg-slate-50 px-6 py-3 border-t border-slate-100 text-center">
               <p className="text-xs text-slate-400">Action ID: {Math.random().toString(36).substr(2, 9).toUpperCase()}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Portal;
