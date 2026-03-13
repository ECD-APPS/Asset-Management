import { useState, useEffect, useCallback } from 'react';
import { Search, Edit2, Trash2, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import PropTypes from 'prop-types';

const Products = ({ readOnly = false }) => {
  const { user } = useAuth();
  const isReadOnly = readOnly || user?.role === 'Viewer';
  
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [deletingProduct, setDeletingProduct] = useState(null);
  
  const [productName, setProductName] = useState('');
  const [productImage, setProductImage] = useState(null);
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [parentId, setParentId] = useState('');
  const [bulkNames, setBulkNames] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedAssets, setSelectedAssets] = useState([]);
  const [selectedAssetsPage, setSelectedAssetsPage] = useState(1);
  const [selectedAssetsTotal, setSelectedAssetsTotal] = useState(0);
  const [selectedAssetsLimit] = useState(5000);
  const [panelLoading, setPanelLoading] = useState(false);

  const fetchProducts = async () => {
    try {
      const res = await api.get('/products');
      setProducts(res.data || []);
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const resetForm = () => {
    setProductName('');
    setProductImage(null);
    setEditingProduct(null);
    setDeletingProduct(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingProduct) return;
    try {
      await api.delete(`/products/${deletingProduct._id}`);
      setShowDeleteModal(false);
      setDeletingProduct(null);
      fetchProducts();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete product');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanName = String(productName || '').trim().replace(/\s+/g, ' ');
    if (!cleanName) {
      alert('Product name is required.');
      return;
    }
    if (cleanName.length > 120) {
      alert('Product name is too long (max 120 characters).');
      return;
    }
    try {
      setSubmittingEdit(true);
      const formData = new FormData();
      formData.append('name', cleanName);
      if (productImage) {
        formData.append('image', productImage);
      }

      if (editingProduct) {
        await api.put(`/products/${editingProduct._id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      setShowEditModal(false);
      resetForm();
      fetchProducts();
    } catch (err) {
      alert(err.response?.data?.message || `Failed to update product`);
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxBytes = 10 * 1024 * 1024;
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/svg+xml',
      'image/bmp',
      'image/tiff'
    ];
    if (!allowedTypes.includes(file.type)) {
      alert('Invalid image format. Use JPG, PNG, WEBP, GIF, SVG, BMP, or TIFF.');
      e.target.value = '';
      return;
    }
    if (file.size > maxBytes) {
      alert('Image is too large. Maximum size is 10MB.');
      e.target.value = '';
      return;
    }
    setProductImage(file);
  };

  const flatten = (list, level = 0, ancestors = []) => {
    const out = [];
    (list || []).forEach(p => {
      const pathParts = [...ancestors, p.name];
      const fullPath = pathParts.join(' / ');
      out.push({ ...p, level, fullPath });
      if (p.children && p.children.length > 0) {
        out.push(...flatten(p.children, level + 1, pathParts));
      }
    });
    return out;
  };
  const flatProducts = flatten(products);
  const filteredProducts = flatProducts.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const loadAssetsFor = useCallback(async (product) => {
    setSelectedProduct(product);
    setPanelLoading(true);
    try {
      const res = await api.get('/assets', { params: { product_name: product.name, page: 1, limit: selectedAssetsLimit } });
      setSelectedAssets(res.data.items || []);
      setSelectedAssetsPage(1);
      setSelectedAssetsTotal(res.data.total || (res.data.items || []).length);
    } catch {
      setSelectedAssets([]);
      setSelectedAssetsPage(1);
      setSelectedAssetsTotal(0);
    } finally {
      setPanelLoading(false);
    }
  }, [selectedAssetsLimit]);

  const loadMoreAssetsForSelected = async () => {
    if (!selectedProduct) return;
    const nextPage = selectedAssetsPage + 1;
    setPanelLoading(true);
    try {
      const res = await api.get('/assets', { params: { product_name: selectedProduct.name, page: nextPage, limit: selectedAssetsLimit } });
      const items = res.data.items || [];
      setSelectedAssets(prev => [...prev, ...items]);
      setSelectedAssetsPage(nextPage);
      setSelectedAssetsTotal(res.data.total || selectedAssetsTotal);
    } catch (error) {
      console.error('Failed to load more assets for product:', error);
    }
    setPanelLoading(false);
  };

  useEffect(() => {
    if (!selectedProduct && filteredProducts.length > 0) {
      const firstLeaf = filteredProducts.find(p => !p.children || p.children.length === 0) || filteredProducts[0];
      loadAssetsFor(firstLeaf);
    }
  }, [filteredProducts, selectedProduct, loadAssetsFor]);

  const ProductModal = ({ title, onClose }) => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 transform transition-all scale-100">
        <h2 className="text-xl font-bold mb-4">{title}</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
            <input
              type="text"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g. Acc-G2"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Image</label>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.gif,.svg,.bmp,.tiff"
              onChange={handleImageChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">Recommended: Square image (1:1). Max 10MB.</p>
            {productImage && (
              <p className="text-xs text-green-700 mt-1">
                Selected: {productImage.name}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingEdit}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {submittingEdit ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  const DeleteModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 transform transition-all scale-100">
        <h2 className="text-xl font-bold mb-2 text-red-600">Delete Product?</h2>
        <p className="text-gray-600 mb-6">
          Are you sure you want to delete <strong>{deletingProduct?.name}</strong>? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setShowDeleteModal(false)}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleDeleteConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            {isReadOnly ? 'Products View' : 'Products Management'}
          </h1>
          <p className="text-sm text-gray-500">
            {isReadOnly 
              ? 'View all product categories and inventory statistics' 
              : 'Manage product images and view inventory statistics'}
          </p>
        </div>
        {!isReadOnly && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h2 className="font-semibold mb-2">Bulk Product Assignment</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-gray-600">Parent Product (optional)</label>
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="mt-1 w-full border p-2 rounded"
                >
                  <option value="">Root level</option>
                  {flatProducts.map(p => (
                    <option key={p._id} value={p._id}>
                      {p.fullPath}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600">Paste product names (one per line)</label>
                <textarea
                  value={bulkNames}
                  onChange={(e) => setBulkNames(e.target.value)}
                  className="mt-1 w-full border p-2 rounded h-24"
                  placeholder="Product A\nProduct B\nProduct C"
                />
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                onClick={async () => {
                  const names = bulkNames.split('\n').map(s => s.trim()).filter(Boolean);
                  if (names.length === 0) {
                    alert('No product names to add');
                    return;
                  }
                  try {
                    const res = await api.post('/products/bulk-create', { parentId: parentId || null, names });
                    alert(res.data?.message || 'Products created');
                    setBulkNames('');
                    fetchProducts();
                  } catch (err) {
                    alert(err.response?.data?.message || 'Bulk create failed');
                  }
                }}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Create Products
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mb-6 relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search products..."
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading...</div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-12 text-gray-500 bg-white rounded-xl shadow-sm border border-gray-100">
              {isReadOnly ? 'No products found.' : 'No products found. Use Bulk Product Assignment to add new products.'}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <ul className="divide-y">
                {filteredProducts.map((product) => (
                  <li 
                    key={product._id} 
                    className={`p-3 flex items-center justify-between hover:bg-gray-50 cursor-pointer ${selectedProduct && selectedProduct._id === product._id ? 'bg-gray-50' : ''}`}
                    onClick={() => loadAssetsFor(product)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">{product.level > 0 ? '└'.padStart(product.level + 1, ' ') : ''}</span>
                      <span className="font-medium">{product.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Link 
                        to={`/products/${encodeURIComponent(product.name)}`} 
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        View Details
                      </Link>
                      {!isReadOnly && (
                        <div className="flex gap-2">
                          <button 
                            onClick={(e) => { e.stopPropagation(); setEditingProduct(product); setProductName(product.name); setShowEditModal(true); }}
                            className="text-gray-500 hover:text-blue-600"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setDeletingProduct(product); setShowDeleteModal(true); }}
                            className="text-gray-500 hover:text-red-600"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800">Product Overview</h3>
              <span className="text-xs text-gray-500">{selectedProduct ? selectedProduct.name : 'Select a product'}</span>
            </div>
            {panelLoading ? (
              <div className="text-gray-500 text-sm py-6">Loading product stats...</div>
            ) : !selectedProduct ? (
              <div className="text-gray-500 text-sm py-6">Click a product to view stats and recent history.</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {(() => {
                    const getQty = (asset) => {
                      const q = Number(asset.quantity);
                      if (!Number.isFinite(q) || q <= 0) return 1;
                      return q;
                    };
                    const isAssigned = (a) => a.assigned_to || (a.assigned_to_external && a.assigned_to_external.name);
                    const isFaulty = (a) => String(a.condition).toLowerCase() === 'faulty';
                    const isRepaired = (a) => String(a.condition).toLowerCase() === 'repaired';
                    const isMissing = (a) => String(a.status).toLowerCase() === 'missing';
                    const isInUseStatus = (a) => String(a.status).toLowerCase() === 'in use';
                    const sumQty = (predicate) => selectedAssets.reduce((sum, asset) => {
                      if (predicate(asset)) return sum + getQty(asset);
                      return sum;
                    }, 0);
                    const total = selectedAssets.reduce((sum, asset) => sum + getQty(asset), 0);
                    const inUse = sumQty(a => !isMissing(a) && (isAssigned(a) || isInUseStatus(a)));
                    const inStore = sumQty(a => !isMissing(a) && !(isAssigned(a) || isInUseStatus(a)));
                    const faulty = sumQty(a => isFaulty(a));
                    const repaired = sumQty(a => isRepaired(a));
                    const missing = sumQty(a => isMissing(a));
                    return (
                      <>
                        <div className="rounded-lg border bg-white p-3">
                          <div className="text-xs text-gray-500">Total</div>
                          <div className="text-xl font-bold">{total}</div>
                        </div>
                        <div className="rounded-lg border bg-blue-50 p-3 border-blue-100">
                          <div className="text-xs text-blue-500">In Use</div>
                          <div className="text-xl font-bold text-blue-700">{inUse}</div>
                        </div>
                        <div className="rounded-lg border bg-green-50 p-3 border-green-100">
                          <div className="text-xs text-green-600">In Store</div>
                          <div className="text-xl font-bold text-green-700">{inStore}</div>
                        </div>
                        <div className="rounded-lg border bg-red-50 p-3 border-red-100">
                          <div className="text-xs text-red-600">Faulty</div>
                          <div className="text-xl font-bold text-red-700">{faulty}</div>
                        </div>
                        <div className="rounded-lg border bg-amber-50 p-3 border-amber-100">
                          <div className="text-xs text-amber-600">Repaired</div>
                          <div className="text-xl font-bold text-amber-700">{repaired}</div>
                        </div>
                        <div className="rounded-lg border bg-gray-50 p-3">
                          <div className="text-xs text-gray-600">Missing</div>
                          <div className="text-xl font-bold text-gray-700">{missing}</div>
                        </div>
                      </>
                    );
                  })()}
                </div>
                <div className="rounded-xl border bg-white p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm text-gray-600">
                      Showing {selectedAssets.length} of {selectedAssetsTotal} assets
                    </div>
                    {selectedAssets.length < selectedAssetsTotal && (
                      <button
                        onClick={loadMoreAssetsForSelected}
                        className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                      >
                        Load More
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-gray-800">Recent History</div>
                    <Link 
                      to={selectedProduct ? `/products/${encodeURIComponent(selectedProduct.name)}` : '#'} 
                      className="text-xs text-blue-600"
                    >
                      View All
                    </Link>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {selectedAssets
                      .flatMap(a => (a.history || []).map(h => ({ ...h, serial: a.serial_number, uniqueId: a.uniqueId })))
                      .sort((x, y) => new Date(y.date || y.createdAt || 0) - new Date(x.date || x.createdAt || 0))
                      .slice(0, 10)
                      .map((ev, idx) => (
                        <div key={idx} className="text-sm text-gray-700">
                          <div className="flex justify-between">
                            <span className="font-semibold">{ev.action}</span>
                            <span className="text-xs text-gray-400">{new Date(ev.date || ev.createdAt || Date.now()).toLocaleString()}</span>
                          </div>
                          <div className="text-xs text-gray-500">UID: {ev.uniqueId || 'N/A'} • SN: {ev.serial || 'N/A'}</div>
                        </div>
                      ))}
                    {selectedAssets.length === 0 && (
                      <div className="text-xs text-gray-500">No history available.</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {showEditModal && (
        <ProductModal 
          title="Edit Product" 
          onClose={() => setShowEditModal(false)} 
        />
      )}

      {showDeleteModal && <DeleteModal />}
    </div>
  );
};

Products.propTypes = {
  readOnly: PropTypes.bool
};

export default Products;
