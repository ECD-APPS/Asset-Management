import { useState, useEffect } from 'react';
import { X, Upload, FileSpreadsheet, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import api from '../api/axios';

const ImportAssetsModal = ({ isOpen, onClose, onSuccess, source }) => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [stores, setStores] = useState([]);
  const [locationId, setLocationId] = useState('');

  if (!isOpen) return null;

  useEffect(() => {
    const loadStores = async () => {
      try {
        const res = await api.get('/stores');
        setStores(res.data || []);
      } catch (err) {
        // silent
      }
    };
    loadStores();
  }, []);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setError('');
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/assets/template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'Asset_Import_Template.xlsx');
      document.body.appendChild(link);
      link.click();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to download template');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('allowDuplicates', allowDuplicates);
    if (source) formData.append('source', source);
    if (locationId) {
      const loc = stores.find(s => s._id === locationId);
      if (loc) formData.append('location', loc.name);
    }

    setLoading(true);
    try {
      const res = await api.post('/assets/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      alert(res.data.message || 'Assets imported successfully');
      onSuccess && onSuccess();
      onClose();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Error importing assets');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-green-600" />
            Import Assets
          </h2>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-700">
            <p className="font-semibold mb-1">Instructions:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Upload an Excel file (.xlsx, .xls)</li>
              <li>Ensure columns match the template</li>
              <li>Duplicates will be skipped unless checked</li>
              <li>Optional: Select Location to apply to all rows</li>
            </ul>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Location (Optional)</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              >
                <option value="">All Locations (from Excel)</option>
                {stores.filter(s => s.parentStore).map(s => (
                  <option key={s._id} value={s._id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-between items-center">
              <label className="block text-sm font-medium text-gray-700">Select File</label>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium"
              >
                <Download className="w-4 h-4" />
                Download Template
              </button>
            </div>
            
            <div className="relative">
              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2.5 file:px-4
                  file:rounded-lg file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100
                  cursor-pointer border border-gray-200 rounded-lg"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="allowDuplicates"
                checked={allowDuplicates}
                onChange={(e) => setAllowDuplicates(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-500 border-gray-300 w-4 h-4"
              />
              <label htmlFor="allowDuplicates" className="text-sm text-gray-700">
                Allow Duplicate Serial Numbers
              </label>
            </div>

            {error && (
              <div className="text-red-500 text-sm bg-red-50 p-3 rounded-lg border border-red-100 flex items-start gap-2">
                <span className="mt-0.5">⚠️</span>
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !file}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors
              ${loading || !file 
                ? 'bg-blue-400 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700 shadow-sm'}`}
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Import Assets
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportAssetsModal;
