import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Search, Clock, User, Calendar, AlertCircle, Activity } from 'lucide-react';
import api from '../api/axios';

const ProductDetails = () => {
  const { productName } = useParams();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(250);
  
  // Client-side pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Decode product name from URL
  const decodedProductName = decodeURIComponent(productName);

  useEffect(() => {
    const fetchAssets = async () => {
      setLoading(true);
      try {
        const params = { page: 1, limit, product_name: decodedProductName };
        const res = await api.get('/assets', { params });
        setAssets(res.data.items || []);
        setPage(1);
        setTotal(res.data.total || (res.data.items || []).length);
      } catch (err) {
        console.error('Failed to fetch product assets:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAssets();
  }, [decodedProductName, limit]);

  const loadMore = async () => {
    const nextPage = page + 1;
    setLoading(true);
    try {
      const params = { page: nextPage, limit, product_name: decodedProductName };
      const res = await api.get('/assets', { params });
      setAssets(prev => [...prev, ...(res.data.items || [])]);
      setPage(nextPage);
      setTotal(res.data.total || total);
    } catch (err) {
      console.error('Failed to fetch more assets:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filter assets: search by Serial Number or Unique ID only (as requested)
  const filteredAssets = assets.filter(asset => 
    asset.serial_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    asset.uniqueId?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination Logic
  const totalPages = Math.ceil(filteredAssets.length / itemsPerPage);
  const paginatedAssets = filteredAssets.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  // Calculate stats
  const stats = {
    total: assets.reduce((sum, a) => sum + (Number(a.quantity) > 0 ? Number(a.quantity) : 1), 0),
    inUse: assets.reduce((sum, a) => {
      const q = Number(a.quantity) > 0 ? Number(a.quantity) : 1;
      if ((a.status === 'In Use') || a.assigned_to || (a.assigned_to_external && a.assigned_to_external.name)) {
        return sum + q;
      }
      return sum;
    }, 0),
    inStore: assets.reduce((sum, a) => {
      const q = Number(a.quantity) > 0 ? Number(a.quantity) : 1;
      if (!['Missing', 'In Use'].includes(a.status) && !a.assigned_to && !(a.assigned_to_external && a.assigned_to_external.name)) {
        return sum + q;
      }
      return sum;
    }, 0),
    faulty: assets.reduce((sum, a) => {
      const q = Number(a.quantity) > 0 ? Number(a.quantity) : 1;
      if (String(a.condition || '').toLowerCase().includes('faulty')) {
        return sum + q;
      }
      return sum;
    }, 0),
    missing: assets.reduce((sum, a) => {
      const q = Number(a.quantity) > 0 ? Number(a.quantity) : 1;
      if (a.status === 'Missing') {
        return sum + q;
      }
      return sum;
    }, 0),
    repaired: assets.reduce((sum, a) => {
      const q = Number(a.quantity) > 0 ? Number(a.quantity) : 1;
      if (String(a.condition || '').toLowerCase().includes('repair')) {
        return sum + q;
      }
      return sum;
    }, 0)
  };

  const getStatusBadge = (asset) => {
    const status = asset.status;
    if (status === 'In Use' || asset.assigned_to || (asset.assigned_to_external && asset.assigned_to_external.name)) {
      return { label: 'In Use', color: 'bg-emerald-100 text-emerald-800' };
    }
    if (status === 'Missing') {
      return { label: 'Missing', color: 'bg-orange-100 text-orange-800' };
    }
    return { label: 'In Store', color: 'bg-sky-100 text-sky-800' };
  };

  const openHistory = (asset) => {
    setSelectedAsset(asset);
    setShowHistoryModal(true);
  };

  const HistoryModal = () => {
    if (!selectedAsset) return null;
    
    const sortedHistory = [...(selectedAsset.history || [])].sort((a, b) => 
      new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt)
    );

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Asset History</h2>
              <p className="text-sm text-gray-500">Serial: {selectedAsset.serial_number}</p>
            </div>
            <button 
              onClick={() => setShowHistoryModal(false)}
              className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-full"
            >
              ✕
            </button>
          </div>
          
          <div className="overflow-y-auto p-6 space-y-6">
            {sortedHistory.length === 0 ? (
              <p className="text-center text-gray-500 py-4">No history records found.</p>
            ) : (
              sortedHistory.map((event, index) => (
                <div key={index} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 z-10">
                      <Activity size={14} />
                    </div>
                    {index < sortedHistory.length - 1 && (
                      <div className="w-0.5 h-full bg-gray-100 -my-1"></div>
                    )}
                  </div>
                  <div className="flex-1 pb-6">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-semibold text-gray-900">{event.action}</span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {new Date(event.date || event.createdAt || Date.now()).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100">
                      <div className="grid grid-cols-2 gap-2">
                        {event.user && (
                          <div className="flex items-center gap-2">
                            <User size={12} className="text-gray-400" />
                            <span>By: {event.user}</span>
                          </div>
                        )}
                        {event.ticket_number && (
                          <div className="flex items-center gap-2">
                            <AlertCircle size={12} className="text-gray-400" />
                            <span>Ticket: {event.ticket_number}</span>
                          </div>
                        )}
                      </div>
                      {event.details && (
                        <div className="mt-2 pt-2 border-t border-gray-200/50 text-gray-500 italic">
                          {event.details}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-6 mb-8">
        <Link 
          to="/products" 
          className="inline-flex items-center text-gray-500 hover:text-blue-600 transition-colors gap-2 self-start"
        >
          <ArrowLeft size={20} />
          <span>Back to Products</span>
        </Link>
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{decodedProductName}</h1>
            <p className="text-gray-500 mt-1">Product History & Inventory Status</p>
          </div>
          
          {/* Stats Cards */}
          <div className="flex flex-wrap gap-2">
            <div className="bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Total</span>
              <span className="text-xl font-bold text-gray-900">{stats.total}</span>
            </div>
            <div className="bg-blue-50 px-4 py-2 rounded-lg border border-blue-100 shadow-sm">
              <span className="text-xs font-bold text-blue-400 uppercase tracking-wider block">In Use</span>
              <span className="text-xl font-bold text-blue-700">{stats.inUse}</span>
            </div>
            <div className="bg-green-50 px-4 py-2 rounded-lg border border-green-100 shadow-sm">
              <span className="text-xs font-bold text-green-400 uppercase tracking-wider block">In Store</span>
              <span className="text-xl font-bold text-green-700">{stats.inStore}</span>
            </div>
            <div className="bg-red-50 px-4 py-2 rounded-lg border border-red-100 shadow-sm">
              <span className="text-xs font-bold text-red-400 uppercase tracking-wider block">Faulty</span>
              <span className="text-xl font-bold text-red-700">{stats.faulty}</span>
            </div>
            <div className="bg-amber-50 px-4 py-2 rounded-lg border border-amber-100 shadow-sm">
              <span className="text-xs font-bold text-amber-500 uppercase tracking-wider block">Repaired</span>
              <span className="text-xl font-bold text-amber-700">{stats.repaired}</span>
            </div>
            <div className="bg-gray-50 px-4 py-2 rounded-lg border border-gray-200 shadow-sm">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Missing</span>
              <span className="text-xl font-bold text-gray-700">{stats.missing}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Product History</h2>
            <span className="text-xs text-gray-500">All events</span>
          </div>
          <div className="space-y-3 max-h-[320px] overflow-auto">
            {assets
              .flatMap(a => (a.history || []).map(h => ({
                ...h,
                serial: a.serial_number,
                uniqueId: a.uniqueId
              })))
              .sort((x, y) => new Date(y.date || y.createdAt || 0) - new Date(x.date || x.createdAt || 0))
              .slice(0, 50)
              .map((ev, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-md bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
                    <Activity size={14} />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-900">{ev.action}</span>
                      <span className="text-xs text-gray-400">{new Date(ev.date || ev.createdAt || Date.now()).toLocaleString()}</span>
                    </div>
                    <div className="text-sm text-gray-600">
                      <span className="mr-3">UID: {ev.uniqueId || 'N/A'}</span>
                      <span>SN: {ev.serial || 'N/A'}</span>
                    </div>
                    {ev.user && <div className="text-xs text-gray-500 mt-1">By {ev.user}</div>}
                    {ev.ticket_number && <div className="text-xs text-gray-500">Ticket {ev.ticket_number}</div>}
                  </div>
                </div>
              ))
            }
            {assets.length === 0 && (
              <div className="text-gray-500 text-sm">No history available.</div>
            )}
          </div>
        </div>
        <div className="lg:col-span-2"></div>
      </div>

      {/* Linked Assets Search */}
      <div className="mb-6 relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search linked assets by Serial Number or Unique ID..."
          className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm text-lg"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Linked Assets Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading assets...</div>
      ) : filteredAssets.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="text-gray-400 mb-2">
            <Search size={48} className="mx-auto opacity-20" />
          </div>
          <p className="text-gray-500 text-lg">No linked assets found matching your search.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unique ID</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Serial Number</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Condition</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location / Store</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned User</th>
                  <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedAssets.map((asset) => (
                  <tr key={asset._id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="font-bold text-gray-900">{asset.uniqueId || 'N/A'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-bold text-gray-900">{asset.serial_number || 'N/A'}</span>
                        {asset.serial_last_4 && <span className="text-xs text-gray-500">Last 4: {asset.serial_last_4}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-semibold text-gray-900">
                        {Number(asset.quantity) > 0 ? Number(asset.quantity) : 1}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {(() => {
                        const { label, color } = getStatusBadge(asset);
                        return (
                          <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${color}`}>
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-900">{asset.condition || 'N/A'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {asset.location || 'N/A'}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        Store: {asset.store?.name || asset.store?.name || 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {asset.assigned_to ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">
                            {asset.assigned_to.name.charAt(0)}
                          </div>
                          <span className="text-sm text-gray-900">{asset.assigned_to.name}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button 
                        onClick={() => openHistory(asset)}
                        className="text-blue-600 hover:text-blue-900 flex items-center gap-1 ml-auto hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Clock size={16} />
                        View History
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50">
              <div className="text-sm text-gray-500">
                Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredAssets.length)}</span> of <span className="font-medium">{filteredAssets.length}</span> results
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
                {assets.length < total && (
                  <button
                    onClick={loadMore}
                    className="px-3 py-1 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                  >
                    Load More
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {showHistoryModal && <HistoryModal />}
    </div>
  );
};

export default ProductDetails;
