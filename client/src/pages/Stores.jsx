import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const Stores = () => {
  const { activeStore, user } = useAuth();
  const navigate = useNavigate();
  const pageSize = 50;
  const [stores, setStores] = useState([]);
  const [newName, setNewName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');

  const fetchStores = useCallback(async () => {
    if (!activeStore?._id) return;
    try {
      setLoading(true);
      const params = new URLSearchParams({
        parent: activeStore._id,
        includeAssetTotals: 'true',
        page: String(page),
        limit: String(pageSize)
      });
      if (debouncedSearch.trim()) {
        params.set('q', debouncedSearch.trim());
      }
      const res = await api.get(`/stores?${params.toString()}`);
      const items = Array.isArray(res.data) ? res.data : (res.data?.items || []);
      const pagination = res.data?.pagination;
      setStores(items);
      setTotalPages(Math.max(1, pagination?.totalPages || 1));
      setTotalItems(Number(pagination?.total || items.length || 0));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [activeStore, debouncedSearch, page]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    if (activeStore) {
      fetchStores();
    }
  }, [activeStore, fetchStores]);

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      await api.post('/stores', { 
        name: newName
      });
      setNewName('');
      setPage(1);
      fetchStores();
    } catch (err) {
      alert(err.response?.data?.message || 'Error adding store');
    }
  };

  const handleDelete = async (id) => {
    if(!window.confirm('Are you sure?')) return;
    try {
      await api.delete(`/stores/${id}`);
      fetchStores();
    } catch (err) {
      alert(err.response?.data?.message || 'Error deleting store');
    }
  };
  
  const startEdit = (store) => {
    setEditingId(store._id);
    setEditingName(store.name);
  };
  
  const cancelEdit = () => {
    setEditingId('');
    setEditingName('');
  };
  
  const saveEdit = async () => {
    try {
      await api.put(`/stores/${editingId}`, { 
        name: editingName
      });
      cancelEdit();
      fetchStores();
    } catch (err) {
      alert(err.response?.data?.message || 'Error updating store');
    }
  };

  const openAssetsForLocation = (store) => {
    if (!store?._id) return;
    const params = new URLSearchParams();
    params.set('store', store._id);
    if (store.name) params.set('location', store.name);
    navigate(`/assets?${params.toString()}`);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Locations</h1>
      
      <div className="bg-white p-4 rounded shadow mb-6">
        <input
          type="text"
          placeholder="Search locations"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="border p-2 rounded w-full"
        />
      </div>
      
      {user?.role !== 'Viewer' && (
      <form onSubmit={handleAdd} className="mb-8 flex flex-wrap gap-4 items-end bg-white p-4 rounded shadow">
        <div>
          <label className="block text-sm font-medium text-gray-700">Location Name</label>
          <input 
            type="text" 
            value={newName} 
            onChange={(e) => setNewName(e.target.value)} 
            placeholder="Location Name" 
            className="border p-2 rounded w-64"
            required
          />
        </div>
        <button type="submit" className="bg-amber-600 hover:bg-amber-700 text-black px-4 py-2 rounded h-10">Add Location</button>
      </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stores.filter(s => {
          if (!searchTerm.trim()) return true;
          return (s.name || '').toLowerCase().includes(searchTerm.toLowerCase());
        }).map(store => {
          return (
            <div
              key={store._id}
              className="bg-white p-4 rounded shadow transition hover:shadow-md cursor-pointer"
              onClick={() => {
                if (editingId !== store._id) openAssetsForLocation(store);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && editingId !== store._id) {
                  e.preventDefault();
                  openAssetsForLocation(store);
                }
              }}
            >
              {editingId === store._id ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="border p-2 rounded"
                  />
                  <div className="flex gap-2 justify-end mt-2">
                    <button onClick={(e) => { e.stopPropagation(); saveEdit(); }} className="bg-green-600 text-white px-3 py-1 rounded text-sm">Save</button>
                    <button onClick={(e) => { e.stopPropagation(); cancelEdit(); }} className="bg-gray-500 text-white px-3 py-1 rounded text-sm">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-bold text-lg">{store.name}</span>
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    Total available at location: <span className="font-semibold">{store.availableAssetCount ?? 0}</span>
                  </div>
                  <div className="mt-2 text-xs text-indigo-600 font-medium">Click to view all assets in this location</div>
                  {user?.role !== 'Viewer' && (
                  <div className="flex gap-2 justify-end border-t pt-2">
                    <button onClick={(e) => { e.stopPropagation(); startEdit(store); }} className="text-amber-600 text-sm hover:underline">Edit</button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(store._id); }} className="text-red-500 text-sm hover:underline">Delete</button>
                  </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {loading && (
        <div className="text-sm text-gray-500 mt-4">Loading locations...</div>
      )}
      {!loading && stores.length === 0 && (
        <div className="text-sm text-gray-500 mt-4">No locations found.</div>
      )}
      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-gray-500">
          Showing {stores.length} of {totalItems} locations
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="px-3 py-1 border rounded text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">Page {page} / {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="px-3 py-1 border rounded text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default Stores;
