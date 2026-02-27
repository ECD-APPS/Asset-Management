import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Edit, Trash2, UserCheck, UserX, Filter, SlidersHorizontal, Download, RotateCcw, Scissors, Clock } from 'lucide-react';
import api from '../api/axios';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';

const flattenProducts = (list, level = 0, ancestors = []) => {
  const out = [];
  (list || []).forEach(p => {
    const pathParts = [...ancestors, p.name];
    const fullPath = pathParts.join(' / ');
    out.push({ ...p, level, fullPath });
    if (p.children && p.children.length > 0) {
      out.push(...flattenProducts(p.children, level + 1, pathParts));
    }
  });
  return out;
};

const Assets = () => {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const productParam = searchParams.get('product');
  const statusParam = searchParams.get('status');
  const actionParam = searchParams.get('action');
  const { user, activeStore } = useAuth();

  const [assets, setAssets] = useState([]);
  const [stores, setStores] = useState([]);
  const [technicians, setTechnicians] = useState([]); // New: Technicians list
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [allowDup, setAllowDup] = useState(false);
  const [importInfo, setImportInfo] = useState(null);
  const [importStep, setImportStep] = useState('select');
  const [importPreview, setImportPreview] = useState(null);
  const [forceLoading, setForceLoading] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [bulkLocationId, setBulkLocationId] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkForm, setBulkForm] = useState({ status: '', condition: '', manufacturer: '', locationId: '' });
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showRecentUploads, setShowRecentUploads] = useState(false);
  const [prevVisibleColumns, setPrevVisibleColumns] = useState(null);
  
  // Custom Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    type: 'danger', // danger | warning | info
    onConfirm: null
  });

  const openConfirm = (title, message, onConfirm, type = 'danger', confirmText = 'Confirm') => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, type, confirmText });
  };

  const [splitModal, setSplitModal] = useState({
    isOpen: false,
    asset: null,
    quantity: 1,
    status: 'Faulty',
    condition: 'Faulty'
  });

  const handleSplitClick = (asset) => {
    setSplitModal({
      isOpen: true,
      asset,
      quantity: 1,
      status: 'Faulty',
      condition: 'Faulty'
    });
  };

  const handleSplitSubmit = async () => {
    try {
      if (!splitModal.asset) return;
      await api.post('/assets/split', {
        assetId: splitModal.asset._id,
        splitQuantity: splitModal.quantity,
        newStatus: splitModal.status,
        newCondition: splitModal.condition
      });
      alert('Asset split successfully');
      setSplitModal(prev => ({ ...prev, isOpen: false }));
      fetchAssets(undefined, { silent: true });
    } catch (error) {
      console.error('Error splitting asset:', error);
      alert(error.response?.data?.message || 'Failed to split asset');
    }
  };

  const handleConfirmImport = async () => {
    if (!Array.isArray(importPreview) || importPreview.length === 0) return;
    try {
      setManualLoading(true);
      // Reuse the original file and let server perform robust parsing/upsert
      const form = new FormData();
      form.append('file', file);
      if (selectedProduct) form.append('product_name', selectedProduct);
      if (bulkLocationId) {
        const loc = stores.find(s => s._id === bulkLocationId);
        if (loc) form.append('location', loc.name);
      }
      const res = await api.post('/assets/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportInfo({ message: res.data?.message || 'Import complete', warnings: res.data?.skipped_duplicates || [], invalid_rows: res.data?.invalid_rows || [] });
      alert(res.data?.message || 'Import completed');
      setShowImportModal(false);
      setImportPreview(null);
      setImportStep('select');
      setFile(null);
      fetchAssets(undefined, { silent: true });
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to import assets');
    } finally {
      setManualLoading(false);
    }
  };

  const handleExportSelected = async () => {
    if (!selectedIds.length) return;
    const rows = assets.filter(a => selectedIds.includes(a._id)).map(a => {
      const out = {
        'Unique ID': a.uniqueId || '',
        'Name': a.name || '',
        'Product Name': a.product_name || '',
        'Model Number': a.model_number || '',
        'Serial Number': a.serial_number || '',
        'Serial Last 4': a.serial_last_4 || '',
        'MAC Address': a.mac_address || '',
        'Manufacturer': a.manufacturer || '',
        'Ticket Number': a.ticket_number || '',
        'RFID': a.rfid || '',
        'QR Code': a.qr_code || '',
        'Status': a.status || '',
        'Previous Status': a.previous_status || '',
        'Condition': a.condition || '',
        'Quantity': a.quantity ?? '',
        'Price': typeof a.price === 'number' ? a.price : '',
        'Vendor Name': a.vendor_name || '',
        'Source': a.source || '',
        'Delivered By': a.delivered_by_name || '',
        'Delivered At': a.delivered_at ? new Date(a.delivered_at).toLocaleString() : '',
        'Store': a.store?.parentStore?.name || a.store?.name || '',
        'Location': a.location || '',
        'Assigned To': a.assigned_to?.name || a.assigned_to_external?.name || '',
        'Updated At': a.updatedAt ? new Date(a.updatedAt).toLocaleString() : '',
        'Created At': a.createdAt ? new Date(a.createdAt).toLocaleString() : ''
      };
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Selected Assets');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'selected_assets.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const closeConfirm = () => {
    setConfirmModal(prev => ({ ...prev, isOpen: false }));
  };

  const handleConfirmAction = async () => {
    if (confirmModal.onConfirm) {
      await confirmModal.onConfirm();
    }
    closeConfirm();
  };

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
    quantity: 1,
    mac_address: '',
    manufacturer: '',
    ticket_number: '',
    store: '',
    location: '',
    status: 'In Store',
    condition: 'New',
    rfid: '',
    qr_code: ''
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterProductName, setFilterProductName] = useState('');
  
  // Advanced Filters
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterManufacturer, setFilterManufacturer] = useState('');
  const [filterModelNumber, setFilterModelNumber] = useState('');
  const [filterSerialNumber, setFilterSerialNumber] = useState('');
  const [filterMacAddress, setFilterMacAddress] = useState('');
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
  const [fullProducts, setFullProducts] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({
    uniqueId: true,
    name: true,
    model: true,
    serial: true,
    serialLast4: true,
    ticket: true,
    poNumber: true,
    mac: true,
    rfid: true,
    qr: true,
    manufacturer: true,
    condition: true,
    status: true,
    prevStatus: true,
    store: true,
    location: true,
    quantity: true,
    vendor: true,
    source: true,
    deliveredBy: true,
    deliveredAt: true,
    assignedTo: true,
    dateTime: true,
    action: true,
    price: true
  });

  useEffect(() => {
    if (showRecentUploads) {
      setPrevVisibleColumns(visibleColumns);
      setVisibleColumns({
        uniqueId: false,
        name: true,
        model: true,
        serial: true,
        serialLast4: false,
        ticket: true,
        poNumber: false,
        mac: true,
        rfid: true,
        qr: true,
        manufacturer: true,
        condition: true,
        status: true,
        prevStatus: false,
        store: true,
        location: true,
        quantity: true,
        vendor: true,
        source: false,
        deliveredBy: true,
        deliveredAt: true,
        assignedTo: false,
        dateTime: false,
        price: true,
        action: true
      });
    } else if (prevVisibleColumns) {
      setVisibleColumns(prevVisibleColumns);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRecentUploads]);

  const handleTopEdit = () => {
    if (selectedIds.length === 0) return;
    if (selectedIds.length === 1) {
      const asset = assets.find(a => a._id === selectedIds[0]);
      if (asset) handleEditClick(asset);
    } else {
      setShowBulkEditModal(true);
    }
  };

  const handleTopAssign = () => {
    if (selectedIds.length !== 1) return;
    const asset = assets.find(a => a._id === selectedIds[0]);
    if (asset) handleAssignClick(asset);
  };

  const handleTopDelete = () => {
    if (selectedIds.length === 0) return;
    if (selectedIds.length === 1) {
      handleDelete(selectedIds[0]);
    } else {
      handleBulkDelete();
    }
  };

  // Sync category & status params from URL
  useEffect(() => {
    setFilterProductName(productParam || '');
    setFilterStatus(statusParam || '');
    if (actionParam === 'add') setShowAddModal(true);
  }, [productParam, statusParam, actionParam]);


  // Hierarchical State for Add/Import
  const [selectedProduct, setSelectedProduct] = useState('');

  const fetchProducts = useCallback(async () => {
    try {
      const res = await api.get('/products');
      setFullProducts(res.data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  }, []);

  const flatProducts = useMemo(() => flattenProducts(fullProducts), [fullProducts]);

  const fetchAssets = async (params, options) => {
    const silent = options?.silent === true;
    try {
      if (!silent) setLoading(true);
      const response = await api.get('/assets', {
        params: {
          page,
          limit,
          recent_upload: showRecentUploads,
          q: searchTerm || undefined,
          status: filterStatus || undefined,
          location: filterLocation || undefined,
          condition: filterCondition || undefined, // Add condition filter
          // category removed
          manufacturer: filterManufacturer || undefined,
          model_number: filterModelNumber || undefined,
          serial_number: filterSerialNumber || undefined,
          mac_address: filterMacAddress || undefined,
          // product_type removed
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

  const fetchStores = useCallback(async () => {
    try {
      if (activeStore && activeStore._id) {
        const response = await api.get(`/stores?parent=${activeStore._id}`);
        setStores(response.data || []);
      } else {
        const response = await api.get('/stores');
        setStores(response.data || []);
      }
    } catch (error) {
      console.error('Error fetching stores:', error);
    }
  }, [activeStore]);
  
  const fetchTechnicians = useCallback(async () => {
    try {
      const response = await api.get('/users');
      setTechnicians(response.data || []);
    } catch (error) {
      setTechnicians([]);
      console.error('Error fetching technicians:', error);
    }
  }, []);

  useEffect(() => {
    fetchStores();
    fetchTechnicians();
    fetchProducts();
  }, [fetchStores, fetchTechnicians, fetchProducts]);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('allowDuplicates', String(allowDup));
    if (selectedProduct) formData.append('product_name', selectedProduct);
    if (bulkLocationId) {
      const loc = stores.find(s => s._id === bulkLocationId);
      if (loc) formData.append('location', loc.name);
    }
    try {
      setManualLoading(true);
      const res = await api.post('/assets/import/preview', formData);
      const preview = res.data?.assets || [];
      setImportPreview(preview);
      setImportStep('preview');
    } catch (error) {
      const data = error.response?.data;
      if (data) {
        alert(data.message || data.error || 'Preview failed');
      } else {
        alert('Preview failed');
      }
      console.error('Bulk import error:', error);
    } finally {
      setManualLoading(false);
    }
  };

  const handleForceAdd = async () => {
    if (!importInfo?.skipped_duplicates?.length) return;
    
    const assetsToAdd = importInfo.skipped_duplicates
      .filter(d => d.asset)
      .map(d => d.asset);
      
    if (assetsToAdd.length === 0) {
      alert('No valid duplicate assets found to add.');
      return;
    }

    openConfirm(
      'Force Import Duplicates',
      `Are you sure you want to add ${assetsToAdd.length} duplicate assets?`,
      async () => {
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
      },
      'warning',
      'Add Duplicates'
    );
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
      openConfirm(
        'Asset Assigned',
        "This asset is currently assigned. Do you want to unassign it before editing?",
        async () => {
          try {
            const res = await api.post('/assets/unassign', { assetId: asset._id });
            const unassignedAsset = res.data;
            alert('Asset unassigned successfully. Opening edit form...');
            // Proceed to edit with unassigned asset
            setEditingAsset(unassignedAsset);
            setupEditForm(unassignedAsset);
            fetchAssets(); 
          } catch (error) {
            console.error('Error unassigning asset:', error);
            alert('Failed to unassign asset. Opening edit form with current state.');
            // Proceed with original asset
            setEditingAsset(asset);
            setupEditForm(asset);
          }
        },
        'warning',
        'Unassign & Edit'
      );
      return; // Stop execution, wait for modal
    }

    setEditingAsset(assetToEdit);
    setupEditForm(assetToEdit);
  };

  const setupEditForm = (assetToEdit) => {
    const initialStatus = assetToEdit.status;
    setFormData({
      name: assetToEdit.name,
      model_number: assetToEdit.model_number,
      serial_number: assetToEdit.serial_number,
      mac_address: assetToEdit.mac_address || '',
      manufacturer: assetToEdit.manufacturer || '',
      ticket_number: assetToEdit.ticket_number || '',
      rfid: assetToEdit.rfid || '',
      qr_code: assetToEdit.qr_code || '',
      store: assetToEdit.store?._id || assetToEdit.store || '',
      location: assetToEdit.location || '',
      status: initialStatus,
      condition: assetToEdit.condition || 'New'
    });

    // Populate Hierarchy
    setSelectedProduct(assetToEdit.product_name || '');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const up = typeof value === 'string' ? value.toUpperCase() : value;
    setFormData({ ...formData, [name]: up });
  };

  const handleSave = async () => {
    try {
      const updateData = { 
        ...formData,
        product_name: selectedProduct
      };

      // Remove empty store to prevent CastError
      if (!updateData.store) {
        delete updateData.store;
      }

      const res = await api.put(`/assets/${editingAsset._id}`, updateData);
      const updated = res.data;
      setEditingAsset(null);
      setAssets(prev => prev.map(a => a._id === updated._id ? { ...a, ...updated } : a));
      fetchAssets(undefined, { silent: true });
      fetchProducts();
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
    const { name, value } = e.target;
    const up = typeof value === 'string' ? value.toUpperCase() : value;
    setAddForm({ ...addForm, [name]: up });
  };
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
        quantity: 1,
        mac_address: '',
        manufacturer: '',
        ticket_number: '',
        store: '',
        location: '',
        status: 'New'
      });
      setSelectedProduct('');
      setAssets(prev => [created, ...prev]);
      fetchAssets(undefined, { silent: true });
      fetchProducts();
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
    
    openConfirm(
      'Unassign Asset',
      `Are you sure you want to unassign ${asset.name} from ${assigneeName}?`,
      async () => {
        try {
          await api.post('/assets/unassign', { assetId: asset._id });
          fetchAssets(undefined, { silent: true });
          alert('Asset unassigned successfully');
        } catch (error) {
          console.error('Error unassigning asset:', error);
          alert('Failed to unassign asset');
        }
      },
      'warning',
      'Unassign'
    );
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
      // category/product_type removed
      if (bulkForm.product_name) updates.product_name = bulkForm.product_name;
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
      fetchProducts();
      alert(res.data?.message || 'Bulk update completed');
    } catch (error) {
      console.error('Bulk update error:', error);
      alert(error.response?.data?.message || 'Bulk update failed');
    } finally {
      setBulkLoading(false);
    }
  };
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    
    openConfirm(
      'Bulk Delete',
      `Delete ${selectedIds.length} selected asset(s)? This cannot be undone.`,
      async () => {
        try {
          setBulkLoading(true);
          const res = await api.post('/assets/bulk-delete', { ids: selectedIds });
          const deletedIds = res.data?.deletedIds || selectedIds;
          setAssets(prev => prev.filter(a => !deletedIds.includes(a._id)));
          setSelectedIds([]);
          fetchAssets(undefined, { silent: true });
          alert(res.data?.message || 'Bulk delete completed');
        } catch (error) {
          console.error('Bulk delete error:', error);
          alert(error.response?.data?.message || 'Bulk delete failed');
        } finally {
          setBulkLoading(false);
        }
      },
      'danger',
      'Delete All'
    );
  };

  const handleDelete = async (id) => {
    openConfirm(
      'Delete Asset',
      'Are you sure you want to delete this asset?',
      async () => {
        try {
          await api.delete(`/assets/${id}`);
          setAssets(prev => prev.filter(a => a._id !== id));
          fetchAssets(undefined, { silent: true });
          alert('Asset deleted successfully');
        } catch (error) {
          console.error('Error deleting asset:', error);
          alert('Failed to delete asset');
        }
      },
      'danger',
      'Delete'
    );
  };

  const getDerivedStatus = (asset) => {
    const s = asset.status;
    const cond = String(asset.condition || '').toLowerCase();
    if (cond.includes('faulty') || s === 'Faulty') return { label: 'Faulty', color: 'bg-red-100 text-red-800' };
    if (cond.includes('repair') || s === 'Under Repair') return { label: 'Under Repair', color: 'bg-amber-100 text-amber-800' };
    if (cond.includes('disposed') || s === 'Disposed') return { label: 'Disposed', color: 'bg-gray-100 text-gray-800' };
    if (cond.includes('scrap') || s === 'Scrapped') return { label: 'Scrapped', color: 'bg-gray-100 text-gray-800' };
    if (s === 'In Use') return { label: 'In Use', color: 'bg-blue-100 text-blue-800' };
    if (s === 'In Store') return { label: 'In Store', color: 'bg-green-100 text-green-800' };
    if (s === 'Spare') return { label: 'Spare', color: 'bg-green-100 text-green-800' };
    if (s === 'Missing') return { label: 'Missing', color: 'bg-amber-100 text-amber-800' };
    return { label: s || '-', color: 'bg-gray-100 text-gray-800' };
  };


  // Debounced filter/search effect
  useEffect(() => {
    const t = setTimeout(() => {
      if (page !== 1) {
        setPage(1); // This will trigger the page effect
      } else {
        fetchAssets(); // Directly fetch if already on page 1
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRecentUploads, searchTerm, filterLocation, filterStatus, filterCondition, filterManufacturer, filterModelNumber, filterSerialNumber, filterMacAddress, filterProductName, filterTicket, filterRfid, filterQr, filterDateFrom, filterDateTo]);

  // Page/Limit change effect
  useEffect(() => {
    fetchAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit]);

  return (
    <div>
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold">
          {productParam ? `${productParam} Management` : 'Assets Management'}
        </h1>
        <div className="flex flex-wrap gap-2 items-center">
           {user?.role !== 'Viewer' && (
             <>
               <button 
                 onClick={() => {
                   setSelectedProduct('');
                   setAddForm(prev => ({ ...prev, store: activeStore?._id || prev.store, status: prev.status || 'In Store', condition: prev.condition || 'New' }));
                   setShowAddModal(true);
                 }} 
                 className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
               >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                   <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                 </svg>
                 Add New Asset
               </button>
               <button
                 onClick={() => setShowBulkEditModal(true)}
                 disabled={selectedIds.length === 0}
                 className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg border text-sm ${selectedIds.length === 0 ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
               >
                 Bulk Edit ({selectedIds.length})
               </button>
               <button
                 onClick={handleBulkDelete}
                 disabled={selectedIds.length === 0 || bulkLoading}
                 className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg border text-sm ${selectedIds.length === 0 || bulkLoading ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
               >
                 {bulkLoading ? 'Deleting…' : `Delete Selected (${selectedIds.length})`}
               </button>
               <button onClick={() => setShowImportModal(true)} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">Bulk Import</button>
               <button onClick={handleDownloadTemplate} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">Download Sample</button>
             </>
           )}
          <button onClick={handleExport} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">Export</button>
        </div>
      </div>
      
      {importInfo && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded mb-4">
          <div>Imported: {importInfo.message}</div>
          {importInfo.warnings && importInfo.warnings.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-sm">Warnings:</div>
              <ul className="text-sm list-disc ml-5">
                {importInfo.warnings.slice(0, 10).map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
              {importInfo.warnings.length > 10 && (
                <div className="text-xs text-gray-600 mt-1">and {importInfo.warnings.length - 10} more...</div>
              )}
            </div>
          )}
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
            Excel headers supported: Category, Product Type, Product Name, Model, Quantity, Serial, MAC, Manufacturer, Ticket, RFID, QR Code, Store, Location, Status, Condition
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-2xl relative">
            <h2 className="text-xl font-bold mb-4">Bulk Import Assets</h2>
            {importStep === 'select' && (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Template</label>
                    <div className="flex gap-2">
                      <button onClick={handleDownloadTemplate} className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-2 rounded">Download Sample Sheet</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Default Product (optional)</label>
                    <select
                      value={selectedProduct}
                      onChange={(e) => setSelectedProduct(e.target.value)}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    >
                      <option value="">Select Product</option>
                      {flatProducts.map(p => (
                        <option key={p._id || p.name} value={p.name}>
                            {p.fullPath}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Default Location (optional)</label>
                    <select
                      value={bulkLocationId}
                      onChange={(e) => setBulkLocationId(e.target.value)}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    >
                      <option value="">Select Location</option>
                      {stores.map(s => (
                        <option key={s._id} value={s._id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="allowDup"
                      checked={allowDup}
                      onChange={(e) => setAllowDup(e.target.checked)}
                    />
                    <label htmlFor="allowDup" className="text-sm text-gray-700">Allow duplicates in same store</label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Excel File</label>
                    <input type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm" />
                  </div>
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    onClick={() => { setShowImportModal(false); setFile(null); }}
                    className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpload}
                    disabled={manualLoading}
                    className={`text-white px-4 py-2 rounded ${manualLoading ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                  >
                    {manualLoading ? 'Uploading, please wait…' : 'Preview'}
                  </button>
                </div>
              </>
            )}
            {importStep === 'preview' && (
              <>
                <div className="mb-4 text-sm text-gray-700">
                  Previewing {importPreview?.length || 0} assets
                </div>
                <div className="max-h-80 overflow-auto border rounded">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-2 text-left">Name</th>
                        <th className="px-2 py-2 text-left">Model</th>
                        <th className="px-2 py-2 text-left">Serial</th>
                        <th className="px-2 py-2 text-left">Status</th>
                        <th className="px-2 py-2 text-left">Condition</th>
                        <th className="px-2 py-2 text-left">Location</th>
                        <th className="px-2 py-2 text-left">Vendor</th>
                        <th className="px-2 py-2 text-left">Delivered By</th>
                        <th className="px-2 py-2 text-left">Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(importPreview || []).slice(0, 50).map((a, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-2 py-2">{a.name}</td>
                          <td className="px-2 py-2">{a.model_number || '-'}</td>
                          <td className="px-2 py-2">{a.serial_number || '-'}</td>
                          <td className="px-2 py-2">{a.status || '-'}</td>
                          <td className="px-2 py-2">{a.condition || '-'}</td>
                          <td className="px-2 py-2">{a.location || '-'}</td>
                          <td className="px-2 py-2">{a.vendor_name || '-'}</td>
                          <td className="px-2 py-2">{a.delivered_by_name || '-'}</td>
                          <td className="px-2 py-2">{a.quantity ?? 1}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    onClick={() => { setImportStep('select'); setImportPreview(null); }}
                    className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirmImport}
                    disabled={manualLoading}
                    className={`text-white px-4 py-2 rounded ${manualLoading ? 'bg-green-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                  >
                    {manualLoading ? 'Importing…' : 'Confirm Import'}
                  </button>
                </div>
              </>
            )}
            {manualLoading && (
              <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  <div className="text-sm font-medium text-gray-700">Processing upload, please wait…</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow border border-gray-100 p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-center">
          <input
            type="text"
            placeholder="Search (Name, Model, Serial, MAC, Unique ID, Manufacturer)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <select
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value)}
            className="h-10 px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">All Locations</option>
            {stores.map(s => <option key={s._id} value={s.name}>{s.name}</option>)}
          </select>
          <select
            value={filterCondition}
            onChange={(e) => setFilterCondition(e.target.value)}
            className="h-10 px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">All Conditions</option>
            <option value="New">New</option>
            <option value="Used">Used</option>
            <option value="Faulty">Faulty</option>
            <option value="Repaired">Repaired</option>
            <option value="Under Repair">Under Repair</option>
            <option value="Disposed">Disposed</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-10 px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="In Store">In Store</option>
            <option value="In Use">In Use</option>
            <option value="Spare">Spare</option>
            <option value="Missing">Missing</option>
            <option value="Scrapped">Scrapped</option>
          </select>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4 items-center">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100"
            >
              <Filter className="w-4 h-4" />
              {showAdvancedFilters ? 'Hide Filters' : 'Filters'}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowColumnMenu(v => !v)}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Columns
              </button>
              {showColumnMenu && (
                <div className="absolute z-20 mt-2 right-0 bg-white border border-gray-200 shadow-xl rounded-lg p-3 w-64 max-h-72 overflow-auto">
                  {[
                    ['uniqueId','Unique ID'],['name','Name'],['model','Model'],['serial','Serial'],['serialLast4','Serial Last 4'],
                    ['ticket','Ticket'],['poNumber','PO Number'],['mac','MAC Address'],['rfid','RFID'],['qr','QR Code'],['manufacturer','Manufacturer'],
                    ['condition','Condition'],['status','Status'],['prevStatus','Prev Status'],['store','Store'],['location','Location'],
                    ['quantity','Quantity'],['vendor','Vendor'],['source','Source'],['deliveredBy','Delivered By'],['deliveredAt','Delivered At'],
                    ['assignedTo','Assigned To'],['dateTime','Date & Time'],['price','Price'],['action','Action']
                  ].map(([key,label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={visibleColumns[key]}
                        onChange={(e) => setVisibleColumns(prev => ({ ...prev, [key]: e.target.checked }))}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowRecentUploads(prev => !prev)}
              className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg border ${showRecentUploads ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
              title="Show only the most recently uploaded assets"
            >
              <Clock className="w-4 h-4" />
              Recent Uploads
            </button>
            <button
              onClick={() => {
                setSearchTerm(''); setFilterLocation(''); setFilterStatus(''); setFilterCondition('');
                setFilterManufacturer(''); setFilterProductName('');
                setFilterModelNumber(''); setFilterSerialNumber(''); setFilterMacAddress('');
                setFilterTicket(''); setFilterRfid(''); setFilterQr('');
                setFilterDateFrom(''); setFilterDateTo('');
                setShowRecentUploads(false);
              }}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              <RotateCcw className="w-4 h-4" />
              Clear
            </button>
            <button
              onClick={handleExportSelected}
              disabled={selectedIds.length === 0}
              className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm ${selectedIds.length === 0 ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'} border`}
              title="Download selected rows as Excel"
            >
              <Download className="w-4 h-4" />
              Download Selected
            </button>
            <div className="ml-auto flex gap-2">
              {user?.role !== 'Viewer' && (
                <>
                  <button
                    onClick={handleTopEdit}
                    disabled={selectedIds.length === 0}
                    className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm ${selectedIds.length === 0 ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'} border`}
                    title="Edit selected (single = Edit; multiple = Bulk Edit)"
                  >
                    <Edit size={16} />
                    {selectedIds.length > 1 ? 'Bulk Edit' : 'Edit'}
                  </button>
                  <button
                    onClick={handleTopAssign}
                    disabled={selectedIds.length !== 1}
                    className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm ${selectedIds.length !== 1 ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'} border`}
                    title="Assign selected asset"
                  >
                    <UserCheck size={16} />
                    Assign
                  </button>
                  <button
                    onClick={handleTopDelete}
                    disabled={selectedIds.length === 0}
                    className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm ${selectedIds.length === 0 ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'} border`}
                    title="Delete selected"
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {showAdvancedFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3 pt-3 border-t border-gray-100">
            <input
              type="text"
              placeholder="Manufacturer"
              value={filterManufacturer}
              onChange={(e) => setFilterManufacturer(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="Model Number"
              value={filterModelNumber}
              onChange={(e) => setFilterModelNumber(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="Serial Number"
              value={filterSerialNumber}
              onChange={(e) => setFilterSerialNumber(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="MAC Address"
              value={filterMacAddress}
              onChange={(e) => setFilterMacAddress(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            {/* Product Type filter removed */}
            <input
              type="text"
              placeholder="Product Name"
              value={filterProductName}
              onChange={(e) => setFilterProductName(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="Ticket Number"
              value={filterTicket}
              onChange={(e) => setFilterTicket(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="RFID"
              value={filterRfid}
              onChange={(e) => setFilterRfid(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="QR Code"
              value={filterQr}
              onChange={(e) => setFilterQr(e.target.value)}
              className="h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-10">From:</span>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="h-10 px-3 border border-gray-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-10">To:</span>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="h-10 px-3 border border-gray-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
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
              {user?.role !== 'Viewer' && (
                <th className="px-3 py-2 md:px-4 md:py-3 text-center">
                  <input onClick={(e) => e.stopPropagation()} type="checkbox" checked={selectedIds.length === assets.length && assets.length > 0} onChange={toggleSelectAll} />
                </th>
              )}
              {visibleColumns.uniqueId && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">Unique ID</th>}
              {visibleColumns.name && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>}
              {visibleColumns.model && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Model</th>}
              {visibleColumns.serial && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Serial</th>}
              {visibleColumns.serialLast4 && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">Serial Last 4</th>}
              {visibleColumns.ticket && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">Ticket</th>}
              {visibleColumns.poNumber && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">PO Number</th>}
              {visibleColumns.mac && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">MAC Address</th>}
              {visibleColumns.rfid && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">RFID</th>}
              {visibleColumns.qr && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">QR Code</th>}
              {visibleColumns.manufacturer && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">Manufacturer</th>}
              {visibleColumns.condition && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">Condition</th>}
              {visibleColumns.status && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>}
              {visibleColumns.prevStatus && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">Prev Status</th>}
              {visibleColumns.store && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">Store</th>}
              {visibleColumns.location && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Location</th>}
              {visibleColumns.quantity && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">Quantity</th>}
              {visibleColumns.vendor && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">Vendor</th>}
              {visibleColumns.source && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">Source</th>}
              {visibleColumns.deliveredBy && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">Delivered By</th>}
              {visibleColumns.deliveredAt && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">Delivered At</th>}
              {visibleColumns.assignedTo && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Assigned To</th>}
              {visibleColumns.dateTime && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">Date & Time</th>}
              {visibleColumns.price && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">Price</th>}
              {(visibleColumns.action && user?.role !== 'Viewer') && <th className="px-3 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {assets.map((asset) => (
              <tr key={asset._id} className={`hover:bg-gray-50 ${asset.isDuplicate ? 'bg-yellow-100' : ''} cursor-pointer`} onClick={() => window.open(`/asset/${asset._id}`, '_blank')}>
                {user?.role !== 'Viewer' && (
                  <td className="px-3 py-2 md:px-4 md:py-4 text-center" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.includes(asset._id)} onChange={() => toggleSelect(asset._id)} />
                  </td>
                )}
                {visibleColumns.uniqueId && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap font-mono text-xs text-gray-600 text-center hidden lg:table-cell">{asset.uniqueId || '-'}</td>}
                {visibleColumns.name && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm">{asset.name}</td>}
                {visibleColumns.model && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden md:table-cell">{asset.model_number}</td>}
                {visibleColumns.serial && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm">{asset.serial_number}</td>}
                {visibleColumns.serialLast4 && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-xs hidden xl:table-cell">{asset.serial_last_4 || '-'}</td>}
                {visibleColumns.ticket && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden lg:table-cell">{asset.ticket_number || '-'}</td>}
                {visibleColumns.poNumber && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden lg:table-cell">{asset.po_number || '-'}</td>}
                {visibleColumns.mac && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden lg:table-cell">{asset.mac_address || '-'}</td>}
                {visibleColumns.rfid && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-xs hidden xl:table-cell">{asset.rfid || '-'}</td>}
                {visibleColumns.qr && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-xs hidden xl:table-cell">{asset.qr_code || '-'}</td>}
                {visibleColumns.manufacturer && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden xl:table-cell">{asset.manufacturer || '-'}</td>}
                {visibleColumns.condition && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden lg:table-cell">{asset.condition || 'New / Excellent'}</td>}
                {visibleColumns.status && (
                  <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm font-medium text-gray-700">
                    {asset.status || '-'}
                  </td>
                )}
                {visibleColumns.prevStatus && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-xs hidden xl:table-cell">{asset.previous_status || '-'}</td>}
                {visibleColumns.store && (
                  <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden sm:table-cell">
                    {(asset.store?.parentStore?.name) || (asset.store?.name) || (activeStore?.name) || '-'}
                  </td>
                )}
                {visibleColumns.location && (
                  <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden md:table-cell">
                    {asset.location || '-'}
                  </td>
                )}
                {visibleColumns.quantity && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden lg:table-cell">{asset.quantity ?? '-'}</td>}
                {visibleColumns.vendor && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-xs hidden xl:table-cell">{asset.vendor_name || '-'}</td>}
                {visibleColumns.source && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-xs hidden xl:table-cell">{asset.source || '-'}</td>}
                {visibleColumns.deliveredBy && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-xs hidden xl:table-cell">{asset.delivered_by_name || '-'}</td>}
                {visibleColumns.deliveredAt && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-xs hidden xl:table-cell">{asset.delivered_at ? new Date(asset.delivered_at).toLocaleString() : '-'}</td>}
                {visibleColumns.assignedTo && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden md:table-cell">{asset.assigned_to?.name || asset.assigned_to_external?.name || '-'}</td>}
                {visibleColumns.dateTime && (
                  <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden xl:table-cell">
                    {asset.updatedAt ? new Date(asset.updatedAt).toLocaleString() : '-'}
                  </td>
                )}
                {visibleColumns.price && <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm hidden lg:table-cell">{typeof asset.price === 'number' ? asset.price : '-'}</td>}
                {(visibleColumns.action && user?.role !== 'Viewer') && (
                  <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-center text-sm" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-col gap-1 sm:flex-row justify-center">
                      <button 
                        onClick={() => handleEditClick(asset)}
                        className="text-amber-600 hover:text-amber-700 font-medium text-sm md:text-base"
                      >
                        Edit
                      </button>
                      {asset.quantity > 1 && (
                        <button
                          onClick={() => handleSplitClick(asset)}
                          className="text-purple-600 hover:text-purple-900 font-medium text-sm md:text-base flex items-center gap-1"
                          title="Split / Report Faulty"
                        >
                          <Scissors size={14} />
                          Split
                        </button>
                      )}
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
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-4 mb-4">
        {assets.map((asset) => (
          <div key={asset._id} className={`bg-white p-4 rounded-lg shadow-sm border ${asset.isDuplicate ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200'}`} onClick={() => window.open(`/asset/${asset._id}`, '_blank')}>
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
              {/* Category removed */}
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
                <span className="font-medium">{asset.status || '-'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-xs text-gray-500 block">Serial</span>
                <span className="font-mono font-medium">{asset.serial_number}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Store</span>
                <span className="font-medium">{(asset.store?.parentStore?.name) || (asset.store?.name) || (activeStore?.name) || '-'}</span>
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

            {user?.role !== 'Viewer' && (
              <div className="flex gap-3 pt-3 border-t border-gray-100">
                <button 
                  onClick={(e) => { e.stopPropagation(); handleEditClick(asset); }}
                  className="flex-1 flex items-center justify-center gap-2 bg-gray-50 text-gray-700 py-2 rounded-md text-sm font-medium hover:bg-gray-100 transition-colors border border-gray-200"
                >
                  <Edit size={16} /> Edit
                </button>
                {user?.role !== 'Viewer' && asset.quantity > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSplitClick(asset); }}
                    className="flex-none flex items-center justify-center bg-purple-50 text-purple-700 p-2 rounded-md hover:bg-purple-100 transition-colors border border-purple-200"
                    aria-label="Split"
                  >
                    <Scissors size={16} />
                  </button>
                )}
                {(asset.assigned_to || (asset.assigned_to_external && asset.assigned_to_external.name)) ? (
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleUnassign(asset); }}
                    className="flex-1 flex items-center justify-center gap-2 bg-orange-50 text-orange-700 py-2 rounded-md text-sm font-medium hover:bg-orange-100 transition-colors border border-orange-200"
                  >
                    <UserX size={16} /> Unassign
                  </button>
                ) : (
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleAssignClick(asset); }}
                    className="flex-1 flex items-center justify-center gap-2 bg-green-50 text-green-700 py-2 rounded-md text-sm font-medium hover:bg-green-100 transition-colors border border-green-200"
                  >
                    <UserCheck size={16} /> Assign
                  </button>
                )}
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDelete(asset._id); }}
                  className="flex-none flex items-center justify-center bg-red-50 text-red-700 p-2 rounded-md hover:bg-red-100 transition-colors border border-red-200"
                  aria-label="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
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
            <button
              onClick={handleExportSelected}
              disabled={selectedIds.length === 0}
              className={`px-3 py-2 rounded text-sm ${selectedIds.length === 0 ? 'bg-amber-300 text-white cursor-not-allowed' : 'bg-amber-500 hover:bg-amber-600 text-white'}`}
              title="Download selected rows as Excel"
            >
              Download Selected
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
              
              {/* Product Selector */}
              <div className="md:col-span-2 grid grid-cols-1 gap-4 bg-gray-50 p-3 rounded mb-2 border">
                 <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Product</label>
                    <select
                      value={selectedProduct}
                      onChange={(e) => {
                         const val = e.target.value;
                         setSelectedProduct(val);
                         if (val) {
                            setFormData(prev => ({ ...prev, name: String(val).toUpperCase(), model_number: String(val).toUpperCase() }));
                         }
                      }}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    >
                      <option value="">Select Product</option>
                      {flatProducts.map(p => (
                        <option key={p._id || p.name} value={p.name}>
                          {p.fullPath}
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
                  {stores.map(s => (
                    <option key={s._id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
        {/* Store field removed per requirements */}
              <div>
                <label className="block text-sm font-medium text-gray-700">Condition</label>
                <select
                  name="condition"
                  value={formData.condition}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="New">New</option>
                  <option value="Used">Used</option>
                  <option value="Faulty">Faulty</option>
                  <option value="Repaired">Repaired</option>
                  <option value="Under Repair">Under Repair</option>
                  <option value="Disposed">Disposed</option>
                  <option value="Scrapped">Scrapped</option>
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
                  <option value="In Store">In Store</option>
                  <option value="In Use">In Use</option>
                  <option value="Spare">Spare</option>
                  <option value="Missing">Missing</option>
                  <option value="Scrapped">Scrapped</option>
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
              {/* Product Selector */}
              <div className="md:col-span-2 grid grid-cols-1 gap-4 bg-gray-50 p-3 rounded mb-2 border">
                 <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Product</label>
                    <select
                      value={selectedProduct}
                      onChange={(e) => {
                         const val = e.target.value;
                         setSelectedProduct(val);
                         if (val) {
                            setAddForm(prev => ({ ...prev, name: String(val).toUpperCase(), model_number: String(val).toUpperCase() }));
                         }
                      }}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    >
                      <option value="">Select Product</option>
                      {flatProducts.map(p => (
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
                <label className="block text-sm font-medium text-gray-700">Quantity</label>
                <input
                  type="number"
                  name="quantity"
                  min="1"
                  value={addForm.quantity}
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
                  {stores.map(s => (
                    <option key={s._id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
        {/* Store field removed per requirements */}
              <div>
                <label className="block text-sm font-medium text-gray-700">Condition</label>
                <select
                  name="condition"
                  value={addForm.condition}
                  onChange={handleAddChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="New">New</option>
                  <option value="Used">Used</option>
                  <option value="Faulty">Faulty</option>
                  <option value="Repaired">Repaired</option>
                  <option value="Under Repair">Under Repair</option>
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
                  <option value="In Store">In Store</option>
                  <option value="In Use">In Use</option>
                  <option value="Spare">Spare</option>
                  <option value="Missing">Missing</option>
                  <option value="Scrapped">Scrapped</option>
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


      {/* Bulk Edit Modal */}
      {showBulkEditModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Bulk Edit Assets</h2>
            <div className="space-y-4">
              <div className="bg-purple-50 p-3 rounded text-sm text-purple-800 mb-2">
                Select fields to update for all selected assets. Leave blank to keep existing values.
              </div>

              {/* Product Selector for Bulk Edit */}
              <div className="grid grid-cols-1 gap-3 border-b pb-4 mb-2">
                 <div>
                    <label className="block text-sm font-medium text-gray-700">Product (Optional)</label>
                    <select
                      value={bulkForm.product_name || ''}
                      onChange={(e) => setBulkForm({ ...bulkForm, product_name: e.target.value })}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                    >
                      <option value="">No change</option>
                      {flatProducts.map(p => (
                        <option key={p._id || p.name} value={p.name}>
                          {p.fullPath}
                        </option>
                      ))}
                    </select>
                 </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Status (Optional)</label>
                <select
                  value={bulkForm.status}
                  onChange={(e) => setBulkForm({ ...bulkForm, status: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="">No change</option>
                  <option value="In Store">In Store</option>
                  <option value="In Use">In Use</option>
                  <option value="Spare">Spare</option>
                  <option value="Missing">Missing</option>
                  <option value="Scrapped">Scrapped</option>
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
                  <option value="New">New</option>
                  <option value="Used">Used</option>
                  <option value="Faulty">Faulty</option>
                  <option value="Repaired">Repaired</option>
                  <option value="Under Repair">Under Repair</option>
                  <option value="Disposed">Disposed</option>
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
                  {stores.map(s => (
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

      {/* Custom Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-[100]">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-sm mx-4">
            <h2 className={`text-xl font-bold mb-2 ${confirmModal.type === 'danger' ? 'text-red-600' : 'text-gray-800'}`}>
              {confirmModal.title}
            </h2>
            <p className="text-gray-600 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={closeConfirm}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                className={`text-white px-4 py-2 rounded ${
                  confirmModal.type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 
                  confirmModal.type === 'warning' ? 'bg-amber-600 hover:bg-amber-700' : 
                  'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Split Asset Modal */}
      {splitModal.isOpen && splitModal.asset && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-[100]">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md mx-4">
            <h2 className="text-xl font-bold mb-2">Split / Report Faulty</h2>
            <p className="text-sm text-gray-500 mb-4">
              Splitting from: <strong>{splitModal.asset.name}</strong> (Qty: {splitModal.asset.quantity})
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Quantity to Split</label>
                <input
                  type="number"
                  min="1"
                  max={splitModal.asset.quantity - 1}
                  value={splitModal.quantity}
                  onChange={(e) => setSplitModal(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
                <p className="text-xs text-gray-500 mt-1">Remaining quantity will be: {splitModal.asset.quantity - splitModal.quantity}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">New Status</label>
                <select
                  value={splitModal.status}
                  onChange={(e) => setSplitModal(prev => ({ ...prev, status: e.target.value }))}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="Faulty">Faulty</option>
                  <option value="Under Repair">Under Repair</option>
                  <option value="Disposed">Disposed</option>
                  <option value="Spare">Spare</option>
                  <option value="In Use">In Use</option>
                  <option value="Missing">Missing</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">New Condition</label>
                <select
                  value={splitModal.condition}
                  onChange={(e) => setSplitModal(prev => ({ ...prev, condition: e.target.value }))}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="Faulty">Faulty</option>
                  <option value="Used">Used</option>
                  <option value="Repaired">Repaired</option>
                  <option value="Under Repair">Under Repair</option>
                  <option value="New">New</option>
                  <option value="Disposed">Disposed</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setSplitModal(prev => ({ ...prev, isOpen: false }))}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSplitSubmit}
                disabled={splitModal.quantity >= splitModal.asset.quantity || splitModal.quantity < 1}
                className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 disabled:opacity-50"
              >
                Split Asset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Assets;
