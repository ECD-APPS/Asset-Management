import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import {
  buildAssignModalPrefsKey,
  mergeAssignModalSavedTogglesWithKey,
  persistAssignModalPrefsPatch
} from '../utils/assignModalPrefs';

const CcEmailSub = ({ emails, emptyMessage }) => {
  const list = Array.isArray(emails) ? emails.filter(Boolean) : [];
  if (!list.length) return <p className="ml-6 mt-0.5 text-xs text-amber-800">{emptyMessage}</p>;
  return <p className="ml-6 mt-0.5 break-words text-xs text-slate-600">{list.join(', ')}</p>;
};

const defaultAssignForm = (maxQty, defaultQty, defaultInstall) => ({
  technicianId: '',
  recipientEmail: '',
  recipientPhone: '',
  assignQuantity: Math.max(1, Math.min(defaultQty || 1, maxQty || 1)),
  installationLocation: defaultInstall || '',
  ticketNumber: '',
  needGatePass: false,
  sendGatePassEmail: false,
  gatePassOrigin: defaultInstall || '',
  gatePassDestination: '',
  gatePassJustification: '',
  notifyManager: false,
  notifyViewer: false,
  notifyAdmin: false
});

const defaultOtherRecipient = () => ({ name: '', email: '', phone: '', note: '' });

/**
 * Same recipient + gate-pass capture pattern as Assets "Assign Asset" (two-column layout).
 * Parent supplies technicians (GET /api/users) and handles API on submit.
 */
export default function AssignRecipientModal({
  open,
  onClose,
  title,
  resourceLine,
  technicians = [],
  showAssignQuantity = false,
  maxQuantity = 1,
  defaultQuantity = 1,
  defaultInstallationLocation = '',
  submitting = false,
  onSubmit,
  assignCcStoreId = ''
}) {
  const { user } = useAuth();
  const assignPrefsKey = useMemo(() => buildAssignModalPrefsKey(user), [user]);
  const persistAssignPrefs = useCallback(
    (patch) => persistAssignModalPrefsPatch(assignPrefsKey, patch),
    [assignPrefsKey]
  );

  const [recipientType, setRecipientType] = useState('Technician');
  const [assignForm, setAssignForm] = useState(() => defaultAssignForm(1, 1, ''));
  const [otherRecipient, setOtherRecipient] = useState(defaultOtherRecipient);
  const [techSearch, setTechSearch] = useState('');
  const [showTechSuggestions, setShowTechSuggestions] = useState(false);
  const [installError, setInstallError] = useState('');
  const [ccPreview, setCcPreview] = useState(null);
  const [ccPreviewLoading, setCcPreviewLoading] = useState(false);

  const maxQ = Math.max(1, Number(maxQuantity) || 1);

  useEffect(() => {
    if (!open) return;
    setRecipientType('Technician');
    setAssignForm(
      mergeAssignModalSavedTogglesWithKey(
        assignPrefsKey,
        defaultAssignForm(maxQ, defaultQuantity, defaultInstallationLocation)
      )
    );
    setOtherRecipient(defaultOtherRecipient());
    setTechSearch('');
    setShowTechSuggestions(false);
    setInstallError('');
  }, [open, maxQ, defaultQuantity, defaultInstallationLocation, assignPrefsKey]);

  useEffect(() => {
    if (!open || !assignCcStoreId) {
      setCcPreview(null);
      setCcPreviewLoading(false);
      return undefined;
    }
    let cancelled = false;
    setCcPreviewLoading(true);
    (async () => {
      try {
        const { data } = await api.get(`/stores/${assignCcStoreId}/assign-cc-preview`);
        if (!cancelled) setCcPreview(data);
      } catch {
        if (!cancelled) setCcPreview(null);
      } finally {
        if (!cancelled) setCcPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, assignCcStoreId]);

  if (!open) return null;

  const validateAndBuildPayload = () => {
    if (recipientType === 'Technician' && !assignForm.technicianId) {
      alert('Please select a technician.');
      return null;
    }
    if (recipientType === 'Technician' && !String(assignForm.recipientEmail || '').trim()) {
      alert('Please enter recipient email.');
      return null;
    }
    if (recipientType === 'Technician' && !String(assignForm.installationLocation || '').trim()) {
      setInstallError('Installation location is required for technician assignment.');
      alert('Please enter installation location for technician assignment.');
      return null;
    }
    setInstallError('');
    if (recipientType === 'Other') {
      if (!otherRecipient.name?.trim()) {
        alert('Please enter recipient name.');
        return null;
      }
      if (!otherRecipient.email?.trim()) {
        alert('Please enter recipient email.');
        return null;
      }
    }
    if (assignForm.needGatePass) {
      if (!assignForm.ticketNumber?.trim()) {
        alert('Ticket number is required when gate pass is enabled.');
        return null;
      }
      if (!assignForm.gatePassOrigin?.trim() || !assignForm.gatePassDestination?.trim()) {
        alert('Please fill gate pass "Moving From" and "Moving To".');
        return null;
      }
      if (recipientType === 'Other' && !otherRecipient.phone?.trim()) {
        alert('Recipient phone is required for external gate pass.');
        return null;
      }
    }
    if (recipientType === 'Technician' && assignForm.needGatePass && !String(assignForm.recipientPhone || '').trim()) {
      alert('Recipient phone is required for gate pass when assigning to a technician.');
      return null;
    }
    let qty = 1;
    if (showAssignQuantity) {
      qty = Number.parseInt(assignForm.assignQuantity, 10);
      if (!Number.isFinite(qty) || qty < 1 || qty > maxQ) {
        alert(`Assign quantity must be between 1 and ${maxQ}.`);
        return null;
      }
    }

    return {
      recipientType,
      technicianId: assignForm.technicianId,
      otherRecipient,
      assignQuantity: qty,
      recipientEmail: assignForm.recipientEmail,
      recipientPhone: assignForm.recipientPhone,
      installationLocation: assignForm.installationLocation,
      needGatePass: Boolean(assignForm.needGatePass),
      sendGatePassEmail: Boolean(assignForm.needGatePass && assignForm.sendGatePassEmail),
      gatePassOrigin: assignForm.gatePassOrigin,
      gatePassDestination: assignForm.gatePassDestination,
      gatePassJustification: assignForm.gatePassJustification,
      ticketNumber: assignForm.ticketNumber,
      notifyManager: Boolean(assignForm.notifyManager),
      notifyViewer: Boolean(assignForm.notifyViewer),
      notifyAdmin: Boolean(assignForm.notifyAdmin)
    };
  };

  const handleSubmit = async () => {
    const payload = validateAndBuildPayload();
    if (!payload) return;
    await onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-600/50 p-3 sm:p-4">
      <div
        role="dialog"
        aria-labelledby="assign-resource-title"
        className="flex max-h-[min(92vh,56rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="shrink-0 border-b border-gray-200 px-5 py-4">
          <h2 id="assign-resource-title" className="text-xl font-bold text-gray-900">
            {title}
          </h2>
          {resourceLine ? <p className="mt-1 text-sm text-gray-600">{resourceLine}</p> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-x-10 lg:items-start">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Recipient Type</label>
                <div className="mt-1 flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="assignRecipientType"
                      checked={recipientType === 'Technician'}
                      onChange={() => setRecipientType('Technician')}
                    />
                    Technician
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="assignRecipientType"
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
                      setAssignForm((prev) => ({ ...prev, technicianId: '' }));
                    }}
                    onFocus={() => setShowTechSuggestions(true)}
                    placeholder="Search by name, username or phone"
                    className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                  />
                  {showTechSuggestions && (
                    <div className="absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg">
                      {technicians.filter(
                        (t) =>
                          (t.name || '').toLowerCase().includes(techSearch.toLowerCase()) ||
                          (t.username || '').toLowerCase().includes(techSearch.toLowerCase()) ||
                          (t.phone || '').includes(techSearch)
                      ).length > 0 ? (
                        technicians
                          .filter(
                            (t) =>
                              (t.name || '').toLowerCase().includes(techSearch.toLowerCase()) ||
                              (t.username || '').toLowerCase().includes(techSearch.toLowerCase()) ||
                              (t.phone || '').includes(techSearch)
                          )
                          .map((tech) => (
                            <div
                              key={tech._id}
                              onClick={() => {
                                setAssignForm((prev) => ({
                                  ...prev,
                                  technicianId: tech._id,
                                  recipientEmail: tech.email || '',
                                  recipientPhone: tech.phone || '',
                                  gatePassDestination: prev.gatePassDestination || tech.name || ''
                                }));
                                setTechSearch(tech.name);
                                setShowTechSuggestions(false);
                              }}
                              className="cursor-pointer border-b p-2 last:border-b-0 hover:bg-amber-50"
                            >
                              <div className="font-medium">{tech.name}</div>
                              <div className="text-xs text-gray-500">
                                {tech.username} {tech.phone ? `| ${tech.phone}` : ''}
                              </div>
                            </div>
                          ))
                      ) : (
                        <div className="p-2 text-sm text-gray-500">No technicians found</div>
                      )}
                    </div>
                  )}
                  {assignForm.technicianId ? (
                    <div className="mt-1 text-xs text-green-600">✓ Technician selected</div>
                  ) : null}
                </div>
              )}

              {recipientType === 'Other' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700">Recipient Name</label>
                    <input
                      type="text"
                      value={otherRecipient.name}
                      onChange={(e) => {
                        const nextName = e.target.value;
                        setOtherRecipient({ ...otherRecipient, name: nextName });
                        setAssignForm((prev) => ({
                          ...prev,
                          gatePassDestination: prev.gatePassDestination || nextName
                        }));
                      }}
                      placeholder="Enter person name"
                      className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Recipient Email</label>
                    <input
                      type="email"
                      value={otherRecipient.email}
                      onChange={(e) => setOtherRecipient({ ...otherRecipient, email: e.target.value })}
                      placeholder="Enter email"
                      className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Recipient Phone</label>
                    <input
                      type="text"
                      value={otherRecipient.phone}
                      onChange={(e) => setOtherRecipient({ ...otherRecipient, phone: e.target.value })}
                      placeholder="Enter phone"
                      className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700">Note</label>
                    <input
                      type="text"
                      value={otherRecipient.note}
                      onChange={(e) => setOtherRecipient({ ...otherRecipient, note: e.target.value })}
                      placeholder="Department or reference"
                      className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                    />
                  </div>
                </div>
              )}

              {showAssignQuantity && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Assign Quantity</label>
                  <input
                    type="number"
                    min={1}
                    max={maxQ}
                    value={assignForm.assignQuantity}
                    onChange={(e) =>
                      setAssignForm((prev) => ({
                        ...prev,
                        assignQuantity: Number.parseInt(e.target.value, 10) || 1
                      }))
                    }
                    className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Available: {maxQ}. Partial assign leaves the rest in store.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {recipientType === 'Technician' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Recipient Email</label>
                    <input
                      type="email"
                      value={assignForm.recipientEmail}
                      onChange={(e) => setAssignForm({ ...assignForm, recipientEmail: e.target.value })}
                      placeholder="technician email"
                      className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                    />
                  </div>
                  {assignForm.needGatePass && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Recipient Phone (Gate Pass)</label>
                      <input
                        type="text"
                        value={assignForm.recipientPhone}
                        onChange={(e) => setAssignForm({ ...assignForm, recipientPhone: e.target.value })}
                        placeholder="Technician contact number"
                        className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Installation Location *</label>
                    <input
                      type="text"
                      value={assignForm.installationLocation || ''}
                      onChange={(e) => {
                        setAssignForm({ ...assignForm, installationLocation: e.target.value });
                        if (e.target.value.trim()) setInstallError('');
                      }}
                      placeholder="e.g. Server room, office, site"
                      className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                    />
                    {installError ? <p className="mt-1 text-xs text-rose-600">{installError}</p> : null}
                  </div>
                </>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-3">
                <p className="text-xs font-medium text-gray-700">Optional: copy notification email</p>
                <p className="text-xs text-gray-500">
                  Tick a row to copy the assignment-style email to that list from Portal → Customize Email (Admin also
                  includes store Admin / Super Admin accounts). Recipient email above is unchanged.
                </p>
                {ccPreviewLoading ? <p className="text-xs text-slate-500">Loading lists…</p> : null}
                <div>
                  <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={assignForm.notifyManager === true}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setAssignForm((prev) => ({ ...prev, notifyManager: v }));
                        persistAssignPrefs({ notifyManager: v });
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">Notify manager list</span>
                      <CcEmailSub
                        emails={ccPreview?.portalManager}
                        emptyMessage="No manager emails in Portal for this store."
                      />
                    </span>
                  </label>
                </div>
                <div>
                  <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={assignForm.notifyViewer === true}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setAssignForm((prev) => ({ ...prev, notifyViewer: v }));
                        persistAssignPrefs({ notifyViewer: v });
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">Notify viewer list</span>
                      <CcEmailSub
                        emails={ccPreview?.portalViewer}
                        emptyMessage="No viewer emails in Portal for this store."
                      />
                    </span>
                  </label>
                </div>
                <div>
                  <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={assignForm.notifyAdmin === true}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setAssignForm((prev) => ({ ...prev, notifyAdmin: v }));
                        persistAssignPrefs({ notifyAdmin: v });
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">Notify admin list</span>
                      <p className="ml-6 mt-1 text-xs text-slate-500">Portal — admin notification emails</p>
                      <CcEmailSub
                        emails={ccPreview?.portalAdmin}
                        emptyMessage="None configured in Portal for this store."
                      />
                      <p className="ml-6 mt-2 text-xs text-slate-500">Admin / Super Admin accounts for this store</p>
                      <CcEmailSub
                        emails={ccPreview?.platformAdminAccounts}
                        emptyMessage="No Admin or Super Admin accounts linked to this store."
                      />
                    </span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Need Gate Pass?</label>
                <div className="mt-1 flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="assignNeedGatePass"
                      checked={assignForm.needGatePass === true}
                      onChange={() => {
                        setAssignForm((prev) => ({ ...prev, needGatePass: true }));
                        persistAssignPrefs({ needGatePass: true });
                      }}
                    />
                    Yes
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="assignNeedGatePass"
                      checked={assignForm.needGatePass === false}
                      onChange={() => {
                        setAssignForm((prev) => ({ ...prev, needGatePass: false, sendGatePassEmail: false }));
                        persistAssignPrefs({ needGatePass: false, sendGatePassEmail: false });
                      }}
                    />
                    No
                  </label>
                </div>
              </div>

              {assignForm.needGatePass && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={assignForm.sendGatePassEmail === true}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setAssignForm((prev) => ({ ...prev, sendGatePassEmail: v }));
                          persistAssignPrefs({ sendGatePassEmail: v });
                        }}
                      />
                      Send gate pass by email to recipient
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Moving From</label>
                    <input
                      type="text"
                      value={assignForm.gatePassOrigin}
                      onChange={(e) => setAssignForm({ ...assignForm, gatePassOrigin: e.target.value })}
                      placeholder="Origin location"
                      className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Moving To</label>
                    <input
                      type="text"
                      list="assign-recipient-modal-move-dest"
                      value={assignForm.gatePassDestination}
                      onChange={(e) => setAssignForm({ ...assignForm, gatePassDestination: e.target.value })}
                      placeholder="Destination"
                      className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700">Justification</label>
                    <input
                      type="text"
                      value={assignForm.gatePassJustification}
                      onChange={(e) => setAssignForm({ ...assignForm, gatePassJustification: e.target.value })}
                      placeholder="Reason for movement"
                      className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Ticket / Reference {assignForm.needGatePass ? '(required if Gate Pass)' : '(optional)'}
                </label>
                <input
                  type="text"
                  value={assignForm.ticketNumber}
                  onChange={(e) => setAssignForm({ ...assignForm, ticketNumber: e.target.value })}
                  placeholder="Ticket number or reference"
                  className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                />
              </div>
            </div>
          </div>
        </div>

        <datalist id="assign-recipient-modal-move-dest">
          {technicians.map((t) => (
            <option key={t._id} value={t.name || ''} />
          ))}
        </datalist>

        <div className="flex shrink-0 justify-end gap-3 border-t border-gray-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md bg-gray-200 px-4 py-2 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {submitting ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}
