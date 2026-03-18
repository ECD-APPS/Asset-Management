import { useState, useEffect, useCallback, useRef } from 'react';
import PurchaseOrders from './PurchaseOrders';
import api from '../api/axios';
import ImportAssetsModal from '../components/ImportAssetsModal';
import { Upload, Download, FileSpreadsheet, RefreshCw, Truck, Briefcase, UserCog } from 'lucide-react';
import * as XLSX from 'xlsx';

const ReceiveProcess = () => {
  const [activeTab, setActiveTab] = useState('vendor');
  const [pendingReturns, setPendingReturns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [recentActivity, setRecentActivity] = useState([]);
  const [recentAssets, setRecentAssets] = useState([]);
  const [showRecentAssets, setShowRecentAssets] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [returnActionAssetId, setReturnActionAssetId] = useState('');
  const [filterForm, setFilterForm] = useState({
    query: '',
    serial: '',
    model: '',
    location: '',
    vendor: '',
    dateFrom: '',
    dateTo: ''
  });
  const [assetFilters, setAssetFilters] = useState(null);
  const assetsReqSeq = useRef(0);
  const importsReqSeq = useRef(0);
  const pendingReqSeq = useRef(0);


  const fetchPendingReturns = useCallback(async () => {
    const seq = ++pendingReqSeq.current;
    setLoading(true);
    try {
      const res = await api.get('/assets/return-pending');
      if (seq !== pendingReqSeq.current) return;
      setPendingReturns(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      if (seq === pendingReqSeq.current) setLoading(false);
    }
  }, []);

  const fetchRecentAssets = useCallback(async (overrideFilters) => {
    const seq = ++assetsReqSeq.current;
    setAssetsLoading(true);
    try {
      const params = { limit: 50 };
      const sourceMap = {
        contractor: 'Contractor',
        technician: 'Technician',
        vendor: 'Vendor'
      };
      if (sourceMap[activeTab]) params.source = sourceMap[activeTab];
      const filters = overrideFilters || assetFilters;
      if (filters) {
        if (filters.query) params.q = filters.query;
        if (filters.serial) params.serial_number = filters.serial;
        if (filters.model) params.model_number = filters.model;
        if (filters.location) params.location = filters.location;
        if (filters.vendor) params.vendor_name = filters.vendor;
        if (filters.dateFrom) params.date_from = filters.dateFrom;
        if (filters.dateTo) params.date_to = filters.dateTo;
      }
      const res = await api.get('/assets', { params });
      if (seq !== assetsReqSeq.current) return;
      setRecentAssets(res.data.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      if (seq === assetsReqSeq.current) setAssetsLoading(false);
    }
  }, [activeTab, assetFilters]);

  const fetchRecentImports = useCallback(async () => {
    const seq = ++importsReqSeq.current;
    setActivityLoading(true);
    try {
      const params = { limit: 20 };
      if (activeTab === 'contractor') params.source = 'Contractor';
      
      const res = await api.get('/assets/recent-activity', { params });
      if (seq !== importsReqSeq.current) return;
      // Filter for import-related activities
      const imports = res.data.filter(log => 
        log.action === 'Bulk Force Import' || 
        log.action === 'Create Asset' || 
        log.details?.toLowerCase().includes('import')
      );
      setRecentActivity(imports);
    } catch (err) {
      console.error(err);
    } finally {
      if (seq === importsReqSeq.current) setActivityLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'technician') {
      fetchPendingReturns();
    } else if (activeTab === 'contractor') {
      fetchRecentImports();
    }

    if (showRecentAssets) {
      fetchRecentAssets();
    }
  }, [activeTab, showRecentAssets, fetchPendingReturns, fetchRecentImports, fetchRecentAssets]);

  const handleApproveReturn = async (assetId) => {
    if (!assetId || returnActionAssetId) return;
    try {
      setReturnActionAssetId(assetId);
      await api.post('/assets/return-approve', { assetId });
      fetchPendingReturns();
    } catch (err) {
      console.error(err);
    } finally {
      setReturnActionAssetId('');
    }
  };

  const handleRejectReturn = async (assetId) => {
    if (!assetId || returnActionAssetId) return;
    try {
      setReturnActionAssetId(assetId);
      await api.post('/assets/return-reject', { assetId });
      fetchPendingReturns();
    } catch (err) {
      console.error(err);
    } finally {
      setReturnActionAssetId('');
    }
  };

  const exportTechnicianReturns = () => {
    if (pendingReturns.length === 0) return;
    
    const data = pendingReturns.map(item => ({
      'Asset Name': item.name,
      'Serial Number': item.serial_number,
      'Requested By': item.return_request?.requested_by_name || '-',
      'Condition': item.return_request?.condition || '-',
      'Ticket Number': item.return_request?.ticket_number || '-',
      'Request Date': item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '-'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Technician Returns');
    XLSX.writeFile(wb, `Technician_Returns_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportRecentAssets = () => {
    if (recentAssets.length === 0) return;

    const data = recentAssets.map(item => ({
      'Asset Name': item.name,
      'Serial Number': item.serial_number,
      'Model': item.model_number,
      'Vendor Name': item.vendor_name,
      'Delivered By': item.delivered_by_name,
      'Delivered At': item.delivered_at ? new Date(item.delivered_at).toLocaleString() : (item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'),
      'Status': item.status,
      'Category': item.category,
      'Last Updated': item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Received Assets');
    XLSX.writeFile(wb, `Received_Assets_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleApplyAssetFilters = (e) => {
    e.preventDefault();
    const next = {
      query: filterForm.query.trim(),
      serial: filterForm.serial.trim(),
      model: filterForm.model.trim(),
      location: filterForm.location.trim(),
      vendor: filterForm.vendor.trim(),
      dateFrom: filterForm.dateFrom,
      dateTo: filterForm.dateTo
    };
    setAssetFilters(next);
    if (showRecentAssets) {
      fetchRecentAssets(next);
    } else {
      setShowRecentAssets(true);
    }
  };

  const renderAssetFilters = () => (
    <div className="px-4 pt-4 pb-2 bg-white border-b border-gray-200">
      <form onSubmit={handleApplyAssetFilters} className="grid gap-3 md:grid-cols-6 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600">Search</label>
          <input
            type="text"
            value={filterForm.query}
            onChange={(e) => setFilterForm({ ...filterForm, query: e.target.value })}
            className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            placeholder="Name, ticket, unique ID"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Serial</label>
          <input
            type="text"
            value={filterForm.serial}
            onChange={(e) => setFilterForm({ ...filterForm, serial: e.target.value })}
            className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            placeholder="Serial number"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Model</label>
          <input
            type="text"
            value={filterForm.model}
            onChange={(e) => setFilterForm({ ...filterForm, model: e.target.value })}
            className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            placeholder="Model number"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Location</label>
          <input
            type="text"
            value={filterForm.location}
            onChange={(e) => setFilterForm({ ...filterForm, location: e.target.value })}
            className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            placeholder="Store location"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Vendor / Contractor / Tech</label>
          <input
            type="text"
            value={filterForm.vendor}
            onChange={(e) => setFilterForm({ ...filterForm, vendor: e.target.value })}
            className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            placeholder="Vendor name"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">From</label>
          <input
            type="date"
            value={filterForm.dateFrom}
            onChange={(e) => setFilterForm({ ...filterForm, dateFrom: e.target.value })}
            className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">To</label>
          <input
            type="date"
            value={filterForm.dateTo}
            onChange={(e) => setFilterForm({ ...filterForm, dateTo: e.target.value })}
            className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          />
        </div>
        <div className="md:col-span-6 flex justify-end mt-2">
          <button
            type="submit"
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 shadow-sm"
          >
            Apply Filters
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <div className="p-6 min-h-screen bg-gray-50">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Receive Process</h1>
          <p className="text-sm text-gray-500 mt-1">Manage incoming deliveries and returns</p>
        </div>
      </div>
      
      {/* Modern Tabs */}
      <div className="bg-white p-1.5 rounded-xl border border-gray-200 inline-flex mb-8 shadow-sm">
        <button
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'vendor' 
              ? 'bg-blue-600 text-white shadow-md transform scale-105' 
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
          onClick={() => setActiveTab('vendor')}
        >
          <Truck className="w-4 h-4" />
          <span>Vendor Deliveries</span>
        </button>
        <button
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'contractor' 
              ? 'bg-blue-600 text-white shadow-md transform scale-105' 
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
          onClick={() => setActiveTab('contractor')}
        >
          <Briefcase className="w-4 h-4" />
          <span>Contractor Deliveries</span>
        </button>
        <button
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'technician' 
              ? 'bg-blue-600 text-white shadow-md transform scale-105' 
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
          onClick={() => setActiveTab('technician')}
        >
          <UserCog className="w-4 h-4" />
          <span>Technician Returns</span>
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 min-h-[500px]">
        {activeTab === 'vendor' && (
          <div className="p-1">
             {showRecentAssets && (
             <div className="bg-white rounded-lg border border-gray-200 mb-6 mx-4 mt-4 overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
               <div className="flex justify-between items-center p-4 bg-gray-50 border-b border-gray-200">
                   <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                     <Briefcase className="w-4 h-4 text-gray-500" />
                     Recently Received / Updated Assets
                   </h3>
                   <button
                     onClick={exportRecentAssets}
                     disabled={recentAssets.length === 0}
                     className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors border
                       ${recentAssets.length === 0 
                         ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' 
                         : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                   >
                     <Download className="w-3.5 h-3.5" />
                     Export List
                   </button>
                </div>
                {renderAssetFilters()}
                
                {assetsLoading ? (
                   <div className="text-center py-8 text-gray-500">Loading assets...</div>
                ) : recentAssets.length === 0 ? (
                   <div className="text-center py-8 text-gray-500">
                     No recent assets found.
                   </div>
                ) : (
                  <div className="overflow-x-auto max-h-[400px]">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Asset Name</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Serial</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendor Name</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Delivered By</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Delivered At</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                       {recentAssets.map((asset) => (
                         <tr key={asset._id} className="hover:bg-gray-50">
                           <td className="px-4 py-3 text-sm font-medium text-gray-900">{asset.name}</td>
                           <td className="px-4 py-3 text-sm text-gray-500">{asset.serial_number}</td>
                           <td className="px-4 py-3 text-sm text-gray-500">{asset.vendor_name || '-'}</td>
                           <td className="px-4 py-3 text-sm text-gray-500">{asset.delivered_by_name || '-'}</td>
                           <td className="px-4 py-3 text-sm">
                             <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                               ${asset.status === 'Available' ? 'bg-green-100 text-green-800' : 
                                 asset.status === 'In Use' ? 'bg-blue-100 text-blue-800' : 
                                 'bg-gray-100 text-gray-800'}`}>
                               {asset.status}
                             </span>
                           </td>
                           <td className="px-4 py-3 text-sm text-gray-500">
                             {asset.delivered_at ? new Date(asset.delivered_at).toLocaleString() : new Date(asset.updatedAt).toLocaleString()}
                           </td>
                         </tr>
                       ))}
                      </tbody>
                    </table>
                  </div>
                )}
             </div>
             )}

             <PurchaseOrders 
               onImportClick={() => setShowImportModal(true)} 
               headerActions={(
                  <button
                   onClick={() => setShowRecentAssets(!showRecentAssets)}
                   className={`flex items-center gap-2 px-4 py-2 rounded flex items-center gap-2 shadow-sm transition-all border ${
                     showRecentAssets 
                       ? 'bg-blue-50 text-blue-700 border-blue-200' 
                       : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                   }`}
                  >
                    <Briefcase className="w-4 h-4" />
                    Recently Received
                  </button>
               )}
             />
          </div>
        )}

        {activeTab === 'contractor' && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Contractor Deliveries</h2>
                <p className="text-sm text-gray-500">Manage assets delivered by contractors</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowRecentAssets(!showRecentAssets)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors border ${
                    showRecentAssets 
                      ? 'bg-blue-50 text-blue-700 border-blue-200' 
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <Briefcase className="w-4 h-4" />
                  Recently Received Assets
                </button>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
                >
                  <Upload className="w-4 h-4" />
                  Bulk Import Assets
                </button>
              </div>
            </div>

            {showRecentAssets && (
            <div className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
               <div className="flex justify-between items-center p-4 bg-gray-50 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-gray-500" />
                    Recently Received / Updated Assets
                  </h3>
                  <button
                    onClick={exportRecentAssets}
                    disabled={recentAssets.length === 0}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors border
                      ${recentAssets.length === 0 
                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' 
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export List
                  </button>
               </div>
               {renderAssetFilters()}
               
               {assetsLoading ? (
                  <div className="text-center py-8 text-gray-500">Loading assets...</div>
               ) : recentAssets.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No recent assets found.
                  </div>
               ) : (
                  <div className="overflow-x-auto max-h-[400px]">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Asset Name</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Serial</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Delivered By</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Delivered At</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {recentAssets.map((asset) => (
                          <tr key={asset._id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{asset.name}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">{asset.serial_number}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">{asset.source || '-'}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">{asset.delivered_by_name || '-'}</td>
                            <td className="px-4 py-3 text-sm">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                                ${asset.status === 'New' ? 'bg-green-100 text-green-800' : 
                                  asset.status === 'Used' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}`}>
                                {asset.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {asset.delivered_at ? new Date(asset.delivered_at).toLocaleString() : new Date(asset.updatedAt).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
               )}
            </div>
            )}

            <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <RefreshCw className={`w-4 h-4 ${activityLoading ? 'animate-spin' : ''}`} />
                Recent Import Activity
              </h3>
              
              {activityLoading ? (
                <div className="text-center py-8 text-gray-500">Loading activity...</div>
              ) : recentActivity.length === 0 ? (
                <div className="text-center py-8 text-gray-500 bg-white rounded border border-dashed border-gray-300">
                  No recent import activity found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-white rounded border border-gray-200">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {recentActivity.map((log) => (
                        <tr key={log._id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 font-medium">{log.user}</td>
                          <td className="px-4 py-3 text-sm text-blue-600">{log.action}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{log.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'technician' && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                 <h2 className="text-lg font-semibold text-gray-800">Technician Returns</h2>
                 <p className="text-sm text-gray-500">Review and approve asset returns</p>
              </div>
              <div className="flex gap-3">
                 <button
                   onClick={() => setShowRecentAssets(!showRecentAssets)}
                   className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors border ${
                     showRecentAssets 
                       ? 'bg-blue-50 text-blue-700 border-blue-200' 
                       : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                   }`}
                 >
                   <Briefcase className="w-4 h-4" />
                   Recently Received
                 </button>
                 <button
                   onClick={() => setShowImportModal(true)}
                   className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
                 >
                   <Upload className="w-4 h-4" />
                   Import Assets
                 </button>
                 <button
                   onClick={exportTechnicianReturns}
                   disabled={pendingReturns.length === 0}
                   className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium shadow-sm
                     ${pendingReturns.length === 0 
                       ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                       : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                 >
                   <Download className="w-4 h-4" />
                   Export Returns
                 </button>
              </div>
            </div>

            {showRecentAssets && (
            <div className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
               <div className="flex justify-between items-center p-4 bg-gray-50 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-gray-500" />
                    Recently Received / Updated Assets
                  </h3>
                  <button
                    onClick={exportRecentAssets}
                    disabled={recentAssets.length === 0}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors border
                      ${recentAssets.length === 0 
                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' 
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export List
                  </button>
               </div>
               {renderAssetFilters()}
               
               {assetsLoading ? (
                  <div className="text-center py-8 text-gray-500">Loading assets...</div>
               ) : recentAssets.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No recent assets found.
                  </div>
               ) : (
                  <div className="overflow-x-auto max-h-[400px]">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Asset Name</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Serial</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Delivered By</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Delivered At</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {recentAssets.map((asset) => (
                          <tr key={asset._id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{asset.name}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">{asset.serial_number}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">{asset.source || '-'}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">{asset.delivered_by_name || '-'}</td>
                            <td className="px-4 py-3 text-sm">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                                ${asset.status === 'Available' ? 'bg-green-100 text-green-800' : 
                                  asset.status === 'In Use' ? 'bg-blue-100 text-blue-800' : 
                                  'bg-gray-100 text-gray-800'}`}>
                                {asset.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {asset.delivered_at ? new Date(asset.delivered_at).toLocaleString() : new Date(asset.updatedAt).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
               )}
            </div>
            )}

            {loading ? (
              <div className="text-center py-12">
                <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-2"></div>
                <p className="text-gray-500">Loading pending returns...</p>
              </div>
            ) : pendingReturns.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                <p className="text-gray-500">No pending return requests</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Asset</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Serial</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Requested By</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Condition</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ticket</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {pendingReturns.map(a => (
                      <tr key={a._id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{a.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{a.serial_number}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{a.return_request?.requested_by_name || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                            ${a.return_request?.condition === 'Good' ? 'bg-green-100 text-green-800' : 
                              a.return_request?.condition === 'Faulty' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                            {a.return_request?.condition}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{a.return_request?.ticket_number || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex gap-3">
                            <button
                              onClick={() => handleApproveReturn(a._id)}
                              disabled={Boolean(returnActionAssetId)}
                              className={`px-3 py-1 rounded border transition-all ${returnActionAssetId ? 'text-slate-400 bg-slate-100 border-slate-200 cursor-not-allowed' : 'text-green-600 hover:text-green-900 bg-green-50 border-green-200 hover:border-green-300'}`}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleRejectReturn(a._id)}
                              disabled={Boolean(returnActionAssetId)}
                              className={`px-3 py-1 rounded border transition-all ${returnActionAssetId ? 'text-slate-400 bg-slate-100 border-slate-200 cursor-not-allowed' : 'text-red-600 hover:text-red-900 bg-red-50 border-red-200 hover:border-red-300'}`}
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <ImportAssetsModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        source={activeTab === 'contractor' ? 'Contractor' : (activeTab === 'vendor' ? 'Vendor' : (activeTab === 'technician' ? 'Technician' : undefined))}
        onSuccess={() => {
            if (activeTab === 'contractor') fetchRecentImports();
            if (showRecentAssets) fetchRecentAssets();
        }}
      />
    </div>
  );
};

export default ReceiveProcess;
