import { useState, useEffect } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { Plus, Edit, Trash2, Eye, Printer, Paperclip, Download, FileSpreadsheet } from 'lucide-react';

const asArray = (value) => (Array.isArray(value) ? value : []);
const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const formatMoney = (value) => asNumber(value, 0).toFixed(2);
const dateInputValue = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().split('T')[0];
};

const PurchaseOrders = ({ onImportClick, headerActions }) => {
  const { user } = useAuth();
  const [pos, setPos] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [view, setView] = useState('list'); // list, form
  const [loading, setLoading] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    poNumber: '',
    vendor: '',
    orderDate: new Date().toISOString().split('T')[0],
    deliveryDate: '',
    items: [],
    subtotal: 0,
    taxTotal: 0,
    grandTotal: 0,
    notes: '',
    status: 'Draft',
    attachments: [] // For new files
  });
  const [existingAttachments, setExistingAttachments] = useState([]); // For display
  const [editingId, setEditingId] = useState(null);
  const [passwordPrompt, setPasswordPrompt] = useState({ show: false, action: null, targetId: null, password: '' });

  // Vendor Details for Auto-fill
  const [selectedVendorDetails, setSelectedVendorDetails] = useState(null);

  useEffect(() => {
    fetchPOs();
    fetchVendors();
  }, []);

  const fetchPOs = async () => {
    try {
      const res = await api.get('/purchase-orders');
      setPos(asArray(res.data));
    } catch (err) {
      console.error(err);
    }
  };

  const fetchVendors = async () => {
    try {
      const res = await api.get('/vendors');
      setVendors(asArray(res.data).filter(v => v.status === 'Active'));
    } catch (err) {
      console.error(err);
    }
  };

  const handleVendorChange = (e) => {
    const vendorId = e.target.value;
    const vendor = vendors.find(v => v._id === vendorId);
    setFormData({ ...formData, vendor: vendorId });
    setSelectedVendorDetails(vendor);
  };

  const handleItemChange = (index, field, value) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    
    // Recalculate item total
    if (field === 'quantity' || field === 'rate' || field === 'tax') {
      const qty = parseFloat(newItems[index].quantity) || 0;
      const rate = parseFloat(newItems[index].rate) || 0;
      const tax = parseFloat(newItems[index].tax) || 0;
      newItems[index].total = (qty * rate) + tax;
    }
    
    setFormData({ ...formData, items: newItems });
  };

  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { itemName: '', quantity: 1, rate: 0, tax: 0, total: 0 }]
    });
  };

  const removeItem = (index) => {
    const newItems = formData.items.filter((_, i) => i !== index);
    setFormData({ ...formData, items: newItems });
  };

  // Calculate Totals Effect
  useEffect(() => {
    const sub = formData.items.reduce((acc, item) => acc + (parseFloat(item.quantity || 0) * parseFloat(item.rate || 0)), 0);
    const tax = formData.items.reduce((acc, item) => acc + parseFloat(item.tax || 0), 0);
    const grand = sub + tax;

    setFormData(prev => ({
      ...prev,
      subtotal: sub,
      taxTotal: tax,
      grandTotal: grand
    }));
  }, [formData.items]);

  const handleFileChange = (e) => {
    setFormData({ ...formData, attachments: Array.from(e.target.files) });
  };

  const executeSubmit = async () => {
    try {
      setLoading(true);
      
      const data = new FormData();
      data.append('poNumber', formData.poNumber || '');
      data.append('vendor', formData.vendor);
      data.append('orderDate', formData.orderDate);
      data.append('deliveryDate', formData.deliveryDate || '');
      data.append('items', JSON.stringify(formData.items));
      data.append('subtotal', formData.subtotal);
      data.append('taxTotal', formData.taxTotal);
      data.append('grandTotal', formData.grandTotal);
      data.append('notes', formData.notes || '');
      data.append('status', formData.status);

      if (formData.attachments) {
        formData.attachments.forEach(file => {
          data.append('attachments', file);
        });
      }

      if (editingId) {
        await api.put(`/purchase-orders/${editingId}`, data);
      } else {
        await api.post('/purchase-orders', data);
      }
      fetchPOs();
      setView('list');
      resetForm();
    } catch (err) {
      alert(err.response?.data?.message || 'Error saving PO');
    } finally {
      setLoading(false);
    }
  };

  const executeDelete = async (id) => {
    try {
      await api.delete(`/purchase-orders/${id}`);
      fetchPOs();
    } catch (err) {
      alert(err.response?.data?.message || 'Error deleting PO');
    }
  };

  const handlePasswordVerify = async (e) => {
    e.preventDefault();
    try {
      await api.post('/auth/verify-password', { password: passwordPrompt.password });
      
      if (passwordPrompt.action === 'edit') {
        await executeSubmit();
      } else if (passwordPrompt.action === 'delete') {
        await executeDelete(passwordPrompt.targetId);
      }
      
      setPasswordPrompt({ show: false, action: null, targetId: null, password: '' });
    } catch (err) {
      console.error(err);
      alert('Incorrect password');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.items.length === 0) {
      alert('Please add at least one item');
      return;
    }

    if (editingId) {
        setPasswordPrompt({ show: true, action: 'edit', targetId: null, password: '' });
    } else {
        await executeSubmit();
    }
  };

  const handleEdit = (po) => {
    setFormData({
      poNumber: po.poNumber || '',
      vendor: po.vendor?._id || po.vendor || '',
      orderDate: dateInputValue(po.orderDate),
      deliveryDate: dateInputValue(po.deliveryDate),
      items: asArray(po.items).map((item = {}) => ({
        itemName: item.itemName || '',
        quantity: asNumber(item.quantity, 1),
        rate: asNumber(item.rate, 0),
        tax: asNumber(item.tax, 0),
        total: asNumber(item.total, 0)
      })),
      subtotal: asNumber(po.subtotal, 0),
      taxTotal: asNumber(po.taxTotal, 0),
      grandTotal: asNumber(po.grandTotal, 0),
      notes: po.notes || '',
      status: po.status || 'Draft'
    });
    setExistingAttachments(po.attachments || []);
    setSelectedVendorDetails(po.vendor || null);
    setEditingId(po._id);
    setView('form');
  };

  const handleDelete = async (id) => {
    setPasswordPrompt({ show: true, action: 'delete', targetId: id, password: '' });
  };

  const resetForm = () => {
    setFormData({
      poNumber: '',
      vendor: '',
      orderDate: new Date().toISOString().split('T')[0],
      deliveryDate: '',
      items: [],
      subtotal: 0,
      taxTotal: 0,
      grandTotal: 0,
      notes: '',
      status: 'Draft',
      attachments: []
    });
    setExistingAttachments([]);
    setEditingId(null);
    setSelectedVendorDetails(null);
  };

  const exportPOs = async () => {
    try {
      const response = await api.get('/purchase-orders/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'purchase_orders.xlsx');
      document.body.appendChild(link);
      link.click();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to export POs');
    }
  };

  const downloadPOTemplate = async () => {
    try {
      const response = await api.get('/purchase-orders/template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'purchase_orders_template.xlsx');
      document.body.appendChild(link);
      link.click();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to download PO template');
    }
  };

  const passwordModal = passwordPrompt.show && (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded shadow-lg w-96">
        <h3 className="text-lg font-bold mb-4">Admin Verification</h3>
        <p className="mb-4 text-sm text-gray-600">Please enter your password to confirm this action.</p>
        <form onSubmit={handlePasswordVerify}>
          <input
            type="password"
            value={passwordPrompt.password}
            onChange={(e) => setPasswordPrompt({ ...passwordPrompt, password: e.target.value })}
            className="w-full border border-gray-300 rounded p-2 mb-4"
            placeholder="Password"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPasswordPrompt({ show: false, action: null, targetId: null, password: '' })}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
            >
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (view === 'form') {
    const isReadOnly = user?.role === 'Viewer';
    return (
      <div className="container mx-auto p-4 max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">{editingId ? (isReadOnly ? 'View Purchase Order' : 'Edit Purchase Order') : 'New Purchase Order'}</h1>
          <button
            onClick={() => { setView('list'); resetForm(); }}
            className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
          >
            Back to List
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bg-white p-6 rounded shadow-lg space-y-6">
          <fieldset disabled={isReadOnly} className="contents">
          {/* Header Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">PO Number (Optional)</label>
              <input
                type="text"
                value={formData.poNumber}
                onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                placeholder="Auto-generated if empty"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Vendor</label>
              <select
                required
                value={formData.vendor}
                onChange={handleVendorChange}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              >
                <option value="">Select Vendor</option>
                {vendors.map(v => (
                  <option key={v._id} value={v._id}>{v.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Order Date</label>
              <input
                type="date"
                required
                value={formData.orderDate}
                onChange={(e) => setFormData({ ...formData, orderDate: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Delivery Date</label>
              <input
                type="date"
                value={formData.deliveryDate}
                onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              />
            </div>
          </div>

          {/* Vendor Details Display */}
          {selectedVendorDetails && (
            <div className="bg-gray-50 p-4 rounded text-sm text-gray-600 grid grid-cols-2 gap-4">
              <div>
                <span className="font-semibold">Address:</span> {selectedVendorDetails.address || 'N/A'}
              </div>
              <div>
                <span className="font-semibold">Payment Terms:</span> {selectedVendorDetails.paymentTerms || 'N/A'}
              </div>
              <div>
                <span className="font-semibold">Tax ID:</span> {selectedVendorDetails.taxId || 'N/A'}
              </div>
            </div>
          )}

          {/* Items Table */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-medium">Items</h3>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={addItem}
                  className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                >
                  + Add Item
                </button>
              )}
            </div>
            <table className="min-w-full divide-y divide-gray-200 border">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Qty</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">Rate</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">Tax</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">Total</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {formData.items.map((item, index) => (
                  <tr key={index}>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        required
                        value={item.itemName}
                        onChange={(e) => handleItemChange(index, 'itemName', e.target.value)}
                        className="w-full border-gray-300 rounded-md shadow-sm p-1 text-sm border"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min="1"
                        required
                        value={item.quantity}
                        onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                        className="w-full border-gray-300 rounded-md shadow-sm p-1 text-sm border"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={item.rate}
                        onChange={(e) => handleItemChange(index, 'rate', e.target.value)}
                        className="w-full border-gray-300 rounded-md shadow-sm p-1 text-sm border"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.tax}
                        onChange={(e) => handleItemChange(index, 'tax', e.target.value)}
                        className="w-full border-gray-300 rounded-md shadow-sm p-1 text-sm border"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {formatMoney(item.total)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {!isReadOnly && (
                        <button type="button" onClick={() => removeItem(index)} className="text-red-500 hover:text-red-700">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Attachments */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Attachments (Slips, Bills, Hardcopies)</label>
            <div className="border border-gray-300 rounded-md p-4">
              {!isReadOnly && (
                <input
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100"
                />
              )}
              
              {/* Existing Attachments */}
              {existingAttachments.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Attached Files:</h4>
                  <ul className="space-y-1">
                    {existingAttachments.map((file, idx) => (
                      <li key={idx} className="flex items-center gap-2 text-sm text-blue-600">
                        <Paperclip size={16} />
                        <a href={`${file}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          View File {idx + 1}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Totals & Notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                rows="4"
              />
            </div>
            <div className="bg-gray-50 p-4 rounded space-y-2">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatMoney(formData.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax Total:</span>
                <span>{formatMoney(formData.taxTotal)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t pt-2 border-gray-300">
                <span>Grand Total:</span>
                <span>{formatMoney(formData.grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Status & Actions */}
          <div className="flex justify-between items-center pt-4 border-t">
             <div className="w-1/3">
              <label className="block text-sm font-medium text-gray-700">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                disabled={isReadOnly}
              >
                <option value="Draft">Draft</option>
                <option value="Submitted">Submitted</option>
                <option value="Approved">Approved</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
            <div className="space-x-3">
              <button
                type="button"
                onClick={() => { setView('list'); resetForm(); }}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
              >
                {isReadOnly ? 'Close' : 'Cancel'}
              </button>
              {!isReadOnly && (
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-amber-600 text-white px-6 py-2 rounded hover:bg-amber-700 disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save Purchase Order'}
                </button>
              )}
            </div>
          </div>
          </fieldset>
        </form>
        {passwordModal}
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Purchase Orders</h1>
        <div className="flex gap-2">
          {headerActions}
          {onImportClick && user?.role !== 'Viewer' && (
            <button
              onClick={onImportClick}
              className="bg-green-600 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-green-700 shadow-sm transition-all"
            >
              <FileSpreadsheet size={20} /> Import Assets
            </button>
          )}
          <button
            onClick={exportPOs}
            className="bg-green-600 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-green-700 shadow-sm transition-all"
          >
            <Download size={20} /> Export POs
          </button>
          {user?.role !== 'Viewer' && (
            <>
              <button
                onClick={downloadPOTemplate}
                className="bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded flex items-center gap-2 shadow-sm transition-all"
              >
                <FileSpreadsheet size={20} /> PO Template
              </button>
              <button
                onClick={() => { resetForm(); setView('form'); }}
                className="bg-amber-600 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-amber-700 shadow-sm transition-all"
              >
                <Plus size={20} /> New PO
              </button>
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PO Number</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vendor</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {asArray(pos).map((po) => (
              <tr key={po._id}>
                <td className="px-6 py-4 whitespace-nowrap font-medium text-indigo-600">
                  <div className="flex items-center gap-2">
                    {po.poNumber}
                    {po.attachments && po.attachments.length > 0 && (
                      <Paperclip size={16} className="text-gray-500" title={`${po.attachments.length} attachment(s)`} />
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">{po.vendor?.name || 'Unknown'}</td>
                <td className="px-6 py-4 whitespace-nowrap">{new Date(po.orderDate).toLocaleDateString()}</td>
                <td className="px-6 py-4 whitespace-nowrap font-bold">{formatMoney(po.grandTotal)}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    po.status === 'Approved' ? 'bg-green-100 text-green-800' : 
                    po.status === 'Draft' ? 'bg-gray-100 text-gray-800' :
                    po.status === 'Submitted' ? 'bg-blue-100 text-blue-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {po.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  {user?.role !== 'Viewer' ? (
                    <>
                      <button onClick={() => handleEdit(po)} className="text-indigo-600 hover:text-indigo-900 mr-4" title="Edit/View">
                        <Edit size={18} />
                      </button>
                      <button onClick={() => handleDelete(po._id)} className="text-red-600 hover:text-red-900" title="Delete">
                        <Trash2 size={18} />
                      </button>
                    </>
                  ) : (
                    <button onClick={() => handleEdit(po)} className="text-indigo-600 hover:text-indigo-900" title="View">
                      <Eye size={18} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {passwordModal}
    </div>
  );
};

export default PurchaseOrders;
