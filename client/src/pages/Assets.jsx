import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Edit, Trash2, UserCheck, UserX } from 'lucide-react';
import api from '../api/axios';
import * as XLSX from 'xlsx';

const Assets = () => {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const categoryParam = searchParams.get('category');
  const statusParam = searchParams.get('status');
  const actionParam = searchParams.get('action');

  const [assets, setAssets] = useState([]);
  const [stores, setStores] = useState([]);
  const [technicians, setTechnicians] = useState([]); // New: Technicians list
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [allowDup, setAllowDup] = useState(false);
  const [importInfo, setImportInfo] = useState(null);
  const [forceLoading, setForceLoading] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [bulkLocationId, setBulkLocationId] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkForm, setBulkForm] = useState({ status: '', condition: '', manufacturer: '', locationId: '' });
  const [bulkLoading, setBulkLoading] = useState(false);
  
  // Assign State
  const [assigningAsset, setAssigningAsset] = useState(null);
  const [assignForm, setAssignForm] = useState({
    technicianId: '',
    ticketNumber: ''
  });
  const [techSearch, setTechSearch] = useState('');
  const [showTechSuggestions, setShowTechSuggestions] = useState(false);
  const [recipientType, setRecipientType] = useState('Technician');
  const [otherRecipient, setOtherRecipient] = useState({
    name: '',
    phone: '',
    note: ''
  });

  // Edit State
  const [editingAsset, setEditingAsset] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    model_number: '',
    serial_number: '',
    mac_address: '',
    manufacturer: '',
    ticket_number: '',
    category: 'Other',
    store: '',
    location: '',
    status: '',
    condition: 'New / Excellent',
    rfid: '',
    qr_code: ''
  });
  const [addForm, setAddForm] = useState({
    name: '',
    model_number: '',
    serial_number: '',
    mac_address: '',
    manufacturer: '',
    ticket_number: '',
    category: 'Other',
    store: '',
    location: '',
    status: 'New',
    condition: 'New / Excellent',
    rfid: '',
    qr_code: ''
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  
  // Advanced Filters
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterManufacturer, setFilterManufacturer] = useState('');
  const [filterModelNumber, setFilterModelNumber] = useState('');
  const [filterSerialNumber, setFilterSerialNumber] = useState('');
  const [filterMacAddress, setFilterMacAddress] = useState('');
  const [filterProductType, setFilterProductType] = useState('');
  const [filterProductName, setFilterProductName] = useState('');
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
  const [categories, setCategories] = useState([]);
  const [fullCategories, setFullCategories] = useState([]);

  // Sync category & status params from URL
  useEffect(() => {
    setFilterCategory(categoryParam || '');
    if (statusParam) setFilterStatus(statusParam);
    if (actionParam === 'add') setShowAddModal(true);
  }, [categoryParam, statusParam, actionParam]);


  // Hierarchical State for Add/Import
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');

  useEffect(() => {
    fetchStores();
    fetchTechnicians();
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const res = await api.get('/asset-categories');
      setFullCategories(res.data);
      setCategories(res.data.map(c => c.name));
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const getTypes = (catName) => {
    const cat = fullCategories.find(c => c.name === catName);
    return cat ? cat.types : [];
  };

  const getProducts = (catName, typeName) => {
    const types = getTypes(catName);
    const type = types.find(t => t.name === typeName);
    if (!type || !type.products) return [];

    const flatten = (list, level = 0) => {
      let results = [];
      list.forEach(p => {
        results.push({ ...p, level });
        if (p.children && p.children.length > 0) {
          results = [...results, ...flatten(p.children, level + 1)];
        }
      });
      return results;
    };

    return flatten(type.products);
  };

  const fetchAssets = async (params, options) => {
    const silent = options?.silent === true;
    try {
      if (!silent) setLoading(true);
      const response = await api.get('/assets', {
        params: {
          page,
          limit,
          q: searchTerm || undefined,
          status: filterStatus || undefined,
          store: filterLocation || undefined, // Send store ID correctly
          condition: filterCondition || undefined, // Add condition filter
          category: filterCategory || undefined,
          manufacturer: filterManufacturer || undefined,
          model_number: filterModelNumber || undefined,
          serial_number: filterSerialNumber || undefined,
          mac_address: filterMacAddress || undefined,
          product_type: filterProductType || undefined,
          product_name: filterProductName || undefined,
          ticket_number: filterTicket || undefined,
          rfid: filterRfid || undefined,
          qr_code: filterQr || undefined,
          date_from: filterDateFrom || undefined,
          date_to: filterDateTo || undefined,
          ...(params || {})
        }
      });
      setAssets(response.data.items || []);
      setTotal(response.data.total || 0);
    } catch (error) {
      console.error(error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchStores = async () => {
    try {
      const response = await api.get('/stores');
      setStores(response.data);
    } catch (error) {
      console.error('Error fetching stores:', error);
    }
  };
  
  const fetchTechnicians = async () => {
    try {
      const response = await api.get('/users');
      setTechnicians(response.data || []);
    } catch (error) {
      setTechnicians([]);
      console.error('Error fetching technicians:', error);
    }
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('allowDuplicates', String(allowDup));
    // Append hierarchical data if selected
    if (selectedCategory) formData.append('category', selectedCategory);
    if (selectedType) formData.append('product_type', selectedType);
    if (selectedProduct) formData.append('product_name', selectedProduct);
    if (bulkLocationId) {
      const loc = stores.find(s => s._id === bulkLocationId);
      if (loc) formData.append('location', loc.name);
    }

    try {
      const res = await api.post('/assets/import', formData);
      setImportInfo(res.data);
      alert(res.data?.message || 'Upload completed');
      setShowImportModal(false); // Close modal on success
      setFile(null); // Reset file
      fetchAssets(undefined, { silent: true });
    } catch (error) {
      const data = error.response?.data;
      if (data) {
        setImportInfo(data);
        alert(data.message || data.error || 'Upload failed');
      } else {
        alert('Upload failed');
      }
      console.error('Bulk import error:', error);
    }
  };

  const handleForceAdd = async () => {
    if (!importInfo?.skipped_duplicates?.length) return;
    
    // Extract asset objects from the skipped duplicates list
    const assetsToAdd = importInfo.skipped_duplicates
      .filter(d => d.asset)
      .map(d => d.asset);
      
    if (assetsToAdd.length === 0) {
      alert('No valid duplicate assets found to add.');
      return;
    }

    if (!window.confirm(`Are you sure you want to add ${assetsToAdd.length} duplicate assets?`)) return;

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
      const response = await api.get('/assets/template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'assets_import_template.xlsx');
      document.body.appendChild(link);
      link.click();
    } catch (error) {
      console.error('Error downloading template:', error);
      alert('Failed to download template');
    }
  };

  const handleEditClick = async (asset) => {
    let assetToEdit = asset;

    // Check if assigned
    const isAssigned = asset.assigned_to || (asset.assigned_to_external && asset.assigned_to_external.name);

    if (isAssigned) {
      if (window.confirm("This asset is currently assigned. Do you want to unassign it before editing?")) {
        try {
          const res = await api.post('/assets/unassign', { assetId: asset._id });
          assetToEdit = res.data;
          fetchAssets(); // Refresh background list
          alert('Asset unassigned successfully. Opening edit form...');
        } catch (error) {
          console.error('Error unassigning asset:', error);
          alert('Failed to unassign asset. Opening edit form with current state.');
        }
      }
    }

    setEditingAsset(assetToEdit);
    let initialStatus = assetToEdit.status;
    if ((assetToEdit.assigned_to || (assetToEdit.assigned_to_external && assetToEdit.assigned_to_external.name)) && (assetToEdit.status === 'New' || assetToEdit.status === 'Used')) {
      initialStatus = 'In Use';
    }

    setFormData({
      name: assetToEdit.name,
      model_number: assetToEdit.model_number,
      serial_number: assetToEdit.serial_number,
      mac_address: assetToEdit.mac_address || '',
      manufacturer: assetToEdit.manufacturer || '',
      ticket_number: assetToEdit.ticket_number || '',
      rfid: assetToEdit.rfid || '',
      qr_code: assetToEdit.qr_code || '',
      category: assetToEdit.category || 'Other',
      store: assetToEdit.store?._id || assetToEdit.store || '',
      location: assetToEdit.location || '',
      status: initialStatus,
      condition: assetToEdit.condition || 'New / Excellent'
    });

    // Populate Hierarchy
    setSelectedCategory(assetToEdit.category || '');
    setSelectedType(assetToEdit.product_type || '');
    setSelectedProduct(assetToEdit.product_name || '');
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSave = async () => {
    try {
      const updateData = { 
        ...formData,
        category: selectedCategory || formData.category,
        product_type: selectedType,
        product_name: selectedProduct
      };
      
      // Handle "In Use" virtual status
      if (updateData.status === 'In Use') {
        // If it was already assigned, keep the underlying status (or default to Used)
        // We don't change assignment here.
        // If it wasn't assigned, we can't really make it "In Use" without a user.
        // But for now, let's map it to 'Used' if the original was 'New' or 'Used'.
        updateData.status = 'Used'; 
        
        // Check if actually assigned
        if (!editingAsset.assigned_to && (!editingAsset.assigned_to_external || !editingAsset.assigned_to_external.name)) {
             alert("You cannot set status to 'In Use' without assigning the asset first. Please use the Assign button.");
             return;
        }
      } else if (updateData.status === 'New' || updateData.status === 'Used') {
        // If setting to Spare (New/Used), we must unassign
        updateData.assigned_to = null;
        updateData.assigned_to_external = null;
      }

      // Remove empty store to prevent CastError
      if (!updateData.store) {
        delete updateData.store;
      }

      const res = await api.put(`/assets/${editingAsset._id}`, updateData);
      const updated = res.data;
      setEditingAsset(null);
      setAssets(prev => prev.map(a => a._id === updated._id ? { ...a, ...updated } : a));
      fetchAssets(undefined, { silent: true });
      alert('Asset updated successfully');
    } catch (error) {
      console.error('Error updating asset:', error);
      alert('Failed to update asset');
    }
  };

  const handleCancel = () => {
    setEditingAsset(null);
  };
  
  const handleAddChange = (e) => {
    setAddForm({ ...addForm, [e.target.name]: e.target.value });
  };
  
  // --- PRODUCT AUTOCOMPLETE LOGIC ---
  const [productSuggestions, setProductSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleProductSearch = (val) => {
    const value = val;
    // Update local state
    setAddForm(prev => ({ ...prev, name: value, model_number: value })); // Default model to name
    setSelectedProduct(value);
    
    if (!value) {
      setProductSuggestions([]);
      return;
    }

    // Search across all categories
    const matches = [];
    fullCategories.forEach(cat => {
      cat.types.forEach(type => {
        // Recursive search helper
        const searchProds = (list) => {
          list.forEach(p => {
            if (p.name.toLowerCase().includes(value.toLowerCase())) {
              matches.push({
                product: p.name,
                type: type.name,
                category: cat.name
              });
            }
            if (p.children) searchProds(p.children);
          });
        };
        searchProds(type.products);
      });
    });
    
    setProductSuggestions(matches.slice(0, 10)); // Limit to 10
    setShowSuggestions(true);
  };

  const selectSuggestion = (suggestion) => {
    setSelectedCategory(suggestion.category);
    setSelectedType(suggestion.type);
    setSelectedProduct(suggestion.product);
    setAddForm(prev => ({ 
      ...prev, 
      name: suggestion.product,
      model_number: suggestion.product 
    }));
    setShowSuggestions(false);
  };
  // -----------------------------------

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
        category: selectedCategory || addForm.category,
        product_type: selectedType,
        product_name: selectedProduct
      };
      
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
        mac_address: '',
        manufacturer: '',
        ticket_number: '',
        category: 'Other',
        store: '',
        location: '',
        status: 'New'
      });
      setSelectedCategory('');
      setSelectedType('');
      setSelectedProduct('');
      setAssets(prev => [created, ...prev]);
      fetchAssets(undefined, { silent: true });
      setShowAddModal(false);
      // Optional: toast style message if desired
    } catch (error) {
      console.error('Error adding asset:', error);
      alert('Failed to add asset');
    } finally {
      setAddLoading(false);
    }
  };

  const handleAssignClick = (asset) => {
    setAssigningAsset(asset);
    setAssignForm({ technicianId: '', ticketNumber: '' });
    setTechSearch('');
    setShowTechSuggestions(false);
    setRecipientType('Technician');
    setOtherRecipient({ name: '', phone: '', note: '' });
  };

  const handleAssignSubmit = async () => {
    if (recipientType === 'Technician' && !assignForm.technicianId) {
      alert('Please select a technician');
      return;
    }
    if (recipientType === 'Other') {
      if (!otherRecipient.name) {
        alert('Please enter recipient name');
        return;
      }
    }
    try {
      const payload = {
        assetId: assigningAsset._id,
        ticketNumber: assignForm.ticketNumber,
      };
      if (recipientType === 'Technician') {
        payload.technicianId = assignForm.technicianId;
      } else {
        payload.otherRecipient = otherRecipient;
      }
      await api.post(`/assets/assign`, payload);
      setAssigningAsset(null);
      fetchAssets(undefined, { silent: true });
      alert('Asset assigned successfully');
    } catch (error) {
      console.error('Error assigning asset:', error);
      alert('Failed to assign asset');
    }
  };

  const handleUnassign = async (asset) => {
    const assigneeName = asset.assigned_to?.name || asset.assigned_to_external?.name || 'External User';
    if (!window.confirm(`Are you sure you want to unassign ${asset.name} from ${assigneeName}?`)) return;

    try {
      await api.post('/assets/unassign', { assetId: asset._id });
      fetchAssets(undefined, { silent: true });
      alert('Asset unassigned successfully');
    } catch (error) {
      console.error('Error unassigning asset:', error);
      alert('Failed to unassign asset');
    }
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
      alert(res.data?.message || 'Bulk update completed');
    } catch (error) {
      console.error('Bulk update error:', error);
      alert(error.response?.data?.message || 'Bulk update failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this asset?')) {
      try {
        await api.delete(`/assets/${id}`);
        setAssets(prev => prev.filter(a => a._id !== id));
        fetchAssets(undefined, { silent: true });
        alert('Asset deleted successfully');
      } catch (error) {
        console.error('Error deleting asset:', error);
        alert('Failed to delete asset');
      }
    }
  };

  const getDerivedStatus = (asset) => {
    // 1. Condition-based statuses (Priority over Assignment)
    // These statuses must ALWAYS be displayed regardless of assignment
    if (asset.status === 'Faulty') {
      return { label: 'Faulty', color: 'bg-red-100 text-red-800' };
    }
    if (asset.status === 'Under Repair') {
      return { label: 'Under Repair', color: 'bg-amber-100 text-amber-800' };
    }
    if (asset.status === 'Disposed') {
      return { label: 'Disposed', color: 'bg-gray-100 text-gray-800' };
    }

    // 2. Assignment status
    if (asset.assigned_to || (asset.assigned_to_external && asset.assigned_to_external.name)) {
      return { label: 'In Use', color: 'bg-blue-100 text-blue-800' };
    }

    // 3. Spare status (Only for Available New/Used)
    if (asset.status === 'New' || asset.status === 'Used') {
      return { label: 'Spare', color: 'bg-green-100 text-green-800' };
    }

    // 4. Fallback (For Testing and other custom statuses)
    // If status is 'Testing', we just show 'Testing' in gray or purple?
    if (asset.status === 'Testing') {
       return { label: 'Testing', color: 'bg-purple-100 text-purple-800' };
    }

    return { label: asset.status, color: 'bg-gray-100 text-gray-800' };
  };


  // Debounced filter/search effect
  useEffect(() => {
    const t = setTimeout(() => {
      if (page !== 1) {
        setPage(1); // This will trigger the page effect
      } else {
        fetchAssets(); // Directly fetch if already on page 1
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, filterLocation, filterStatus, filterCondition, filterCategory, filterManufacturer, filterModelNumber, filterSerialNumber, filterMacAddress, filterProductType, filterProductName, filterTicket, filterRfid, filterQr, filterDateFrom, filterDateTo]);

  // Page/Limit change effect
  useEffect(() => {
    fetchAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit]);

  return (
    <div>
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold">
          {categoryParam ? `${categoryParam} Management` : 'Assets Management'}
        </h1>
        <div className="flex flex-wrap gap-2 items-center">
           <button 
             onClick={() => {
               setSelectedCategory('');
               setSelectedType('');
               setSelectedProduct('');
               setShowAddModal(true);
             }} 
             className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base rounded font-medium flex items-center gap-2"
           >
             <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
               <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
             </svg>
             Add New Asset
           </button>
           <button 
             onClick={() => {
                setSelectedCategory('');
                setSelectedType('');
                setSelectedProduct('');
                setFile(null);
                setImportInfo(null);
                setShowImportModal(true);
             }} 
             className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base rounded flex items-center gap-2"
           >
             Import
           </button>
           <button
             onClick={() => setShowBulkEditModal(true)}
             disabled={selectedIds.length === 0}
             className={`px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base rounded font-medium ${selectedIds.length === 0 ? 'bg-purple-400 text-white cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 text-white'}`}
           >
             Bulk Edit ({selectedIds.length})
           </button>
           <button onClick={handleExport} className="bg-amber-600 hover:bg-amber-700 text-black px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base rounded">Export</button>
           <button onClick={handleDownloadTemplate} className="bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base rounded">Template</button>
        </div>
      </div>
      
      {importInfo && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded mb-4">
          <div>Imported: {importInfo.message}</div>
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
          <div className="mt-2 text-sm text-gray-600">
            Excel headers supported: Asset Type, Model, Serial, MAC, Manufacturer, Ticket, RFID, QR Code, Store, Location, Status
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Search (Name, Model, Serial, MAC, Unique ID, Manufacturer)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="border p-2 rounded"
          />
          <select
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value)}
            className="border p-2 rounded"
          >
            <option value="">All Locations</option>
            {stores
              .filter(s => s.parentStore)
              .map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
          <select
            value={filterCondition}
            onChange={(e) => setFilterCondition(e.target.value)}
            className="border p-2 rounded"
          >
            <option value="">All Conditions</option>
            <option value="New / Excellent">New / Excellent</option>
            <option value="Good / Fair">Good / Fair</option>
            <option value="Used / Substandard">Used / Substandard</option>
            <option value="Repaired / Reconditioned">Repaired / Reconditioned</option>
            <option value="Faulty / Defective">Faulty / Defective</option>
            <option value="Poor / Near Failure">Poor / Near Failure</option>
            <option value="Failed / Unserviceable">Failed / Unserviceable</option>
            <option value="Disposed">Disposed</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border p-2 rounded"
          >
            <option value="">All Statuses</option>
            <option value="New">Spare (New)</option>
            <option value="Used">Spare (Used)</option>
            <option value="In Use">In Use</option>
            <option value="Testing">Testing</option>
            <option value="Faulty">Faulty</option>
            <option value="Under Repair">Under Repair</option>
            <option value="Disposed">Disposed</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="bg-indigo-100 text-indigo-700 px-4 py-2 rounded flex-1 hover:bg-indigo-200"
            >
              {showAdvancedFilters ? 'Hide Filters' : 'More Filters'}
            </button>
            <button
              onClick={() => {
                setSearchTerm(''); setFilterLocation(''); setFilterStatus(''); setFilterCondition('');
                setFilterManufacturer(''); setFilterProductType(''); setFilterProductName('');
                setFilterModelNumber(''); setFilterSerialNumber(''); setFilterMacAddress('');
                setFilterTicket(''); setFilterRfid(''); setFilterQr('');
                setFilterDateFrom(''); setFilterDateTo('');
              }}
              className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
            >
              Clear
            </button>
          </div>
        </div>

        {showAdvancedFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3 pt-3 border-t border-gray-100">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="border p-2 rounded"
            >
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              type="text"
              placeholder="Manufacturer"
              value={filterManufacturer}
              onChange={(e) => setFilterManufacturer(e.target.value)}
              className="border p-2 rounded"
            />
            <input
              type="text"
              placeholder="Model Number"
              value={filterModelNumber}
              onChange={(e) => setFilterModelNumber(e.target.value)}
              className="border p-2 rounded"
            />
            <input
              type="text"
              placeholder="Serial Number"
              value={filterSerialNumber}
              onChange={(e) => setFilterSerialNumber(e.target.value)}
              className="border p-2 rounded"
            />
            <input
              type="text"
              placeholder="MAC Address"
              value={filterMacAddress}
              onChange={(e) => setFilterMacAddress(e.target.value)}
              className="border p-2 rounded"
            />
            <input
              type="text"
              placeholder="Product Type"
              value={filterProductType}
              onChange={(e) => setFilterProductType(e.target.value)}
              className="border p-2 rounded"
            />
            <input
              type="text"
              placeholder="Product Name"
              value={filterProductName}
              onChange={(e) => setFilterProductName(e.target.value)}
              className="border p-2 rounded"
            />
            <input
              type="text"
              placeholder="Ticket Number"
              value={filterTicket}
              onChange={(e) => setFilterTicket(e.target.value)}
              className="border p-2 rounded"
            />
            <input
              type="text"
              placeholder="RFID"
              value={filterRfid}
              onChange={(e) => setFilterRfid(e.target.value)}
              className="border p-2 rounded"
            />
            <input
              type="text"
              placeholder="QR Code"
              value={filterQr}
              onChange={(e) => setFilterQr(e.target.value)}
              className="border p-2 rounded"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-10">From:</span>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="border p-2 rounded w-full"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-10">To:</span>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="border p-2 rounded w-full"
              />
            </div>
          </div>
        )}
      </div>

      {/* Loading Indicator */}
      {loading && (
        <div className="bg-white rounded-lg shadow p-4 mb-4 text-center text-gray-500">
          Loading assets...
        </div>
      )}

      {/* Desktop Table View */}
      <div className="hidden md:block bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="px-3 py-2 md:px-4 md:py-3 text-center">
                <input type="checkbox" checked={selectedIds.length === assets.length && assets.length > 0} onChange={toggleSelectAll} />
              </th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">Unique ID</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">Category</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Model</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Serial</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">Ticket</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">MAC Address</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">Manufacturer</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">Condition</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">Store</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Location</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Assigned To</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">Date & Time</th>
              <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {assets.map((asset) => (
              <tr key={asset._id} className={asset.isDuplicate ? 'bg-yellow-100' : ''}>
                <td className="px-3 py-2 md:px-4 md:py-4 text-center">
                  <input type="checkbox" checked={selectedIds.includes(asset._id)} onChange={() => toggleSelect(asset._id)} />
                </td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap font-mono text-xs text-gray-600 text-center hidden lg:table-cell">{asset.uniqueId || '-'}</td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm">{asset.name}</td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden sm:table-cell">{asset.category || '-'}</td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden md:table-cell">{asset.model_number}</td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm">{asset.serial_number}</td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden lg:table-cell">{asset.ticket_number || '-'}</td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden lg:table-cell">{asset.mac_address || '-'}</td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden xl:table-cell">{asset.manufacturer || '-'}</td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden lg:table-cell">{asset.condition || 'New / Excellent'}</td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm font-medium text-gray-700">
                  {asset.status === 'New' ? 'Spare (New)' : 
                   asset.status === 'Used' ? 'Spare (Used)' : 
                   asset.status === 'Faulty' ? 'Faulty' : 
                   asset.status === 'Disposed' ? 'Disposed' : asset.status}
                </td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden sm:table-cell">
                  {asset.store?.name || '-'}
                </td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden md:table-cell">
                  {asset.location || '-'}
                </td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden md:table-cell">{asset.assigned_to?.name || asset.assigned_to_external?.name || '-'}</td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden xl:table-cell">
                  {asset.updatedAt ? new Date(asset.updatedAt).toLocaleString() : '-'}
                </td>
                <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm">
                  <div className="flex flex-col gap-1 sm:flex-row justify-center">
                  <button 
                    onClick={() => handleEditClick(asset)}
                    className="text-amber-600 hover:text-amber-700 font-medium text-sm md:text-base"
                  >
                    Edit
                  </button>
                  {(asset.assigned_to || (asset.assigned_to_external && asset.assigned_to_external.name)) ? (
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
                  <button 
                    onClick={() => handleDelete(asset._id)}
                    className="text-red-600 hover:text-red-900 font-medium text-sm md:text-base"
                  >
                    Delete
                  </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-4 mb-4">
        {assets.map((asset) => (
          <div key={asset._id} className={`bg-white p-4 rounded-lg shadow-sm border ${asset.isDuplicate ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200'}`}>
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
              <div>
                <span className="text-xs text-gray-500 block">Category</span>
                <span className="font-medium">{asset.category || '-'}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Model</span>
                <span className="font-medium">{asset.model_number}</span>
              </div>
              <div className="col-span-2">
                <span className="text-xs text-gray-500 block">Condition</span>
                <span className="font-medium">{asset.condition || 'New / Excellent'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-xs text-gray-500 block">Status</span>
                <span className="font-medium">
                  {asset.status === 'New' ? 'Spare (New)' : 
                   asset.status === 'Used' ? 'Spare (Used)' : 
                   asset.status === 'Faulty' ? 'Faulty' : 
                   asset.status === 'Disposed' ? 'Disposed' : asset.status}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-xs text-gray-500 block">Serial</span>
                <span className="font-mono font-medium">{asset.serial_number}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Store</span>
                <span className="font-medium">{asset.store?.name || '-'}</span>
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

            <div className="flex gap-3 pt-3 border-t border-gray-100">
              <button 
                onClick={() => handleEditClick(asset)}
                className="flex-1 flex items-center justify-center gap-2 bg-gray-50 text-gray-700 py-2 rounded-md text-sm font-medium hover:bg-gray-100 transition-colors border border-gray-200"
              >
                <Edit size={16} /> Edit
              </button>
              {(asset.assigned_to || (asset.assigned_to_external && asset.assigned_to_external.name)) ? (
                <button 
                  onClick={() => handleUnassign(asset)}
                  className="flex-1 flex items-center justify-center gap-2 bg-orange-50 text-orange-700 py-2 rounded-md text-sm font-medium hover:bg-orange-100 transition-colors border border-orange-200"
                >
                  <UserX size={16} /> Unassign
                </button>
              ) : (
                <button 
                  onClick={() => handleAssignClick(asset)}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-50 text-green-700 py-2 rounded-md text-sm font-medium hover:bg-green-100 transition-colors border border-green-200"
                >
                  <UserCheck size={16} /> Assign
                </button>
              )}
              <button 
                onClick={() => handleDelete(asset._id)}
                className="flex-none flex items-center justify-center bg-red-50 text-red-700 p-2 rounded-md hover:bg-red-100 transition-colors border border-red-200"
                aria-label="Delete"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination Controls */}
      <div className="bg-white rounded-lg shadow p-4 flex flex-col sm:flex-row items-center justify-between gap-4 mt-4">
          <div className="text-sm text-gray-600">
            Showing {(total === 0) ? 0 : ((page - 1) * limit + 1)}–
            {Math.min(page * limit, total)} of {total}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={limit}
              onChange={(e) => { setLimit(parseInt(e.target.value, 10)); setPage(1); }}
              className="border p-2 rounded text-sm"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button
              onClick={() => { if (page > 1) { setPage(page - 1); } }}
              disabled={page <= 1}
              className="px-3 py-2 border rounded disabled:opacity-50"
            >
              Prev
            </button>
            <button
              onClick={() => { const maxPage = Math.ceil(total / limit) || 1; if (page < maxPage) { setPage(page + 1); } }}
              disabled={page >= (Math.ceil(total / limit) || 1)}
              className="px-3 py-2 border rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>

      {/* Assign Modal */}
      {assigningAsset && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Assign Asset</h2>
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">Assigning: <span className="font-semibold">{assigningAsset.name}</span> ({assigningAsset.serial_number})</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Recipient Type</label>
                <div className="mt-1 flex gap-4">
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
                      setAssignForm(prev => ({ ...prev, technicianId: '' }));
                    }}
                    onFocus={() => setShowTechSuggestions(true)}
                    placeholder="Search technician by name, username or phone"
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                  />
                  {showTechSuggestions && (
                    <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto mt-1">
                      {technicians.filter(t => 
                        (t.name || '').toLowerCase().includes(techSearch.toLowerCase()) || 
                        (t.username || '').toLowerCase().includes(techSearch.toLowerCase()) ||
                        (t.phone || '').includes(techSearch)
                      ).length > 0 ? (
                        technicians.filter(t => 
                          (t.name || '').toLowerCase().includes(techSearch.toLowerCase()) || 
                          (t.username || '').toLowerCase().includes(techSearch.toLowerCase()) ||
                          (t.phone || '').includes(techSearch)
                        ).map(tech => (
                          <div
                            key={tech._id}
                            onClick={() => {
                              setAssignForm({ ...assignForm, technicianId: tech._id });
                              setTechSearch(tech.name);
                              setShowTechSuggestions(false);
                            }}
                            className="p-2 hover:bg-amber-50 cursor-pointer border-b last:border-b-0"
                          >
                            <div className="font-medium">{tech.name}</div>
                            <div className="text-xs text-gray-500">
                              {tech.username} {tech.phone ? `| ${tech.phone}` : ''}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="p-2 text-gray-500 text-sm">No technicians found</div>
                      )}
                    </div>
                  )}
                  {assignForm.technicianId && <div className="text-xs text-green-600 mt-1">✓ Technician selected</div>}
                </div>
              )}
              
              {recipientType === 'Other' && (
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Recipient Name</label>
                    <input
                      type="text"
                      value={otherRecipient.name}
                      onChange={(e) => setOtherRecipient({ ...otherRecipient, name: e.target.value })}
                      placeholder="Enter person name"
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Recipient Phone</label>
                    <input
                      type="text"
                      value={otherRecipient.phone}
                      onChange={(e) => setOtherRecipient({ ...otherRecipient, phone: e.target.value })}
                      placeholder="Enter phone"
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Note</label>
                    <input
                      type="text"
                      value={otherRecipient.note}
                      onChange={(e) => setOtherRecipient({ ...otherRecipient, note: e.target.value })}
                      placeholder="Department or reference"
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700">Ticket Number / Reference (Optional)</label>
                <input
                  type="text"
                  value={assignForm.ticketNumber}
                  onChange={(e) => setAssignForm({ ...assignForm, ticketNumber: e.target.value })}
                  placeholder="Enter ticket number or any text"
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => setAssigningAsset(null)}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignSubmit}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
              >
                Assign
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
              
              {/* Hierarchy Selectors - Adapted for Edit */}
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 p-3 rounded mb-2 border">
                 <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Category</label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => {
                        setSelectedCategory(e.target.value);
                        setSelectedType('');
                        setSelectedProduct('');
                        setFormData(prev => ({ ...prev, category: e.target.value }));
                      }}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    >
                      <option value="">Select Category</option>
                      {fullCategories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                    </select>
                 </div>
                 <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Product Type</label>
                    <select
                      value={selectedType}
                      onChange={(e) => {
                        setSelectedType(e.target.value);
                        setSelectedProduct('');
                      }}
                      disabled={!selectedCategory}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm disabled:bg-gray-100"
                    >
                      <option value="">Select Type</option>
                      {getTypes(selectedCategory).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                    </select>
                 </div>
                 <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Product</label>
                    <select
                      value={selectedProduct}
                      onChange={(e) => {
                         const val = e.target.value;
                         setSelectedProduct(val);
                         if (val) {
                            setFormData(prev => ({ ...prev, name: val, model_number: val }));
                         }
                      }}
                      disabled={!selectedType}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm disabled:bg-gray-100"
                    >
                      <option value="">Select Product</option>
                      {getProducts(selectedCategory, selectedType).map(p => (
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
                  {stores
                    .filter(s => s.parentStore) // Only show sub-locations (child stores)
                    .map(s => (
                      <option key={s._id} value={s.name}>{s.name}</option>
                    ))
                  }
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Store (Fixed)</label>
                <select
                  name="store"
                  value={formData.store}
                  onChange={handleInputChange}
                  disabled={true}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 bg-gray-100"
                >
                  {stores.filter(s => !s.parentStore).map(store => (
                    <option key={store._id} value={store._id}>{store.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Condition</label>
                <select
                  name="condition"
                  value={formData.condition}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="New / Excellent">New / Excellent</option>
                  <option value="Good / Fair">Good / Fair</option>
                  <option value="Used / Substandard">Used / Substandard</option>
                  <option value="Repaired / Reconditioned">Repaired / Reconditioned</option>
                  <option value="Faulty / Defective">Faulty / Defective</option>
                  <option value="Poor / Near Failure">Poor / Near Failure</option>
                  <option value="Failed / Unserviceable">Failed / Unserviceable</option>
                  <option value="Disposed">Disposed</option>
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
                  <option value="New">Spare (New)</option>
                  <option value="Used">Spare (Used)</option>
                  <option value="In Use">In Use</option>
                  <option value="Testing">Testing</option>
                  <option value="Faulty">Faulty</option>
                  <option value="Under Repair">Under Repair</option>
                  <option value="Disposed">Disposed</option>
                </select>
              </div>
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
                className="bg-amber-600 hover:bg-amber-700 text-black px-4 py-2 rounded"
              >
                Save Changes
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
              {/* Hierarchy Selectors */}
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 p-3 rounded mb-2 border">
                 <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Category</label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => {
                        setSelectedCategory(e.target.value);
                        setSelectedType('');
                        setSelectedProduct('');
                        setAddForm(prev => ({ ...prev, category: e.target.value }));
                      }}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    >
                      <option value="">Select Category</option>
                      {fullCategories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                    </select>
                 </div>
                 <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Product Type</label>
                    <select
                      value={selectedType}
                      onChange={(e) => {
                        setSelectedType(e.target.value);
                        setSelectedProduct('');
                        // Auto-fill name if empty? Maybe not yet.
                      }}
                      disabled={!selectedCategory}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm disabled:bg-gray-100"
                    >
                      <option value="">Select Type</option>
                      {getTypes(selectedCategory).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                    </select>
                 </div>
                 <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Product</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={selectedProduct}
                        onChange={(e) => handleProductSearch(e.target.value)}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        placeholder="Type product name..."
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                      />
                      {showSuggestions && productSuggestions.length > 0 && (
                        <div className="absolute z-10 w-full bg-white border border-gray-300 mt-1 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {productSuggestions.map((s, idx) => (
                            <div 
                              key={idx}
                              className="p-2 hover:bg-indigo-50 cursor-pointer text-sm"
                              onClick={() => selectSuggestion(s)}
                            >
                              <div className="font-medium">{s.product}</div>
                              <div className="text-xs text-gray-500">{s.category} &gt; {s.type}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Fallback Select for hierarchy navigation if needed, or just rely on search */}
                    {selectedType && (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                             setSelectedProduct(e.target.value);
                             setAddForm(prev => ({ ...prev, name: e.target.value, model_number: e.target.value }));
                          }
                        }}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-1 text-xs text-gray-500"
                      >
                        <option value="">(Or select from {selectedType})</option>
                        {getProducts(selectedCategory, selectedType).map(p => (
                          <option key={p._id || p.name} value={p.name}>
                            {p.level > 0 ? '\u00A0'.repeat(p.level * 4) + '└ ' : ''}{p.name}
                          </option>
                        ))}
                      </select>
                    )}
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
                  {stores
                    .filter(s => s.parentStore) // Only show sub-locations (child stores)
                    .map(s => (
                      <option key={s._id} value={s.name}>{s.name}</option>
                    ))
                  }
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Store (Fixed)</label>
                <select
                  name="store"
                  value={addForm.store}
                  onChange={handleAddChange}
                  disabled={true}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 bg-gray-100"
                >
                  {stores.filter(s => !s.parentStore).map(store => (
                    <option key={store._id} value={store._id}>{store.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Condition</label>
                <select
                  name="condition"
                  value={addForm.condition}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="New / Excellent">New / Excellent</option>
                  <option value="Good / Fair">Good / Fair</option>
                  <option value="Used / Substandard">Used / Substandard</option>
                  <option value="Repaired / Reconditioned">Repaired / Reconditioned</option>
                  <option value="Faulty / Defective">Faulty / Defective</option>
                  <option value="Poor / Near Failure">Poor / Near Failure</option>
                  <option value="Failed / Unserviceable">Failed / Unserviceable</option>
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
                  <option value="New">Spare (New)</option>
                  <option value="Used">Spare (Used)</option>
                  <option value="In Use">In Use</option>
                  <option value="Testing">Testing</option>
                  <option value="Faulty">Faulty</option>
                  <option value="Under Repair">Under Repair</option>
                  <option value="Disposed">Disposed</option>
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

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Bulk Import Assets</h2>
            <div className="space-y-4">
              <div className="bg-blue-50 p-3 rounded text-sm text-blue-800">
                Select the product details below to apply them to all imported rows, or leave blank to use Excel columns.
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700">Location (Optional)</label>
                <select
                  value={bulkLocationId}
                  onChange={(e) => setBulkLocationId(e.target.value)}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="">Use Excel Location column</option>
                  {stores.filter(s => s.parentStore).map(s => (
                    <option key={s._id} value={s._id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Category</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => {
                    setSelectedCategory(e.target.value);
                    setSelectedType('');
                    setSelectedProduct('');
                  }}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="">Select Category</option>
                  {fullCategories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700">Product Type</label>
                <select
                  value={selectedType}
                  onChange={(e) => {
                    setSelectedType(e.target.value);
                    setSelectedProduct('');
                  }}
                  disabled={!selectedCategory}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 disabled:bg-gray-100"
                >
                  <option value="">Select Type</option>
                  {getTypes(selectedCategory).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700">Product</label>
                <select
                  value={selectedProduct}
                  onChange={(e) => setSelectedProduct(e.target.value)}
                  disabled={!selectedType}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 disabled:bg-gray-100"
                >
                  <option value="">Select Product</option>
                  {getProducts(selectedCategory, selectedType).map(p => (
                    <option key={p._id || p.name} value={p.name}>
                      {p.level > 0 ? '\u00A0'.repeat(p.level * 4) + '└ ' : ''}{p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Excel File</label>
                <input 
                  type="file" 
                  onChange={handleFileChange} 
                  className="block w-full text-sm text-gray-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-full file:border-0
                    file:text-sm file:font-semibold
                    file:bg-indigo-50 file:text-indigo-700
                    hover:file:bg-indigo-100" 
                  accept=".xlsx, .xls" 
                />
              </div>
              
              <div className="flex items-center gap-2">
                 <input type="checkbox" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} id="allowDupImport" />
                 <label htmlFor="allowDupImport" className="text-sm text-gray-700">Allow duplicate serials</label>
              </div>

            </div>
            <div className="mt-6 flex justify-between space-x-3">
              <button 
                 onClick={handleDownloadTemplate} 
                 className="text-blue-600 hover:text-blue-800 text-sm font-medium underline"
              >
                 Download Template
              </button>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                     setShowImportModal(false);
                     setFile(null);
                  }}
                  className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={!file}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded disabled:opacity-50"
                >
                  Upload
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {showBulkEditModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Bulk Edit Assets</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Status (Optional)</label>
                <select
                  value={bulkForm.status}
                  onChange={(e) => setBulkForm({ ...bulkForm, status: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="">No change</option>
                  <option value="New">Spare (New)</option>
                  <option value="Used">Spare (Used)</option>
                  <option value="Testing">Testing</option>
                  <option value="Faulty">Faulty</option>
                  <option value="Under Repair">Under Repair</option>
                  <option value="Disposed">Disposed</option>
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
                  <option value="New / Excellent">New / Excellent</option>
                  <option value="Good / Fair">Good / Fair</option>
                  <option value="Used / Substandard">Used / Substandard</option>
                  <option value="Repaired / Reconditioned">Repaired / Reconditioned</option>
                  <option value="Faulty / Defective">Faulty / Defective</option>
                  <option value="Poor / Near Failure">Poor / Near Failure</option>
                  <option value="Failed / Unserviceable">Failed / Unserviceable</option>
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
                  {stores.filter(s => s.parentStore).map(s => (
                    <option key={s._id} value={s._id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
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
    </div>
  );
};

export default Assets;
