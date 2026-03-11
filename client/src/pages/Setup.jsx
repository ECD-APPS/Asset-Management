import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Truck, FileText, Box, CheckSquare, RefreshCw, Trash2, Database, AlertTriangle, Mail, Send, Palette } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

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
    enabled: true
  });
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState({
    enabled: true,
    notifyReceiver: true,
    notifyIssuer: true,
    notifyLineManager: false
  });
  const isMainAdmin = user?.role === 'Super Admin';
  const canManageEmail = user?.role === 'Super Admin';
  const [themeSaving, setThemeSaving] = useState(false);

  const resolveUserStoreId = () => {
    const raw = user?.assignedStore;
    if (!raw) return '';
    return typeof raw === 'string' ? raw : raw?._id || '';
  };

  useEffect(() => {
    if (isMainAdmin) {
      const fetchData = async () => {
        try {
          const [storageRes, storesRes] = await Promise.all([
            api.get('/system/storage'),
            api.get('/system/stores')
          ]);
          setStorage(storageRes.data);
          setStores(storesRes.data || []);
          
          // Filter for deletion requests
          const requests = storesRes.data.filter(s => s.deletionRequested);
          setDeletionRequests(requests);
          if (!selectedStoreId && storesRes.data?.length > 0) {
            setSelectedStoreId(storesRes.data[0]._id);
          }
        } catch (e) {
          console.error(e);
        }
      };
      fetchData();
    }
  }, [isMainAdmin, selectedStoreId]);

  useEffect(() => {
    if (!canManageEmail) return;
    if (user?.role === 'Admin') {
      const ownStoreId = resolveUserStoreId();
      if (ownStoreId && selectedStoreId !== ownStoreId) {
        setSelectedStoreId(ownStoreId);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.assignedStore]);

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

  useEffect(() => {
    if (user?.role !== 'Admin') return;

    const loadPreferences = async () => {
      try {
        setNotifLoading(true);
        const res = await api.get('/system/notification-preferences');
        const prefs = res.data?.notificationPreferences || {};
        setNotificationPreferences({
          enabled: prefs.enabled !== false,
          notifyReceiver: prefs.notifyReceiver !== false,
          notifyIssuer: prefs.notifyIssuer !== false,
          notifyLineManager: Boolean(prefs.notifyLineManager)
        });
      } catch (error) {
        console.error(error);
      } finally {
        setNotifLoading(false);
      }
    };

    loadPreferences();
  }, [user?.role]);

  const handleEmailField = (field, value) => {
    setEmailConfig((prev) => ({ ...prev, [field]: value }));
  };
  const effectiveEmailStoreId = user?.role === 'Super Admin' ? selectedStoreId : resolveUserStoreId();

  const updateNotificationPreferenceField = (field, value) => {
    setNotificationPreferences((prev) => ({ ...prev, [field]: value }));
  };

  const saveNotificationPreferences = async () => {
    try {
      setNotifSaving(true);
      await api.put('/system/notification-preferences', notificationPreferences);
      alert('Notification preferences saved.');
    } catch (error) {
      alert('Failed to save notification preferences: ' + (error.response?.data?.message || error.message));
    } finally {
      setNotifSaving(false);
    }
  };

  const themeOptions = [
    { value: 'default', label: 'Default (Expo Amber)' },
    { value: 'ocean', label: 'Ocean Glass (Blue)' },
    { value: 'emerald', label: 'Emerald Glow (Green)' },
    { value: 'sunset', label: 'Sunset Flow (Warm)' },
    { value: 'midnight', label: 'Midnight Neon (Dark)' },
    { value: 'mono', label: 'Mono Pro (Minimal)' }
  ];

  const applyTheme = async (newTheme) => {
    if (!newTheme || themeSaving || (branding?.theme || 'default') === newTheme) return;
    try {
      setThemeSaving(true);
      await api.post('/system/theme', { theme: newTheme });
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
                              alert('Error: ' + e.message);
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
                      const res = await api.post('/system/backup');
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

      {/* Store Admin Deletion Request */}
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

      {user?.role === 'Admin' && (
        <div className="mt-12 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center mb-6">
            <Mail className="w-6 h-6 text-indigo-600 mr-2" />
            <h2 className="text-xl font-bold text-gray-800">Email Notifications</h2>
          </div>
          {notifLoading ? (
            <p className="text-sm text-gray-500">Loading notification preferences...</p>
          ) : (
            <div className="space-y-4">
              <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={notificationPreferences.enabled}
                  onChange={(e) => updateNotificationPreferenceField('enabled', e.target.checked)}
                />
                <div>
                  <p className="font-semibold text-gray-800">Enable Email Notifications</p>
                  <p className="text-sm text-gray-500">Master switch for all notification emails.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={notificationPreferences.notifyReceiver}
                  onChange={(e) => updateNotificationPreferenceField('notifyReceiver', e.target.checked)}
                />
                <div>
                  <p className="font-semibold text-gray-800">Enable Notification to Receiver</p>
                  <p className="text-sm text-gray-500">Notify assigned/receiving user on asset movement.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={notificationPreferences.notifyIssuer}
                  onChange={(e) => updateNotificationPreferenceField('notifyIssuer', e.target.checked)}
                />
                <div>
                  <p className="font-semibold text-gray-800">Enable Notification to Issuer</p>
                  <p className="text-sm text-gray-500">Send confirmation emails to issuer/admin who performed the action.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={notificationPreferences.notifyLineManager}
                  onChange={(e) => updateNotificationPreferenceField('notifyLineManager', e.target.checked)}
                />
                <div>
                  <p className="font-semibold text-gray-800">Enable Notification to Line Manager</p>
                  <p className="text-sm text-gray-500">Notify store-level manager for critical movement events.</p>
                </div>
              </label>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={saveNotificationPreferences}
                  disabled={notifSaving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {notifSaving ? 'Saving...' : 'Save Preferences'}
                </button>
              </div>
            </div>
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
              <h2 className="text-xl font-bold text-gray-800">Store Email Configuration</h2>
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
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={emailConfig.enabled} onChange={(e) => handleEmailField('enabled', e.target.checked)} />
                  Enable this store email configuration
                </label>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-end pt-2">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Test Email Recipient</label>
                    <input className="w-full border border-gray-300 rounded-lg px-3 py-2" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
                  </div>
                  <button onClick={handleTestEmail} disabled={testingEmail || !effectiveEmailStoreId} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                    <Send size={16} />
                    {testingEmail ? 'Sending...' : 'Test Email'}
                  </button>
                  <button onClick={handleSaveEmailConfig} disabled={emailSaving || !effectiveEmailStoreId} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {emailSaving ? 'Saving...' : 'Save Configuration'}
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
