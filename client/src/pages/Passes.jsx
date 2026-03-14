import { useState, useEffect, useRef } from 'react';
import api from '../api/axios';
import { useReactToPrint } from 'react-to-print';
import { QrCode, Printer, Plus, X, Eye, Edit, Trash2, Lock } from 'lucide-react';
import PropTypes from 'prop-types';

const PasswordModal = ({ isOpen, onClose, onConfirm }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/auth/verify-password', { password });
      onConfirm();
      setPassword('');
      setError('');
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Incorrect password');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Lock size={20} className="text-amber-600" />
          Admin Authentication
        </h3>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="Enter Admin Password"
            className="w-full border p-2 rounded mb-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-gray-600 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700"
            >
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

PasswordModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
};

const PassTemplate = ({ pass, refInstance, gatePassLogoUrl }) => {
  if (!pass) return null;
  
  // Format date as 11-NOV-2025
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase().replace(/ /g, '-');
  };

  return (
    <div style={{ position: 'absolute', top: '-10000px', left: '-10000px' }}>
      <div ref={refInstance} className="p-8 bg-white text-black font-sans min-h-screen">
        <div className="max-w-[297mm] mx-auto">
          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div className="text-sm font-semibold text-gray-700 mt-2">
              Security Technology, Expo City Dubai
            </div>
            <div className="flex items-center gap-2">
               <div className="text-right border-l-2 border-amber-400 pl-3">
                  <div className="flex items-center gap-2">
                     <img src={gatePassLogoUrl || '/gatepass-logo.svg'} alt="Expo City Dubai" className="w-16 h-16 object-contain" />
                     <div className="text-left">
                        <div className="text-xl font-bold text-gray-900 leading-none">EXPO</div>
                        <div className="text-xl font-bold text-gray-900 leading-none">CITY</div>
                        <div className="text-xl font-bold text-gray-900 leading-none">DUBAI</div>
                     </div>
                  </div>
               </div>
            </div>
          </div>

          {/* Title Bar */}
          <div className="bg-[#005f73] text-white px-4 py-2 flex justify-between items-center font-bold text-sm mb-0">
            <span>SECURITY HANDOVER</span>
            <span>DATE {formatDate(pass.createdAt)}</span>
          </div>

          {/* Info Block */}
          <div className="border border-slate-400 border-t-0 text-xs mb-8">
            <div className="grid grid-cols-2 border-b border-slate-400">
              <div className="p-2 border-r border-slate-400 bg-slate-100 flex">
                <span className="font-bold w-32">FILE NO.:</span> 
                <span>{pass.file_no || `ECD/ECT/EXITPASS/${pass.pass_number}`}</span>
              </div>
              <div className="p-2 bg-slate-100 flex">
                <span className="font-bold w-32">TICKET NO./PO.:</span> 
                <span>{pass.ticket_no || ''}</span>
              </div>
            </div>
            <div className="p-2 border-b border-slate-400 flex bg-white">
               <span className="font-bold w-32">REQUESTED BY:</span>
               <span>{pass.requested_by || pass.issued_to?.name || '-'}</span>
            </div>
            <div className="p-2 border-b border-slate-400 flex bg-slate-50">
               <span className="font-bold w-32">PROVIDED BY:</span>
               <span>{pass.provided_by || ''}</span>
            </div>
            <div className="p-2 border-b border-slate-400 flex bg-white">
               <span className="font-bold w-32">COLLECTED BY:</span>
               <span>{pass.collected_by || pass.issued_to?.name || '-'}</span>
            </div>
            <div className="p-2 flex bg-slate-50">
               <span className="font-bold w-32">APPROVED BY:</span>
               <span>{pass.approved_by || ''}</span>
            </div>
          </div>

          {/* Movement */}
          <div className="grid grid-cols-2 gap-20 mb-6 text-xs">
            <div>
               <div className="font-bold text-slate-500 mb-1">MOVING FROM</div>
               <div className="font-bold text-lg border-b border-gray-300 pb-1">{pass.origin}</div>
            </div>
            <div>
               <div className="font-bold text-slate-500 mb-1">MOVING TO</div>
               <div className="font-bold text-lg border-b border-gray-300 pb-1">{pass.destination}</div>
            </div>
          </div>

          {/* Assets Table */}
          <table className="w-full border-collapse border border-black text-center mb-6 text-[10px]">
            <thead className="bg-[#005f73] text-white">
              <tr>
                <th className="border border-black p-2 font-bold w-10">S.No</th>
                <th className="border border-black p-2 font-bold">Model Number</th>
                <th className="border border-black p-2 font-bold">Serial Number</th>
                <th className="border border-black p-2 font-bold">Manufacturer</th>
                <th className="border border-black p-2 font-bold">Status</th>
                <th className="border border-black p-2 font-bold">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {(pass.assets || []).map((item, i) => (
                <tr key={i} className="text-black">
                  <td className="border border-black p-2">{i + 1}</td>
                  <td className="border border-black p-2">{item.model || '-'}</td>
                  <td className="border border-black p-2 font-mono">{item.serial_number}</td>
                  <td className="border border-black p-2">{item.brand || '-'}</td>
                  <td className="border border-black p-2">{item.status || '-'}</td>
                  <td className="border border-black p-2">{item.remarks || '-'}</td>
                </tr>
              ))}
              {/* Empty rows to fill space if needed, mimicking a fixed form */}
              {Array.from({ length: Math.max(0, 5 - pass.assets.length) }).map((_, idx) => (
                 <tr key={`empty-${idx}`}>
                   <td className="border border-black p-2">&nbsp;</td>
                   <td className="border border-black p-2"></td>
                   <td className="border border-black p-2"></td>
                   <td className="border border-black p-2"></td>
                   <td className="border border-black p-2"></td>
                   <td className="border border-black p-2"></td>
                 </tr>
              ))}
            </tbody>
          </table>

          {/* Footer */}
          <div className="text-xs border-t border-gray-200 pt-4">
            <span className="font-bold">JUSTIFICATION:</span> {pass.justification || pass.notes}
          </div>
          
          <div className="mt-8 text-[10px] text-gray-400 text-right">
             Generated by Store Management System
          </div>
        </div>
      </div>
    </div>
  );
};

PassTemplate.propTypes = {
  pass: PropTypes.object,
  refInstance: PropTypes.object,
  gatePassLogoUrl: PropTypes.string
};

const ViewModal = ({ pass, onClose, onPrint, gatePassLogoUrl }) => {
  if (!pass) return null;

  // Format date as 11-NOV-2025
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase().replace(/ /g, '-');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto relative">
        <div className="sticky top-0 bg-white z-10 border-b p-4 flex justify-between items-center">
           <h2 className="text-lg font-bold">Pass Preview</h2>
           <div className="flex gap-2">
              <button 
                onClick={onPrint}
                className="bg-amber-600 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-amber-700 text-sm"
              >
                <Printer size={16} /> Print / Save PDF
              </button>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X size={24} />
              </button>
           </div>
        </div>
        
        {/* Preview Content (Visual Duplicate of Print Template) */}
        <div className="p-8 bg-gray-50 flex justify-center">
          <div className="bg-white p-8 shadow-sm border w-full max-w-[210mm]">
             {/* Header */}
             <div className="flex justify-between items-start mb-6">
                <div className="text-sm font-semibold text-gray-700 mt-2">
                  Security Technology, Expo City Dubai
                </div>
                <div className="flex items-center gap-2">
                   <div className="text-right border-l-2 border-amber-400 pl-3">
                      <div className="flex items-center gap-2">
                         <img src={gatePassLogoUrl || '/gatepass-logo.svg'} alt="Expo City Dubai" className="w-16 h-16 object-contain" />
                         <div className="text-left">
                            <div className="text-lg font-bold text-gray-900 leading-none">EXPO</div>
                            <div className="text-lg font-bold text-gray-900 leading-none">CITY</div>
                            <div className="text-lg font-bold text-gray-900 leading-none">DUBAI</div>
                         </div>
                      </div>
                   </div>
                </div>
              </div>

              {/* Title Bar */}
              <div className="bg-[#005f73] text-white px-4 py-2 flex justify-between items-center font-bold text-sm mb-0">
                <span>SECURITY HANDOVER</span>
                <span>DATE {formatDate(pass.createdAt)}</span>
              </div>

              {/* Info Block */}
              <div className="border border-slate-400 border-t-0 text-xs mb-8">
                <div className="grid grid-cols-2 border-b border-slate-400">
                  <div className="p-2 border-r border-slate-400 bg-slate-100 flex">
                    <span className="font-bold w-32">FILE NO.:</span> 
                    <span>{pass.file_no || `ECD/ECT/EXITPASS/${pass.pass_number}`}</span>
                  </div>
                  <div className="p-2 bg-slate-100 flex">
                    <span className="font-bold w-32">TICKET NO./PO.:</span> 
                    <span>{pass.ticket_no || ''}</span>
                  </div>
                </div>
                <div className="p-2 border-b border-slate-400 flex bg-white">
                   <span className="font-bold w-32">REQUESTED BY:</span>
                   <span>{pass.requested_by || pass.issued_to?.name || '-'}</span>
                </div>
                <div className="p-2 border-b border-slate-400 flex bg-slate-50">
                   <span className="font-bold w-32">PROVIDED BY:</span>
                   <span>{pass.provided_by || ''}</span>
                </div>
                <div className="p-2 border-b border-slate-400 flex bg-white">
                   <span className="font-bold w-32">COLLECTED BY:</span>
                   <span>{pass.collected_by || pass.issued_to?.name || '-'}</span>
                </div>
                <div className="p-2 flex bg-slate-50">
                   <span className="font-bold w-32">APPROVED BY:</span>
                   <span>{pass.approved_by || ''}</span>
                </div>
              </div>

              {/* Movement */}
              <div className="grid grid-cols-2 gap-20 mb-6 text-xs">
                <div>
                   <div className="font-bold text-slate-500 mb-1">MOVING FROM</div>
                   <div className="font-bold text-lg border-b border-gray-300 pb-1">{pass.origin}</div>
                </div>
                <div>
                   <div className="font-bold text-slate-500 mb-1">MOVING TO</div>
                   <div className="font-bold text-lg border-b border-gray-300 pb-1">{pass.destination}</div>
                </div>
              </div>

              {/* Assets Table */}
              <table className="w-full border-collapse border border-black text-center mb-6 text-[10px]">
                <thead className="bg-[#005f73] text-white">
                  <tr>
                    <th className="border border-black p-2 font-bold w-10">S.No</th>
                    <th className="border border-black p-2 font-bold">Model Number</th>
                    <th className="border border-black p-2 font-bold">Serial Number</th>
                    <th className="border border-black p-2 font-bold">Manufacturer</th>
                    <th className="border border-black p-2 font-bold">Status</th>
                    <th className="border border-black p-2 font-bold">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {(pass.assets || []).map((item, i) => (
                    <tr key={i} className="text-black">
                      <td className="border border-black p-2">{i + 1}</td>
                      <td className="border border-black p-2">{item.model || '-'}</td>
                      <td className="border border-black p-2 font-mono">{item.serial_number}</td>
                      <td className="border border-black p-2">{item.brand || '-'}</td>
                      <td className="border border-black p-2">{item.status || '-'}</td>
                      <td className="border border-black p-2">{item.remarks || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Footer */}
              <div className="text-xs border-t border-gray-200 pt-4">
                <span className="font-bold">JUSTIFICATION:</span> {pass.justification || pass.notes}
              </div>
          </div>
        </div>
      </div>
    </div>
  );
};

ViewModal.propTypes = {
  pass: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onPrint: PropTypes.func,
  gatePassLogoUrl: PropTypes.string
};

const Passes = () => {
  const [passes, setPasses] = useState([]);
  const [, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedPass, setSelectedPass] = useState(null);
  const [viewPass, setViewPass] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  const [passwordPrompt, setPasswordPrompt] = useState({
    isOpen: false,
    action: null,
    passId: null,
    passData: null
  });
  const [gatePassLogoUrl, setGatePassLogoUrl] = useState('/gatepass-logo.svg');

  const printRef = useRef();
  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: 'Gate Pass',
    removeAfterPrint: true
  });

  const [formData, setFormData] = useState({
    type: 'Security Handover',
    file_no: '',
    ticket_no: '',
    requested_by: '',
    provided_by: '',
    collected_by: '',
    approved_by: '',
    assets: [{ 
       name: '', 
       model: '', 
       serial_number: '', 
       brand: '', 
       asset_model: '', 
       location: '', 
       movement: '', 
       status: 'Good', 
       remarks: '',
       quantity: 1 
    }],
    issued_to: { name: '', company: '', contact: '', id_number: '' },
    destination: '',
    origin: '',
    justification: '',
    notes: ''
  });

  const loadPasses = async () => {
    try {
      const { data } = await api.get('/passes');
      setPasses(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPasses();
  }, []);

  useEffect(() => {
    const loadGatePassLogo = async () => {
      try {
        const { data } = await api.get('/system/public-config');
        setGatePassLogoUrl(data?.gatePassLogoUrl || '/gatepass-logo.svg');
      } catch {
        setGatePassLogoUrl('/gatepass-logo.svg');
      }
    };
    loadGatePassLogo();
  }, []);

  const handlePasswordConfirm = () => {
    const { action, passId, passData } = passwordPrompt;
    if (action === 'delete') {
      deletePass(passId);
    } else if (action === 'edit') {
      openEditModal(passData);
    }
  };

  const deletePass = async (id) => {
    try {
      await api.delete(`/passes/${id}`);
      loadPasses();
    } catch {
      alert('Error deleting pass');
    }
  };

  const openEditModal = (pass) => {
    setFormData({
      type: pass.type || 'Security Handover',
      file_no: pass.file_no || '',
      ticket_no: pass.ticket_no || '',
      requested_by: pass.requested_by || '',
      provided_by: pass.provided_by || '',
      collected_by: pass.collected_by || '',
      approved_by: pass.approved_by || '',
      assets: (pass.assets || []).map(a => ({
         name: a.name || '',
         model: a.model || '',
         serial_number: a.serial_number || '',
         brand: a.brand || '',
         asset_model: a.asset_model || '',
         location: a.location || '',
         movement: a.movement || '',
         status: a.status || 'Good',
         remarks: a.remarks || '',
         quantity: a.quantity || 1
      })),
      issued_to: pass.issued_to || { name: '', company: '', contact: '', id_number: '' },
      destination: pass.destination || '',
      origin: pass.origin || '',
      justification: pass.justification || '',
      notes: pass.notes || ''
    });
    setIsEditing(true);
    setCurrentId(pass._id);
    setShowModal(true);
  };

  const initiateDelete = (pass) => {
    setPasswordPrompt({
      isOpen: true,
      action: 'delete',
      passId: pass._id
    });
  };

  const initiateEdit = (pass) => {
    setPasswordPrompt({
      isOpen: true,
      action: 'edit',
      passData: pass
    });
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setIsEditing(false);
    setCurrentId(null);
    setFormData({
      type: 'Security Handover',
      file_no: '',
      ticket_no: '',
      requested_by: '',
      provided_by: '',
      collected_by: '',
      approved_by: '',
      assets: [{ 
         name: '', 
         model: '', 
         serial_number: '', 
         brand: '', 
         asset_model: '', 
         location: '', 
         movement: '', 
         status: 'Good', 
         remarks: '',
         quantity: 1 
      }],
      issued_to: { name: '', company: '', contact: '', id_number: '' },
      destination: '',
      origin: '',
      justification: '',
      notes: ''
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Ensure issued_to.name is set if collected_by is used as fallback, or vice versa
      const submissionData = { ...formData };
      if (!submissionData.issued_to.name && submissionData.collected_by) {
        submissionData.issued_to.name = submissionData.collected_by;
      }
      if (!submissionData.collected_by && submissionData.issued_to.name) {
         submissionData.collected_by = submissionData.issued_to.name;
      }

      if (isEditing) {
        await api.put(`/passes/${currentId}`, submissionData);
      } else {
        await api.post('/passes', submissionData);
      }
      handleCloseModal();
      loadPasses();
    } catch (err) {
      console.error(err);
      alert('Error saving pass: ' + (err.response?.data?.message || err.message));
    }
  };

  const [suggestions, setSuggestions] = useState({});
  const [activeSearchIndex, setActiveSearchIndex] = useState(null);

  const handleSerialSearch = async (value, index) => {
    const newAssets = [...formData.assets];
    newAssets[index].serial_number = value;
    setFormData({ ...formData, assets: newAssets });

    if (value.length >= 4) {
      try {
        const { data } = await api.get('/assets/search-serial', { params: { q: value } });
        setSuggestions(prev => ({ ...prev, [index]: data }));
        setActiveSearchIndex(index);
      } catch (error) {
        console.error('Error searching assets:', error);
      }
    } else {
      setSuggestions(prev => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  };

  const selectAsset = (asset, index) => {
    const newAssets = [...formData.assets];
    newAssets[index] = {
      ...newAssets[index],
      name: asset.name,
      model: asset.model_number || '', // map model_number to model
      serial_number: asset.serial_number,
      brand: asset.manufacturer || '', // map manufacturer to brand
      asset_model: asset.model_number || '', // use model_number as asset_model too default
      location: asset.store?.name || '',
      status: asset.status || 'Good',
      quantity: 1
    };
    setFormData({ ...formData, assets: newAssets });
    
    setSuggestions(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    setActiveSearchIndex(null);
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      assets: [...prev.assets, { 
         name: '', 
         model: '', 
         serial_number: '', 
         brand: '', 
         asset_model: '', 
         location: '', 
         movement: '', 
         status: 'Good', 
         remarks: '',
         quantity: 1 
      }]
    }));
  };

  const removeItem = (index) => {
    setFormData(prev => ({
      ...prev,
      assets: prev.assets.filter((_, i) => i !== index)
    }));
  };

  const openPrint = (pass) => {
    setSelectedPass(pass);
    setTimeout(() => {
      handlePrint();
    }, 500);
  };
  
  const openView = (pass) => {
    setSelectedPass(pass);
    setViewPass(pass);
  };

  return (
    <div className="p-6">
      <PasswordModal 
        isOpen={passwordPrompt.isOpen}
        onClose={() => setPasswordPrompt({ ...passwordPrompt, isOpen: false })}
        onConfirm={handlePasswordConfirm}
      />

      <ViewModal 
        pass={viewPass} 
        onClose={() => setViewPass(null)} 
        onPrint={() => openPrint(viewPass)}
        gatePassLogoUrl={gatePassLogoUrl}
      />

      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Security Handover / Gate Passes (New Format)</h1>
          <p className="text-gray-500">Manage Asset Movement and Security Handovers</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="bg-amber-600 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-amber-700"
        >
          <Plus size={20} /> Create Pass
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded shadow overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pass #</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Requested By</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {passes.map(pass => (
              <tr key={pass._id} className="hover:bg-gray-50">
                <td className="px-6 py-4 font-mono font-medium">{pass.file_no || pass.pass_number}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    pass.type === 'Inbound' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {pass.type}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="font-medium">{pass.requested_by || pass.issued_to?.name || '-'}</div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {new Date(pass.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-800">
                    {pass.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => openView(pass)}
                      className="text-blue-600 hover:text-blue-800 p-1"
                      title="View Details"
                    >
                      <Eye size={18} />
                    </button>
                    <button 
                      onClick={() => openPrint(pass)}
                      className="text-gray-600 hover:text-black p-1"
                      title="Print Pass"
                    >
                      <Printer size={18} />
                    </button>
                    <button 
                      onClick={() => initiateEdit(pass)}
                      className="text-green-600 hover:text-green-800 p-1"
                      title="Edit Pass"
                    >
                      <Edit size={18} />
                    </button>
                    <button 
                      onClick={() => initiateDelete(pass)}
                      className="text-red-600 hover:text-red-800 p-1"
                      title="Delete Pass"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white z-10">
              <h2 className="text-xl font-bold">{isEditing ? 'Edit Security Handover' : 'Create Security Handover'}</h2>
              <button onClick={handleCloseModal}><X size={24} /></button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              
              {/* Header Info */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                   <label className="block text-sm font-medium mb-1">File No.</label>
                   <input 
                     className="w-full border rounded p-2"
                     placeholder="Auto-generated if empty"
                     value={formData.file_no}
                     onChange={e => setFormData({...formData, file_no: e.target.value})}
                   />
                </div>
                <div>
                   <label className="block text-sm font-medium mb-1">Ticket No./PO</label>
                   <input 
                     className="w-full border rounded p-2"
                     value={formData.ticket_no}
                     onChange={e => setFormData({...formData, ticket_no: e.target.value})}
                   />
                </div>
                <div>
                   <label className="block text-sm font-medium mb-1">Type</label>
                   <select 
                     className="w-full border rounded p-2"
                     value={formData.type}
                     onChange={e => setFormData({...formData, type: e.target.value})}
                   >
                      <option value="Security Handover">Security Handover</option>
                      <option value="Inbound">Inbound</option>
                      <option value="Outbound">Outbound</option>
                   </select>
                </div>
              </div>

              {/* People */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded">
                <div>
                   <label className="block text-sm font-medium mb-1">Requested By</label>
                   <input 
                     className="w-full border rounded p-2"
                     value={formData.requested_by}
                     onChange={e => setFormData({...formData, requested_by: e.target.value})}
                   />
                </div>
                <div>
                   <label className="block text-sm font-medium mb-1">Provided By</label>
                   <input 
                     className="w-full border rounded p-2"
                     value={formData.provided_by}
                     onChange={e => setFormData({...formData, provided_by: e.target.value})}
                   />
                </div>
                <div>
                   <label className="block text-sm font-medium mb-1">Collected By</label>
                   <input 
                     className="w-full border rounded p-2"
                     value={formData.collected_by}
                     onChange={e => setFormData({...formData, collected_by: e.target.value})}
                   />
                </div>
                <div>
                   <label className="block text-sm font-medium mb-1">Approved By</label>
                   <input 
                     className="w-full border rounded p-2"
                     value={formData.approved_by}
                     onChange={e => setFormData({...formData, approved_by: e.target.value})}
                   />
                </div>
              </div>

              {/* Movement */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Moving From</label>
                  <input 
                    type="text"
                    required
                    className="w-full border rounded p-2"
                    value={formData.origin}
                    onChange={e => setFormData({...formData, origin: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Moving To</label>
                  <input 
                    type="text"
                    required
                    className="w-full border rounded p-2"
                    value={formData.destination}
                    onChange={e => setFormData({...formData, destination: e.target.value})}
                  />
                </div>
              </div>

              {/* Assets */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-gray-700">Assets Details</h3>
                  <button 
                    type="button" 
                    onClick={addItem}
                    className="text-amber-600 hover:text-amber-700 text-sm font-bold flex items-center gap-1"
                  >
                    <Plus size={16} /> Add Row
                  </button>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] border-collapse text-sm">
                   <thead>
                      <tr className="bg-gray-100 text-left">
                         <th className="p-2 border">No.</th>
                         <th className="p-2 border w-48">Product/Name</th>
                         <th className="p-2 border">Model</th>
                         <th className="p-2 border w-40">Serial</th>
                         <th className="p-2 border">Brand</th>
                         <th className="p-2 border">Asset Model</th>
                         <th className="p-2 border">Location</th>
                         <th className="p-2 border">Movement</th>
                         <th className="p-2 border">Status</th>
                         <th className="p-2 border">Remark</th>
                         <th className="p-2 border w-10"></th>
                      </tr>
                   </thead>
                   <tbody>
                      {formData.assets.map((item, index) => (
                        <tr key={index}>
                           <td className="p-2 border text-center">{index + 1}</td>
                           <td className="p-2 border">
                              <input 
                                className="w-full p-1 border rounded" 
                                value={item.name}
                                onChange={e => {
                                  const newAssets = [...formData.assets];
                                  newAssets[index].name = e.target.value;
                                  setFormData({...formData, assets: newAssets});
                                }}
                                placeholder="Product"
                              />
                           </td>
                           <td className="p-2 border">
                              <input 
                                className="w-full p-1 border rounded" 
                                value={item.model}
                                onChange={e => {
                                  const newAssets = [...formData.assets];
                                  newAssets[index].model = e.target.value;
                                  setFormData({...formData, assets: newAssets});
                                }}
                              />
                           </td>
                           <td className="p-2 border relative">
                              <input 
                                className="w-full p-1 border rounded font-mono" 
                                value={item.serial_number}
                                onChange={e => handleSerialSearch(e.target.value, index)}
                                onFocus={() => setActiveSearchIndex(index)}
                                placeholder="Search..."
                              />
                              {activeSearchIndex === index && suggestions[index] && suggestions[index].length > 0 && (
                                <div className="absolute z-50 left-0 top-full w-64 bg-white border rounded shadow-lg max-h-48 overflow-y-auto mt-1">
                                  {suggestions[index].map(asset => (
                                    <div 
                                      key={asset._id}
                                      className="p-2 hover:bg-gray-100 cursor-pointer text-xs"
                                      onClick={() => selectAsset(asset, index)}
                                    >
                                      <div className="font-bold">{asset.serial_number}</div>
                                      <div className="text-gray-600">{asset.name}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                           </td>
                           <td className="p-2 border">
                              <input 
                                className="w-full p-1 border rounded" 
                                value={item.brand}
                                onChange={e => {
                                  const newAssets = [...formData.assets];
                                  newAssets[index].brand = e.target.value;
                                  setFormData({...formData, assets: newAssets});
                                }}
                              />
                           </td>
                           <td className="p-2 border">
                              <input 
                                className="w-full p-1 border rounded" 
                                value={item.asset_model}
                                onChange={e => {
                                  const newAssets = [...formData.assets];
                                  newAssets[index].asset_model = e.target.value;
                                  setFormData({...formData, assets: newAssets});
                                }}
                              />
                           </td>
                           <td className="p-2 border">
                              <input 
                                className="w-full p-1 border rounded" 
                                value={item.location}
                                onChange={e => {
                                  const newAssets = [...formData.assets];
                                  newAssets[index].location = e.target.value;
                                  setFormData({...formData, assets: newAssets});
                                }}
                              />
                           </td>
                           <td className="p-2 border">
                              <input 
                                className="w-full p-1 border rounded" 
                                value={item.movement}
                                placeholder="Inbound"
                                onChange={e => {
                                  const newAssets = [...formData.assets];
                                  newAssets[index].movement = e.target.value;
                                  setFormData({...formData, assets: newAssets});
                                }}
                              />
                           </td>
                           <td className="p-2 border">
                              <input 
                                className="w-full p-1 border rounded" 
                                value={item.status}
                                onChange={e => {
                                  const newAssets = [...formData.assets];
                                  newAssets[index].status = e.target.value;
                                  setFormData({...formData, assets: newAssets});
                                }}
                              />
                           </td>
                           <td className="p-2 border">
                              <input 
                                className="w-full p-1 border rounded" 
                                value={item.remarks}
                                onChange={e => {
                                  const newAssets = [...formData.assets];
                                  newAssets[index].remarks = e.target.value;
                                  setFormData({...formData, assets: newAssets});
                                }}
                              />
                           </td>
                           <td className="p-2 border text-center">
                              {formData.assets.length > 1 && (
                                <button 
                                  type="button"
                                  onClick={() => removeItem(index)}
                                  className="text-red-500 hover:text-red-700"
                                >
                                  <X size={16} />
                                </button>
                              )}
                           </td>
                        </tr>
                      ))}
                   </tbody>
                </table>
                </div>
              </div>

              {/* Footer */}
              <div>
                <label className="block text-sm font-medium mb-1">Justification / Notes</label>
                <textarea 
                  className="w-full border rounded p-2"
                  rows="2"
                  value={formData.justification}
                  onChange={e => setFormData({...formData, justification: e.target.value})}
                  placeholder="Reason for movement..."
                ></textarea>
              </div>

              <div className="pt-4 border-t flex justify-end gap-4">
                <button 
                  type="button" 
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-6 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
                >
                  {isEditing ? 'Save Changes' : 'Create Pass'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Template (Hidden) */}
      <PassTemplate pass={selectedPass} refInstance={printRef} gatePassLogoUrl={gatePassLogoUrl} />
    </div>
  );
};

export default Passes;
