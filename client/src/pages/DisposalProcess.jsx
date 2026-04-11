import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import { downloadJsonAutoXlsx } from '../utils/excelExport';

const DisposalProcess = () => {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [activeTab, setActiveTab] = useState('faulty');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      let params = { limit: 100 };
      if (activeTab === 'faulty') params = { ...params, condition: 'Faulty', disposed: 'false' };
      if (activeTab === 'repaired') params = { ...params, condition: 'Repaired', disposed: 'false' };
      if (activeTab === 'disposed') params = { ...params, disposed: 'true' };
      const primary = await api.get('/assets', { params });
      const merged = [
        ...(primary.data.items || [])
      ];
      const dedup = [];
      const seen = new Set();
      for (const a of merged) {
        const key = a._id || `${a.serial_number}-${a.store?._id || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          dedup.push(a);
        }
      }
      setAssets(dedup);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchAssets, 15000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchAssets]);

  const handleMarkRepaired = async (assetId) => {
    if (actionInFlight) return;
    try {
      setActionInFlight(true);
      await api.post('/assets/maintenance/mark-repaired', { assetId });
      // Instant feedback in faulty tab.
      setAssets((prev) => prev.filter((a) => a._id !== assetId));
      fetchAssets();
    } catch (err) {
      console.error(err);
      alert(err?.response?.data?.message || 'Failed to update asset');
    } finally {
      setActionInFlight(false);
    }
  };

  const handleDispose = async (asset) => {
    if (actionInFlight) return;
    try {
      setActionInFlight(true);
      await api.post('/assets/maintenance/dispose', { assetId: asset._id, reason: 'Not repairable' });
      // Instant feedback in faulty tab.
      setAssets((prev) => prev.filter((a) => a._id !== asset._id));
      // Move user directly to disposed history after successful disposal.
      setActiveTab('disposed');
    } catch (err) {
      console.error(err);
      alert(err?.response?.data?.message || 'Failed to dispose asset');
    } finally {
      setActionInFlight(false);
    }
  };

  const exportRepairedToExcel = async () => {
    const rows = assets.map(a => ({
      UniqueID: a.uniqueId || '',
      Category: a.category || '',
      AssetType: a.name || '',
      ProductName: a.product_name || '',
      SerialNumber: a.serial_number || '',
      ModelNumber: a.model_number || '',
      Manufacturer: a.manufacturer || '',
      MACAddress: a.mac_address || '',
      TicketNumber: a.ticket_number || '',
      PONumber: a.po_number || '',
      VendorName: a.vendor_name || '',
      Condition: a.condition || '',
      Status: activeTab === 'disposed' ? 'Disposed' : (a.status || ''),
      Store: (a.store?.parentStore?.name) || (a.store?.name) || '',
      Location: a.location || '',
      DisposedAt: a.disposed_at ? new Date(a.disposed_at).toLocaleString() : '',
      DisposedBy: a.disposed_by || '',
      DisposalReason: a.disposal_reason || '',
      CreatedAt: a.createdAt ? new Date(a.createdAt).toLocaleString() : '',
      UpdatedAt: a.updatedAt ? new Date(a.updatedAt).toLocaleString() : ''
    }));
    const sheetName = activeTab === 'disposed' ? 'Disposed' : 'Repaired';
    const filename = activeTab === 'disposed' ? 'disposed_assets.xlsx' : 'repaired_assets.xlsx';
    await downloadJsonAutoXlsx(filename, sheetName, rows);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Asset Maintenance Process</h1>

      <div className="flex gap-4 mb-6 border-b">
        <button
          className={`pb-2 px-4 font-medium ${activeTab === 'faulty' ? 'text-amber-600 border-b-2 border-amber-600' : 'text-gray-500'}`}
          onClick={() => setActiveTab('faulty')}
        >
          Faulty Assets
        </button>
        <button
          className={`pb-2 px-4 font-medium ${activeTab === 'repaired' ? 'text-amber-600 border-b-2 border-amber-600' : 'text-gray-500'}`}
          onClick={() => setActiveTab('repaired')}
        >
          Repaired History
        </button>
        <button
          className={`pb-2 px-4 font-medium ${activeTab === 'disposed' ? 'text-amber-600 border-b-2 border-amber-600' : 'text-gray-500'}`}
          onClick={() => setActiveTab('disposed')}
        >
          Disposed History
        </button>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={fetchAssets}
            className="bg-gray-200 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-300"
          >
            Refresh
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh
          </label>
        </div>
      </div>

      <div className="bg-white p-4 rounded shadow">
        {loading ? (
          <p>Loading...</p>
        ) : assets.length === 0 ? (
          <p className="text-sm text-gray-500">No assets found in this category.</p>
        ) : (
          <div className="overflow-x-auto">
            {(activeTab === 'repaired' || activeTab === 'disposed') && (
              <div className="flex justify-end mb-3">
                <button
                  onClick={exportRepairedToExcel}
                  className="bg-amber-600 hover:bg-amber-700 text-black px-4 py-2 rounded"
                >
                  Download Excel
                </button>
              </div>
            )}
            <div className="flex items-center justify-between mb-3 text-sm text-gray-600">
              <div>
                <span className="font-semibold">Total:</span> {assets.length}
              </div>
              {activeTab === 'faulty' && (
                <div>
                  <span className="font-semibold">Ready to repair:</span> {assets.filter(a => String(a.condition || '').toLowerCase() === 'faulty').length}
                </div>
              )}
            </div>
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Asset Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Serial Number</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Model Number</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Manufacturer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Condition</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unique ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                  {activeTab === 'disposed' && (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Disposed At</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Disposed By</th>
                    </>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {assets.map(a => (
                  <tr key={a._id}>
                    <td className="px-6 py-4">{a.category || '-'}</td>
                    <td className="px-6 py-4">{a.name}</td>
                    <td className="px-6 py-4">{a.product_name || '-'}</td>
                    <td className="px-6 py-4">{a.serial_number}</td>
                    <td className="px-6 py-4">{a.model_number || '-'}</td>
                    <td className="px-6 py-4">{a.manufacturer || '-'}</td>
                    <td className="px-6 py-4">{a.condition || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs rounded-full ${activeTab === 'disposed' ? 'bg-red-100 text-red-800' : (String(a.condition || '').toLowerCase() === 'faulty' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800')}`}>
                        {activeTab === 'disposed' ? 'Disposed' : (a.status || '-')}
                      </span>
                    </td>
                    <td className="px-6 py-4">{a.uniqueId || '-'}</td>
                    <td className="px-6 py-4">{a.location || '-'}</td>
                    {activeTab === 'disposed' && (
                      <>
                        <td className="px-6 py-4">{a.disposed_at ? new Date(a.disposed_at).toLocaleString() : '-'}</td>
                        <td className="px-6 py-4">{a.disposed_by || '-'}</td>
                      </>
                    )}
                    <td className="px-6 py-4">
                      {activeTab === 'faulty' && (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleMarkRepaired(a._id)}
                            disabled={actionInFlight}
                            className={`font-medium ${actionInFlight ? 'text-slate-400 cursor-not-allowed' : 'text-emerald-700 hover:text-emerald-900'}`}
                          >
                            Mark as Repaired
                          </button>
                          <button
                            onClick={() => handleDispose(a)}
                            disabled={actionInFlight}
                            className={`font-medium ${actionInFlight ? 'text-slate-400 cursor-not-allowed' : 'text-red-600 hover:text-red-900'}`}
                          >
                            Dispose
                          </button>
                        </div>
                      )}
                      {(activeTab === 'repaired' || activeTab === 'disposed') && (
                        <span className="text-gray-400">Archived</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default DisposalProcess;
