import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import api from '../api/axios';
import { ArrowLeft, Activity, User, AlertCircle } from 'lucide-react';

/** `back` query must stay in-app (relative path) and match the list the user came from. */
const sanitizeListBackHref = (rawEncoded, kind) => {
  if (!rawEncoded || typeof rawEncoded !== 'string') return null;
  let s;
  try {
    s = decodeURIComponent(rawEncoded);
  } catch {
    return null;
  }
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  if (s.includes('://')) return null;
  if (kind === 'assets' && /^\/assets(\/|\?|$)/.test(s)) return s;
  if (kind === 'ppm' && /^\/ppm(\/|\?|$)/.test(s)) return s;
  return null;
};

const AssetHistory = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.get(`/assets/${id}`);
        setAsset(res.data);
      } catch {
        setError('Failed to load asset');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [id]);

  const sortedHistory = Array.isArray(asset?.history)
    ? [...asset.history].sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt))
    : [];

  const from = searchParams.get('from');
  const rawBack = searchParams.get('back');
  const { backHref, backLabel } = useMemo(() => {
    if (from === 'assets') {
      return {
        backHref: sanitizeListBackHref(rawBack, 'assets') || '/assets',
        backLabel: 'All Assets'
      };
    }
    if (from === 'ppm') {
      return {
        backHref: sanitizeListBackHref(rawBack, 'ppm') || '/ppm',
        backLabel: 'PPM Asset'
      };
    }
    return { backHref: '/ppm', backLabel: 'PPM Asset' };
  }, [from, rawBack]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <Link to={backHref} className="inline-flex items-center text-gray-500 hover:text-blue-600 transition-colors gap-2">
          <ArrowLeft size={18} />
          {backLabel}
        </Link>
        <div className="text-sm text-gray-500">
          {asset ? `Last updated: ${asset.updatedAt ? new Date(asset.updatedAt).toLocaleString() : '-'}` : ''}
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-500">Loading...</div>
      ) : error ? (
        <div className="text-center text-red-600">{error}</div>
      ) : !asset ? (
        <div className="text-center text-gray-500">Asset not found</div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="text-xs text-gray-500">Unique ID</div>
                <div className="text-2xl font-bold">{asset.uniqueId || 'N/A'}</div>
                <div className="text-gray-500">{asset.product_name || '-'}</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-gray-500">Name</div>
                  <div className="font-semibold">{asset.name || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Model</div>
                  <div className="font-semibold">{asset.model_number || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Serial</div>
                  <div className="font-mono font-semibold">{asset.serial_number || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Serial Last 4</div>
                  <div className="font-semibold">{asset.serial_last_4 || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">MAC</div>
                  <div className="font-semibold">{asset.mac_address || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">RFID</div>
                  <div className="font-semibold">{asset.rfid || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">QR</div>
                  <div className="font-semibold">{asset.qr_code || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Manufacturer</div>
                  <div className="font-semibold">{asset.manufacturer || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Status</div>
                  <div className="font-semibold">{asset.status || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Previous Status</div>
                  <div className="font-semibold">{asset.previous_status || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Condition</div>
                  <div className="font-semibold">{asset.condition || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Quantity</div>
                  <div className="font-semibold">{asset.quantity ?? 1}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">PO Number</div>
                  <div className="font-semibold">{asset.po_number || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Price</div>
                  <div className="font-semibold">{typeof asset.price === 'number' ? `${asset.price.toFixed(2)} AED` : '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Date of Purchase</div>
                  <div className="font-semibold">{asset.createdAt ? new Date(asset.createdAt).toLocaleDateString() : '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Vendor Name</div>
                  <div className="font-semibold">{asset.vendor_name || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Source</div>
                  <div className="font-semibold">{asset.source || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Ticket Number</div>
                  <div className="font-semibold">{asset.ticket_number || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Delivered By</div>
                  <div className="font-semibold">{asset.delivered_by_name || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Delivered At</div>
                  <div className="font-semibold">{asset.delivered_at ? new Date(asset.delivered_at).toLocaleString() : '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Store</div>
                  <div className="font-semibold">{asset.store?.parentStore?.name || asset.store?.name || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Location</div>
                  <div className="font-semibold">{asset.location || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Assigned To</div>
                  <div className="font-semibold">{asset.assigned_to?.name || asset.assigned_to_external?.name || '-'}</div>
                </div>
                {asset.assigned_to_external && asset.assigned_to_external.name && (
                  <>
                    <div>
                      <div className="text-xs text-gray-500">Assignee Phone</div>
                      <div className="font-semibold">{asset.assigned_to_external.phone || '-'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Assignee Note</div>
                      <div className="font-semibold">{asset.assigned_to_external.note || '-'}</div>
                    </div>
                  </>
                )}
                {asset.return_pending && asset.return_request && (
                  <div className="col-span-2 md:col-span-4 bg-yellow-50 p-3 rounded border border-yellow-200">
                     <div className="text-xs font-bold text-yellow-800 mb-1">Return Pending</div>
                     <div className="text-sm">
                       <span className="font-semibold">Condition:</span> {asset.return_request.condition || '-'} | <span className="font-semibold">Ticket:</span> {asset.return_request.ticket_number || '-'} | <span className="font-semibold">By:</span> {asset.return_request.requested_by?.name || '-'}
                       <div className="mt-1"><span className="font-semibold">Notes:</span> {asset.return_request.notes || '-'}</div>
                     </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">History</h2>
              <span className="text-xs text-gray-500">{sortedHistory.length} events</span>
            </div>
            <div className="space-y-4">
              {sortedHistory.length === 0 ? (
                <div className="text-center text-gray-500">No history records found.</div>
              ) : (
                sortedHistory.map((event, idx) => (
                  <div key={idx} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 z-10">
                        <Activity size={14} />
                      </div>
                      {idx < sortedHistory.length - 1 && <div className="w-0.5 h-full bg-gray-100 -my-1"></div>}
                    </div>
                    <div className="flex-1 pb-6">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-semibold text-gray-900">{event.action}</span>
                        <span className="text-xs text-gray-400 whitespace-nowrap">{new Date(event.date || event.createdAt || Date.now()).toLocaleString()}</span>
                      </div>
                      <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100">
                        <div className="grid grid-cols-2 gap-2">
                          {event.user && (
                            <div className="flex items-center gap-2">
                              <User size={12} className="text-gray-400" />
                              <span>By: {event.user}</span>
                            </div>
                          )}
                          {event.actor_role && (
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">Role: {event.actor_role}</span>
                            </div>
                          )}
                          {event.ticket_number && (
                            <div className="flex items-center gap-2">
                              <AlertCircle size={12} className="text-gray-400" />
                              <span>Ticket: {event.ticket_number}</span>
                            </div>
                          )}
                          {(event.previous_status || event.status) && (
                            <div className="flex items-center gap-2">
                              <span>Status: {event.previous_status || '-'} {'->'} {event.status || '-'}</span>
                            </div>
                          )}
                          {(event.previous_condition || event.condition) && (
                            <div className="flex items-center gap-2">
                              <span>Condition: {event.previous_condition || '-'} {'->'} {event.condition || '-'}</span>
                            </div>
                          )}
                          {(event.location || event.store_name) && (
                            <div className="flex items-center gap-2 col-span-2">
                              <span>Where: {[event.location, event.store_name].filter(Boolean).join(' | ')}</span>
                            </div>
                          )}
                        </div>
                        {event.details && (
                          <div className="mt-2 pt-2 border-t border-gray-200/50 text-gray-500">
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
        </>
      )}
    </div>
  );
};

export default AssetHistory;
