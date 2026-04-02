import { useState, useEffect } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const TechScanner = () => {
  const [asset, setAsset] = useState(null);
  const [ticketNumber, setTicketNumber] = useState('');
  const [installationLocation, setInstallationLocation] = useState('');
  const [manualSearch, setManualSearch] = useState('');
  const [manualRfidSearch, setManualRfidSearch] = useState('');
  const [manualQrSearch, setManualQrSearch] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [bulkAssets, setBulkAssets] = useState([]);
  const { user } = useAuth();
  const [returnCondition, setReturnCondition] = useState('New');
  
  // Add Asset State
  const [showAddForm, setShowAddForm] = useState(false);
  const [stores, setStores] = useState([]);
  const [addForm, setAddForm] = useState({
    name: '',
    model_number: '',
    serial_number: '',
    mac_address: '',
    store: '',
    status: 'In Store',
    condition: 'New'
  });

  useEffect(() => {
    const fetchStores = async () => {
      try {
        const res = await api.get('/stores');
        setStores(res.data);
      } catch (e) {
        console.error(e);
      }
    };
    fetchStores();
  }, []);

  const normalizeText = (value) => String(value || '').trim().toLowerCase();
  const pickBestScannerMatch = (assetsList = [], query = '') => {
    const q = normalizeText(query);
    const list = Array.isArray(assetsList) ? assetsList : [];
    if (!q || list.length === 0) return list[0] || null;

    const byExactSerial = list.filter((item) => normalizeText(item?.serial_number) === q);
    const candidates = byExactSerial.length > 0 ? byExactSerial : list;

    const rank = (item) => {
      const reserved = item?.reserved === true || normalizeText(item?.status) === 'reserved';
      const statusText = normalizeText(item?.status);
      const conditionText = normalizeText(item?.condition);
      const repaired = conditionText.includes('repair') || statusText.includes('repair');
      const faulty = conditionText.includes('faulty') || statusText.includes('faulty');
      if (reserved) return 3;
      if (repaired) return 2;
      if (!faulty) return 1;
      return 0;
    };

    return [...candidates].sort((a, b) => {
      const scoreDiff = rank(b) - rank(a);
      if (scoreDiff !== 0) return scoreDiff;
      const at = new Date(a?.updatedAt || 0).getTime();
      const bt = new Date(b?.updatedAt || 0).getTime();
      return bt - at;
    })[0] || null;
  };

  const searchAsset = async (query, searchType = '') => {
    if (loading) return;
    const q = String(query || '').trim();
    if (!q) return;
    setLoading(true);
    setMessage('');
    setShowAddForm(false);
    try {
      const params = { query: q, ...(searchType ? { type: searchType } : {}) };
      const res = await api.get('/assets/search', { params });
      if (res.data.length > 0) {
        setAsset(pickBestScannerMatch(res.data, q));
      } else {
        setMessage('Asset not found');
        setAsset(null);
        // If the user searched by serial, prefill serial_number; for RFID/QR we can't safely infer serial.
        setAddForm(prev => ({
          ...prev,
          serial_number: searchType ? '' : q
        }));
        setShowAddForm(true);
      }
    } catch {
      setMessage('Error searching asset');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (!addForm.name || !addForm.model_number || !addForm.serial_number || !addForm.store) {
      setMessage('Please fill all required fields');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/assets', addForm);
      setAsset(res.data);
      setShowAddForm(false);
      setMessage('Asset created successfully');
      setAddForm({
        name: '',
        model_number: '',
        serial_number: '',
        mac_address: '',
        store: '',
        status: 'In Store',
        condition: 'New'
      });
    } catch (error) {
      setMessage(error.response?.data?.message || 'Error creating asset');
    } finally {
      setLoading(false);
    }
  };


  const handleAction = async (action) => {
    if (loading || !asset?._id) return;
    if (!ticketNumber) {
      setMessage('Please enter a Ticket Number');
      return;
    }

    if (action === 'collect' && !installationLocation) {
      setMessage('Please enter Installation Location');
      return;
    }
    
    try {
      setLoading(true);
      if (action === 'collect') {
        const collectedId = asset._id;
        await api.post('/assets/collect', { assetId: collectedId, ticketNumber, installationLocation });
        let collectMsg = 'Asset collected successfully';
        const askGatePass = window.confirm(
          'Generate gate pass now? It will be saved for admin approval; email is sent only after an admin approves.'
        );
        if (askGatePass) {
          try {
            const gp = await api.post('/assets/collect-gatepass', {
              assetIds: [collectedId],
              ticketNumber,
              installationLocation,
              justification: 'Technician single collection'
            });
            collectMsg += gp?.data?.passNumber ? ` Gate Pass: ${gp.data.passNumber}.` : ' Gate pass saved.';
            if (gp?.data?.pendingApproval) {
              collectMsg += ' Pending admin approval — you will receive email after approval.';
            }
          } catch (error) {
            collectMsg += ` Gate pass failed: ${error?.response?.data?.message || 'unknown error'}.`;
          }
        }
        setMessage(collectMsg);
      } else {
        await api.post('/assets/faulty', { assetId: asset._id, ticketNumber });
        setMessage('Asset reported faulty');
      }
      // Refresh asset
      const res = await api.get('/assets/search', { params: { query: asset.serial_number } });
      setAsset(pickBestScannerMatch(res.data, asset.serial_number));
    } catch (error) {
      setMessage(error.response?.data?.message || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  const handleReturn = async () => {
    if (loading) return;
    if (!ticketNumber) {
      setMessage('Please enter a Ticket Number');
      return;
    }
    if (!asset) return;
    try {
      setLoading(true);
      await api.post('/assets/return', { assetId: asset._id, condition: returnCondition, ticketNumber });
      setMessage(`Asset returned as ${returnCondition}`);
      const res = await api.get('/assets/search', { params: { query: asset.serial_number } });
      setAsset(pickBestScannerMatch(res.data, asset.serial_number));
    } catch (error) {
      setMessage(error.response?.data?.message || 'Return failed');
    } finally {
      setLoading(false);
    }
  };

  const canCollectAsset = (a) => {
    if (!a) return false;
    if (a.reserved) return false;
    if (a.assigned_to) return false;
    if (a.status === 'Missing') return false;
    return !String(a.condition || '').toLowerCase().includes('faulty');
  };

  const addCurrentToBulk = () => {
    if (!asset?._id) return;
    if (!canCollectAsset(asset)) {
      setMessage('This asset cannot be added for bulk collect');
      return;
    }
    setBulkAssets((prev) => (prev.some((a) => a._id === asset._id) ? prev : [...prev, asset]));
    setMessage('Asset added to bulk list');
    setAsset(null);
    setManualSearch('');
  };

  const removeFromBulk = (id) => {
    setBulkAssets((prev) => prev.filter((a) => a._id !== id));
  };

  const handleBulkCollect = async () => {
    if (loading) return;
    if (bulkAssets.length === 0) {
      setMessage('Add assets to bulk list first');
      return;
    }
    if (!ticketNumber) {
      setMessage('Please enter a Ticket Number');
      return;
    }
    if (!installationLocation) {
      setMessage('Please enter Installation Location');
      return;
    }

    try {
      setLoading(true);
      const successes = [];
      const failed = [];

      for (const item of bulkAssets) {
        try {
          await api.post('/assets/collect', {
            assetId: item._id,
            ticketNumber,
            installationLocation
          });
          successes.push(item);
        } catch (error) {
          failed.push({
            item,
            reason: error?.response?.data?.message || 'Collect failed'
          });
        }
      }

      let gatePassInfo = '';
      if (successes.length > 0) {
        const askGatePass = window.confirm(
          `Collected ${successes.length} asset(s). Generate gate pass? It will await admin approval; email sends only after approval.`
        );
        if (askGatePass) {
          try {
            const gp = await api.post('/assets/collect-gatepass', {
              assetIds: successes.map((a) => a._id),
              ticketNumber,
              installationLocation,
              justification: `Technician bulk collection (${successes.length} assets)`
            });
            gatePassInfo = gp?.data?.passNumber ? ` Gate Pass: ${gp.data.passNumber}.` : ' Gate pass saved.';
            if (gp?.data?.pendingApproval) {
              gatePassInfo += ' Pending admin approval — technician gets email after approval.';
            }
          } catch (error) {
            gatePassInfo = ` Gate pass failed: ${error?.response?.data?.message || 'unknown error'}.`;
          }
        }
      }

      setBulkAssets((prev) => prev.filter((a) => !successes.some((s) => s._id === a._id)));
      setMessage(`Bulk collect done. Success: ${successes.length}, Failed: ${failed.length}.${gatePassInfo}`);
    } finally {
      setLoading(false);
    }
  };

  const techLabel = (a) => {
    if (a?.reserved) return 'Reserved';
    const statusText = String(a?.status || '').toLowerCase();
    const conditionText = String(a?.condition || '').toLowerCase();
    if (statusText.includes('reserved')) return 'Reserved';
    if (conditionText.includes('repair') || statusText.includes('repair')) return 'Repaired';
    if (statusText.includes('faulty') || conditionText.includes('faulty')) return 'Faulty';
    const lastByMe = [...(a.history || [])].reverse().find(h => h.user === user?.name);
    const lastCollected = [...(a.history || [])].reverse().find(h => /^Collected\//.test(h.action) && h.user === user?.name);
    if (a.status === 'Used' && lastCollected) {
      const collectedType = lastCollected.action.split('/')[1];
      return collectedType === 'New' ? 'Received/New' : 'Received/Used';
    }
    if (a.assigned_to && user && a.assigned_to._id === user._id && a.status === 'Used') {
      return 'Received/Used';
    }
    if (lastByMe && /^Returned/i.test(lastByMe.action)) {
      return `Return/${a.status}`;
    }
    if (lastByMe && lastByMe.action === 'Reported Faulty') {
      return 'Return/Faulty';
    }
    if (a.status === 'New') return 'In Store (New)';
    if (a.status === 'Used') return 'In Store (Used)';
    return a.status;
  };

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-bold mb-4">Technician Search</h1>
      

      {!asset && (
        <div className="space-y-6">
          <div>
            <p className="text-center text-gray-500 mb-2">
              Search by serial (last 4 or full), RFID, or QR Code
            </p>
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualSearch}
                  onChange={(e) => setManualSearch(e.target.value)}
                  placeholder="Last 4 digits or Serial"
                  className="flex-1 border p-2 rounded"
                />
                <button
                  onClick={() => searchAsset(manualSearch)}
                  disabled={loading}
                  className={`text-black px-4 py-2 rounded ${loading ? 'bg-amber-300 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700'}`}
                >
                  {loading ? 'Searching...' : 'Search'}
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualRfidSearch}
                  onChange={(e) => setManualRfidSearch(e.target.value)}
                  placeholder="RFID"
                  className="flex-1 border p-2 rounded"
                />
                <button
                  onClick={() => searchAsset(manualRfidSearch, 'rfid')}
                  disabled={loading}
                  className={`text-black px-4 py-2 rounded ${loading ? 'bg-amber-300 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700'}`}
                >
                  {loading ? 'Searching...' : 'Search'}
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualQrSearch}
                  onChange={(e) => setManualQrSearch(e.target.value)}
                  placeholder="QR Code"
                  className="flex-1 border p-2 rounded"
                />
                <button
                  onClick={() => searchAsset(manualQrSearch, 'qr')}
                  disabled={loading}
                  className={`text-black px-4 py-2 rounded ${loading ? 'bg-amber-300 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700'}`}
                >
                  {loading ? 'Searching...' : 'Search'}
                </button>
              </div>
            </div>
          </div>

          {bulkAssets.length > 0 && (
            <div className="bg-white border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold">Bulk List ({bulkAssets.length})</p>
                <button
                  type="button"
                  onClick={() => setBulkAssets([])}
                  className="text-xs text-red-600 hover:underline"
                >
                  Clear
                </button>
              </div>
              <div className="space-y-1 max-h-40 overflow-auto">
                {bulkAssets.map((a) => (
                  <div key={a._id} className="flex items-center justify-between text-sm border rounded px-2 py-1">
                    <span>{a.serial_number} - {a.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFromBulk(a._id)}
                      className="text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={handleBulkCollect}
                  disabled={loading || bulkAssets.length === 0}
                  className={`py-2 rounded text-white font-medium ${loading || bulkAssets.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-700 hover:bg-green-800'}`}
                >
                  {loading ? 'Processing...' : `Collect ${bulkAssets.length} Asset(s)`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading && <p>Loading...</p>}
      {message && <p className="mt-4 p-2 bg-gray-100 rounded text-center">{message}</p>}

      {showAddForm && !asset && (
        <div className="mt-6 bg-white p-6 rounded-lg shadow border-2 border-amber-500">
          <h2 className="text-lg font-bold mb-4">Add New Asset</h2>
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium">Asset Name *</label>
              <input
                type="text"
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                className="w-full border p-2 rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Model Number *</label>
              <input
                type="text"
                value={addForm.model_number}
                onChange={(e) => setAddForm({ ...addForm, model_number: e.target.value })}
                className="w-full border p-2 rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Serial Number *</label>
              <input
                type="text"
                value={addForm.serial_number}
                onChange={(e) => setAddForm({ ...addForm, serial_number: e.target.value })}
                className="w-full border p-2 rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium">MAC Address</label>
              <input
                type="text"
                value={addForm.mac_address}
                onChange={(e) => setAddForm({ ...addForm, mac_address: e.target.value })}
                className="w-full border p-2 rounded"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Store *</label>
              <select
                value={addForm.store}
                onChange={(e) => setAddForm({ ...addForm, store: e.target.value })}
                className="w-full border p-2 rounded"
                required
              >
                <option value="">Select Store</option>
                {stores.map((s) => (
                  <option key={s._id} value={s._id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Status *</label>
              <select
                value={addForm.status}
                onChange={(e) => setAddForm({ ...addForm, status: e.target.value })}
                className="w-full border p-2 rounded"
              >
                <option value="In Store">In Store</option>
                <option value="In Use">In Use</option>
                <option value="Missing">Missing</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Condition *</label>
              <select
                value={addForm.condition}
                onChange={(e) => setAddForm({ ...addForm, condition: e.target.value })}
                className="w-full border p-2 rounded"
              >
                <option value="New">New</option>
                <option value="Used">Used</option>
                <option value="Faulty">Faulty</option>
                <option value="Repaired">Repaired</option>
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={loading}
                className={`flex-1 text-white py-2 rounded ${loading ? 'bg-green-300 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
              >
                {loading ? 'Saving...' : 'Add & Select'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 border rounded hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {asset && (
        <div className="mt-6 bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-lg font-bold">{asset.name}</h2>
              <p className="text-sm text-gray-500">{asset.model_number}</p>
            </div>
            <button onClick={() => setAsset(null)} className="text-sm text-amber-600">Scan New</button>
          </div>
          
          <div className="space-y-2 mb-6">
             <p><span className="font-semibold">Serial:</span> {asset.serial_number}</p>
             <p><span className="font-semibold">Status:</span> {techLabel(asset)}</p>
             <p><span className="font-semibold">Store:</span> {asset.store?.name}</p>
          </div>

          <div className="space-y-4">
            <button
              type="button"
              onClick={addCurrentToBulk}
              disabled={!canCollectAsset(asset) || loading}
              className={`w-full py-2 rounded font-medium ${!canCollectAsset(asset) || loading ? 'bg-gray-300 text-gray-600 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
            >
              Add To Bulk List
            </button>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ticket Number</label>
              <input 
                type="text" 
                value={ticketNumber} 
                onChange={(e) => setTicketNumber(e.target.value)} 
                className="w-full border p-2 rounded"
                placeholder="Enter Ticket #"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Installation Location</label>
              <input 
                type="text" 
                value={installationLocation} 
                onChange={(e) => setInstallationLocation(e.target.value)} 
                className="w-full border p-2 rounded"
                placeholder="e.g. Server Room, Office 101"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => handleAction('collect')}
                disabled={loading || asset.reserved || asset.assigned_to || asset.status === 'Missing' || String(asset.condition || '').toLowerCase().includes('faulty')}
                className={`py-3 rounded text-white font-medium ${
                  (!loading && !asset.reserved && !asset.assigned_to && asset.status !== 'Missing' && !String(asset.condition || '').toLowerCase().includes('faulty'))
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-gray-400 cursor-not-allowed'
                }`}
              >
                Collect Material
              </button>
              <button 
                 onClick={() => handleAction('faulty')}
                 disabled={loading}
                 className={`py-3 rounded text-white font-medium ${loading ? 'bg-red-300 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}
              >
                Report Faulty
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <select
                value={returnCondition}
                onChange={(e) => setReturnCondition(e.target.value)}
                className="border p-2 rounded"
              >
                <option value="New">Return as New</option>
                <option value="Used">Return as Used</option>
                <option value="Faulty">Return as Faulty</option>
                <option value="Repaired">Return as Repaired</option>
              </select>
              <button
                onClick={handleReturn}
                disabled={loading || !asset.assigned_to || asset.assigned_to._id !== user?._id}
                className={`py-3 rounded font-medium ${
                  (!loading && asset.assigned_to && asset.assigned_to._id === user?._id) ? 'bg-amber-600 hover:bg-amber-700 text-black' : 'bg-gray-400 text-white cursor-not-allowed'
                }`}
              >
                Return Asset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TechScanner;
