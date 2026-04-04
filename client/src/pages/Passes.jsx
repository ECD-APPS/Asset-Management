import { useState, useEffect, useRef, useMemo } from 'react';
import api from '../api/axios';
import { useReactToPrint } from 'react-to-print';
import { QrCode, Printer, Plus, X, Eye, Edit, Trash2, Lock, Download, CheckCircle2 } from 'lucide-react';
import PropTypes from 'prop-types';
import QRCode from 'qrcode';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/** Header QR and org logo: identical box on screen; print CSS sets mm for A4 landscape. */
const GATE_PASS_HEADER_BOX_PX = 120;
const GATE_PASS_HEADER_QR_RENDER_PX = 132;

const escapeRegExpForHighlight = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const highlightSearchInText = (text, query) => {
  const q = String(query || '').trim();
  if (!q) return text === null || text === undefined ? '' : String(text);
  const str = text === null || text === undefined ? '' : String(text);
  if (!str) return str;
  let re;
  try {
    re = new RegExp(escapeRegExpForHighlight(q), 'gi');
  } catch {
    return str;
  }
  const matches = [...str.matchAll(re)];
  if (matches.length === 0) return str;
  const nodes = [];
  let lastIndex = 0;
  let key = 0;
  for (const m of matches) {
    const start = m.index;
    if (start > lastIndex) {
      nodes.push(<span key={`gp-t-${key++}`}>{str.slice(lastIndex, start)}</span>);
    }
    nodes.push(
      <mark
        key={`gp-m-${key++}`}
        className="rounded px-0.5 bg-yellow-300 text-gray-900 font-semibold ring-1 ring-amber-500/80"
      >
        {m[0]}
      </mark>
    );
    lastIndex = start + m[0].length;
  }
  if (lastIndex < str.length) {
    nodes.push(<span key={`gp-t-${key++}`}>{str.slice(lastIndex)}</span>);
  }
  return nodes;
};

function passAssetIdSummary(pass) {
  const rows = Array.isArray(pass?.assets) ? pass.assets : [];
  return rows
    .map((a) => {
      const uid = String(a?.unique_id || a?.uniqueId || a?.asset?.uniqueId || '').trim();
      const sn = String(a?.serial_number || a?.asset?.serial_number || '').trim();
      if (sn && uid) return `${sn} (${uid})`;
      return sn || uid || '';
    })
    .filter(Boolean)
    .join('; ');
}

function passMatchesSearch(pass, qRaw) {
  const q = String(qRaw || '').trim().toLowerCase();
  if (!q) return true;
  const approvalLabel = pass.approvalStatus === 'pending' ? 'pending' : 'approved';
  const hayParts = [
    pass.file_no,
    pass.pass_number,
    pass.type,
    pass.requested_by,
    pass.issued_to?.name,
    pass.status,
    pass.approvalStatus,
    approvalLabel,
    pass.approved_by,
    pass.origin,
    pass.destination,
    pass.ticket_no,
    pass.createdAt && new Date(pass.createdAt).toLocaleDateString(),
    passAssetIdSummary(pass)
  ];
  (pass.assets || []).forEach((row) => {
    hayParts.push(
      row.serial_number,
      row.unique_id,
      row.uniqueId,
      row.name,
      row.model,
      row.brand,
      row.asset?.serial_number,
      row.asset?.uniqueId
    );
  });
  const hay = hayParts.map((p) => String(p || '').toLowerCase()).join(' ');
  return hay.includes(q);
}

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

const PassReferenceQr = ({ pass }) => {
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    let mounted = true;
    const payload = [
      'Expo Stores - Gate Pass',
      `Ref: ${pass?.file_no || pass?.pass_number || '-'}`,
      `Type: ${pass?.type || 'Security Handover'}`,
      `From: ${pass?.origin || '-'}`,
      `To: ${pass?.destination || '-'}`,
      `Requested By: ${pass?.requested_by || pass?.issued_to?.name || '-'}`,
      `Assets: ${passAssetIdSummary(pass) || '—'}`,
      `Created: ${pass?.createdAt || ''}`
    ].join('\n');

    QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: GATE_PASS_HEADER_QR_RENDER_PX
    })
      .then((url) => {
        if (mounted) setQrDataUrl(url);
      })
      .catch(() => {
        if (mounted) setQrDataUrl('');
      });

    return () => {
      mounted = false;
    };
  }, [pass]);

  if (qrDataUrl) {
    return (
      <img
        src={qrDataUrl}
        alt="Pass Reference QR"
        className="pass-header-emblem object-contain bg-white p-1 border-2 border-slate-500 rounded-sm shrink-0"
        width={GATE_PASS_HEADER_BOX_PX}
        height={GATE_PASS_HEADER_BOX_PX}
        style={{ width: GATE_PASS_HEADER_BOX_PX, height: GATE_PASS_HEADER_BOX_PX }}
      />
    );
  }

  return <QrCode size={Math.round(GATE_PASS_HEADER_BOX_PX * 0.35)} className="text-slate-700 shrink-0" />;
};

PassReferenceQr.propTypes = {
  pass: PropTypes.object
};

const PassTemplate = ({ pass, refInstance, gatePassLogoUrl }) => {
  if (!pass) return null;
  
  // Format date as 11-NOV-2025
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase().replace(/ /g, '-');
  };
  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="print-template-hidden" style={{ position: 'absolute', top: '-10000px', left: '-10000px' }}>
      <div ref={refInstance} className="bg-white text-black font-sans pass-print-root text-[11px] leading-snug">
        <div
          className="mx-auto relative pass-print-sheet border-2 border-slate-800 shadow-sm"
          style={{
            width: '297mm',
            minHeight: '210mm',
            maxWidth: '297mm',
            padding: '8mm 10mm',
            boxSizing: 'border-box'
          }}
        >
          <img
            src={gatePassLogoUrl || '/gatepass-logo.svg'}
            alt=""
            className="absolute pointer-events-none select-none"
            style={{ width: '105mm', opacity: 0.05, top: '50%', left: '50%', transform: 'translate(-50%, -45%)' }}
          />
          {/* Header */}
          <div className="grid grid-cols-3 items-center mb-3 pb-3 border-b-2 border-slate-200">
            <div className="flex items-center gap-2">
              <PassReferenceQr pass={pass} />
            </div>
            <div className="text-center font-black text-[22px] tracking-[0.12em] text-[#0b3a53] uppercase">
              Gate Pass — Expo City Dubai
            </div>
            <div className="flex items-center justify-end gap-2">
              <div
                className="pass-header-logo-wrap flex shrink-0 items-center justify-center"
                style={{ width: GATE_PASS_HEADER_BOX_PX, height: GATE_PASS_HEADER_BOX_PX }}
              >
                <img
                  src={gatePassLogoUrl || '/gatepass-logo.svg'}
                  alt=""
                  className="pass-header-emblem max-h-full max-w-full object-contain"
                />
              </div>
            </div>
          </div>

          {/* Title Bar */}
          <div className="bg-[#0b3a53] text-white px-4 py-2.5 flex justify-between items-center font-bold text-xs tracking-wide mb-0 border-y border-[#082838]">
            <span>SECURITY HANDOVER</span>
            <span>DATE {formatDate(pass.createdAt)}</span>
          </div>

          {pass.approvalStatus === 'pending' && (
            <div className="bg-amber-100 border border-amber-400 text-amber-950 text-center text-[11px] font-bold py-2 px-3">
              PENDING ADMIN APPROVAL — Final email to technician is sent only after approval.
            </div>
          )}

          {/* Info Block */}
          <div className="border border-slate-400 border-t-0 text-[11px] mb-5">
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
               <span>
                 {pass.approved_by ||
                   (pass.approvalStatus === 'pending' ? '— (pending admin approval)' : '')}
               </span>
            </div>
          </div>

          {/* Movement */}
          <div className="grid grid-cols-2 gap-14 mb-4 text-[11px]">
            <div>
               <div className="font-bold text-slate-500 mb-1 tracking-wide">MOVING FROM</div>
               <div className="font-bold text-base border-b border-gray-300 pb-1">{pass.origin}</div>
            </div>
            <div>
               <div className="font-bold text-slate-500 mb-1 tracking-wide">MOVING TO</div>
               <div className="font-bold text-base border-b border-gray-300 pb-1">{pass.destination}</div>
            </div>
          </div>

          {/* Assets Table */}
          <table className="w-full border-collapse border border-slate-800 text-center mb-4 text-[9px] pass-print-table">
            <thead className="bg-[#0b3a53] text-white">
              <tr>
                <th className="border border-slate-800 px-1 py-2 font-bold w-8">#</th>
                <th className="border border-slate-800 px-1 py-2 font-bold">Model</th>
                <th className="border border-slate-800 px-1 py-2 font-bold">Serial Number</th>
                <th className="border border-slate-800 px-1 py-2 font-bold">Unique ID</th>
                <th className="border border-slate-800 px-1 py-2 font-bold">Manufacturer</th>
                <th className="border border-slate-800 px-1 py-2 font-bold">Status</th>
                <th className="border border-slate-800 px-1 py-2 font-bold">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {(pass.assets || []).map((item, i) => (
                <tr key={i} className={`text-black ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                  <td className="border border-slate-700 p-1">{i + 1}</td>
                  <td className="border border-slate-700 p-1 text-left pl-2">{item.model || '—'}</td>
                  <td className="border border-slate-700 p-1 font-mono text-[8px]">{item.serial_number || '—'}</td>
                  <td className="border border-slate-700 p-1 font-mono text-[8px]">
                    {item.unique_id || item.uniqueId || (item.asset && typeof item.asset === 'object' ? item.asset.uniqueId : '') || '—'}
                  </td>
                  <td className="border border-slate-700 p-1">{item.brand || '—'}</td>
                  <td className="border border-slate-700 p-1">{item.status || '—'}</td>
                  <td className="border border-slate-700 p-1 text-left pl-2">{item.remarks || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Footer */}
          <div className="text-[11px] border-t border-gray-300 pt-3">
            <span className="font-bold">JUSTIFICATION:</span> {pass.justification || pass.notes}
          </div>

          <div className="mt-3 border border-slate-400 rounded-sm text-[10px] pass-print-meta">
            <div className="grid grid-cols-3">
              <div className="p-2 border-r border-slate-300">
                <div className="uppercase font-semibold text-slate-500">Document No.</div>
                <div className="font-mono">{pass.file_no || pass.pass_number || '-'}</div>
              </div>
              <div className="p-2 border-r border-slate-300">
                <div className="uppercase font-semibold text-slate-500">Created On</div>
                <div>{formatDateTime(pass.createdAt)}</div>
              </div>
              <div className="p-2">
                <div className="uppercase font-semibold text-slate-500">Pass Type</div>
                <div>{pass.type || 'Security Handover'}</div>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-12 gap-3 items-stretch pass-print-signatures">
            <div className="col-span-9 grid grid-cols-4 gap-4 text-[10px]">
              <div className="border-t border-slate-500 pt-1 text-center">
                <div className="font-semibold">Requested By</div>
                <div className="text-slate-600">{pass.requested_by || pass.issued_to?.name || '-'}</div>
              </div>
              <div className="border-t border-slate-500 pt-1 text-center">
                <div className="font-semibold">Collected By</div>
                <div className="text-slate-600">{pass.collected_by || pass.issued_to?.name || '-'}</div>
              </div>
              <div className="border-t border-slate-500 pt-1 text-center">
                <div className="font-semibold">Approved By</div>
                <div className="text-slate-600">{pass.approved_by || '-'}</div>
              </div>
              <div className="border-t border-slate-500 pt-1 text-center">
                <div className="font-semibold">Security Verification</div>
                <div className="text-slate-600">Name / Sign / Stamp</div>
              </div>
            </div>
            <div className="col-span-3 border border-slate-400 rounded-sm p-2 text-[10px] bg-slate-50">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-700">Reference QR</div>
                <QrCode size={16} className="text-slate-700" />
              </div>
              <div className="mt-2 text-slate-600 leading-4">
                <div className="font-mono break-all">#{pass.file_no || pass.pass_number || '-'}</div>
                <div>{formatDateTime(pass.createdAt)}</div>
                <div className="uppercase tracking-wide">{pass.type || 'Security Handover'}</div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-[10px] text-gray-400 text-right">
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

const ViewModal = ({
  pass,
  onClose,
  onPrint,
  onDownload,
  onApprove,
  approveLoading,
  gatePassLogoUrl,
  previewRef
}) => {
  if (!pass) return null;

  // Format date as 11-NOV-2025
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase().replace(/ /g, '-');
  };
  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto pass-preview-modal">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[min(1240px,calc(100vw-1.5rem))] max-h-[92vh] overflow-hidden flex flex-col relative pass-preview-card">
        <div className="shrink-0 sticky top-0 bg-white z-10 border-b p-3 sm:p-4 flex justify-between items-center gap-2 no-print">
           <h2 className="text-lg font-bold">Pass Preview</h2>
           <div className="flex gap-2 flex-wrap justify-end">
              {pass.approvalStatus === 'pending' && typeof onApprove === 'function' && (
                <button
                  type="button"
                  onClick={onApprove}
                  disabled={approveLoading}
                  className="bg-emerald-600 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-emerald-700 text-sm disabled:opacity-60"
                >
                  <CheckCircle2 size={16} /> Approve &amp; email tech
                </button>
              )}
              <button 
                onClick={onPrint}
                className="bg-amber-600 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-amber-700 text-sm"
              >
                <Printer size={16} /> Print / Save PDF
              </button>
              <button
                onClick={onDownload}
                className="bg-slate-700 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-slate-800 text-sm"
              >
                <Download size={16} /> Download PDF
              </button>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X size={24} />
              </button>
           </div>
        </div>
        
        {/* Preview: A4 landscape width 297mm; scroll horizontally if the modal is narrower */}
        <div className="flex-1 min-h-0 overflow-auto bg-slate-100 pass-print-root">
          <div className="p-4 sm:p-6">
            <div
              ref={previewRef}
              className="pass-preview-a4-landscape bg-white p-6 sm:p-8 shadow-md border-2 border-slate-800 relative overflow-visible pass-print-sheet text-[11px] leading-snug mx-auto"
            >
             <img
               src={gatePassLogoUrl || '/gatepass-logo.svg'}
               alt=""
               className="absolute pointer-events-none select-none"
               style={{ width: '78mm', opacity: 0.05, top: '50%', left: '50%', transform: 'translate(-50%, -45%)' }}
             />
             {/* Header */}
             <div className="grid grid-cols-3 items-center mb-4 pb-3 border-b-2 border-slate-200">
                <div className="flex items-center gap-2">
                  <PassReferenceQr pass={pass} />
                </div>
                <div className="text-center font-black text-[22px] tracking-[0.12em] text-[#0b3a53] uppercase">
                  Gate Pass — Expo City Dubai
                </div>
                <div className="flex items-center justify-end gap-2">
                  <div
                    className="pass-header-logo-wrap flex shrink-0 items-center justify-center"
                    style={{ width: GATE_PASS_HEADER_BOX_PX, height: GATE_PASS_HEADER_BOX_PX }}
                  >
                    <img
                      src={gatePassLogoUrl || '/gatepass-logo.svg'}
                      alt=""
                      className="pass-header-emblem max-h-full max-w-full object-contain"
                    />
                  </div>
                </div>
              </div>

              {/* Title Bar */}
              <div className="bg-[#0b3a53] text-white px-4 py-2.5 flex justify-between items-center font-bold text-sm mb-0 border-y border-[#082838]">
                <span>SECURITY HANDOVER</span>
                <span>DATE {formatDate(pass.createdAt)}</span>
              </div>

              {pass.approvalStatus === 'pending' && (
                <div className="bg-amber-100 border border-amber-400 text-amber-950 text-center text-xs font-bold py-2 px-3">
                  PENDING ADMIN APPROVAL — Final email to technician is sent only after approval.
                </div>
              )}

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
                   <span>
                     {pass.approved_by ||
                       (pass.approvalStatus === 'pending' ? '— (pending admin approval)' : '')}
                   </span>
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
              <table className="w-full border-collapse border border-slate-800 text-center mb-6 text-[9px] pass-print-table">
                <thead className="bg-[#0b3a53] text-white">
                  <tr>
                    <th className="border border-slate-800 px-1 py-2 font-bold w-8">#</th>
                    <th className="border border-slate-800 px-1 py-2 font-bold">Model</th>
                    <th className="border border-slate-800 px-1 py-2 font-bold">Serial Number</th>
                    <th className="border border-slate-800 px-1 py-2 font-bold">Unique ID</th>
                    <th className="border border-slate-800 px-1 py-2 font-bold">Manufacturer</th>
                    <th className="border border-slate-800 px-1 py-2 font-bold">Status</th>
                    <th className="border border-slate-800 px-1 py-2 font-bold">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {(pass.assets || []).map((item, i) => (
                    <tr key={i} className={`text-black ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                      <td className="border border-slate-700 p-1">{i + 1}</td>
                      <td className="border border-slate-700 p-1 text-left pl-2">{item.model || '—'}</td>
                      <td className="border border-slate-700 p-1 font-mono text-[8px]">{item.serial_number || '—'}</td>
                      <td className="border border-slate-700 p-1 font-mono text-[8px]">
                        {item.unique_id || item.uniqueId || (item.asset && typeof item.asset === 'object' ? item.asset.uniqueId : '') || '—'}
                      </td>
                      <td className="border border-slate-700 p-1">{item.brand || '—'}</td>
                      <td className="border border-slate-700 p-1">{item.status || '—'}</td>
                      <td className="border border-slate-700 p-1 text-left pl-2">{item.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Footer */}
              <div className="text-xs border-t border-gray-200 pt-4">
                <span className="font-bold">JUSTIFICATION:</span> {pass.justification || pass.notes}
              </div>
              <div className="mt-3 border border-slate-300 rounded-sm text-[10px] pass-print-meta">
                <div className="grid grid-cols-3">
                  <div className="p-2 border-r border-slate-300">
                    <div className="uppercase font-semibold text-slate-500">Document No.</div>
                    <div className="font-mono">{pass.file_no || pass.pass_number || '-'}</div>
                  </div>
                  <div className="p-2 border-r border-slate-300">
                    <div className="uppercase font-semibold text-slate-500">Created On</div>
                    <div>{formatDateTime(pass.createdAt)}</div>
                  </div>
                  <div className="p-2">
                    <div className="uppercase font-semibold text-slate-500">Pass Type</div>
                    <div>{pass.type || 'Security Handover'}</div>
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-12 gap-3 items-stretch pass-print-signatures">
                <div className="col-span-9 grid grid-cols-4 gap-4 text-[10px]">
                  <div className="border-t border-slate-500 pt-1 text-center">
                    <div className="font-semibold">Requested By</div>
                    <div className="text-slate-600">{pass.requested_by || pass.issued_to?.name || '-'}</div>
                  </div>
                  <div className="border-t border-slate-500 pt-1 text-center">
                    <div className="font-semibold">Collected By</div>
                    <div className="text-slate-600">{pass.collected_by || pass.issued_to?.name || '-'}</div>
                  </div>
                  <div className="border-t border-slate-500 pt-1 text-center">
                    <div className="font-semibold">Approved By</div>
                    <div className="text-slate-600">{pass.approved_by || '-'}</div>
                  </div>
                  <div className="border-t border-slate-500 pt-1 text-center">
                    <div className="font-semibold">Security Verification</div>
                    <div className="text-slate-600">Name / Sign / Stamp</div>
                  </div>
                </div>
                <div className="col-span-3 border border-slate-400 rounded-sm p-2 text-[10px] bg-slate-50">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-slate-700">Reference QR</div>
                    <QrCode size={16} className="text-slate-700" />
                  </div>
                  <div className="mt-2 text-slate-600 leading-4">
                    <div className="font-mono break-all">#{pass.file_no || pass.pass_number || '-'}</div>
                    <div>{formatDateTime(pass.createdAt)}</div>
                    <div className="uppercase tracking-wide">{pass.type || 'Security Handover'}</div>
                  </div>
                </div>
              </div>
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
  onDownload: PropTypes.func,
  onApprove: PropTypes.func,
  approveLoading: PropTypes.bool,
  previewRef: PropTypes.object,
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
  const [approveLoadingId, setApproveLoadingId] = useState(null);
  const [passSearch, setPassSearch] = useState('');

  const printRef = useRef();
  const previewRef = useRef();
  const printTimerRef = useRef(null);
  const printPageStyle = `
    @page { size: A4 landscape; margin: 10mm; }
    @media print {
      html, body { width: 297mm; min-height: 210mm; height: auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { margin: 0 !important; background: #ffffff !important; }
      .pass-print-root { width: 100% !important; margin: 0 !important; }
      .pass-print-sheet {
        width: 100% !important;
        height: auto !important;
        min-height: auto !important;
        overflow: visible !important;
        break-inside: auto !important;
        page-break-inside: auto !important;
        max-width: 277mm !important;
        box-sizing: border-box !important;
      }
      .pass-header-logo-wrap {
        width: 30mm !important;
        height: 30mm !important;
        flex-shrink: 0 !important;
        box-sizing: border-box !important;
      }
      .pass-header-emblem {
        width: 30mm !important;
        height: 30mm !important;
        max-width: 30mm !important;
        max-height: 30mm !important;
        min-width: 30mm !important;
        min-height: 30mm !important;
        object-fit: contain !important;
        box-sizing: border-box !important;
        flex-shrink: 0 !important;
      }
      .pass-header-logo-wrap .pass-header-emblem {
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
      }
      .pass-print-table { width: 100% !important; table-layout: fixed !important; }
      .pass-print-table thead { display: table-header-group !important; }
      .pass-print-table tr { break-inside: avoid !important; page-break-inside: avoid !important; }
      .pass-print-meta, .pass-print-signatures { break-inside: avoid !important; page-break-inside: avoid !important; }
    }
  `;
  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: 'Gate_Pass_A4_Landscape',
    removeAfterPrint: true,
    pageStyle: printPageStyle
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
       unique_id: '',
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

  const handleApprovePass = async (pass, { refreshView = false } = {}) => {
    if (!pass?._id) return;
    setApproveLoadingId(String(pass._id));
    try {
      const { data } = await api.post(`/passes/${pass._id}/approve`);
      const msg = data.emailSent
        ? 'Gate pass approved. Email sent to technician.'
        : `Gate pass approved. ${data.emailSkippedReason || 'Email not sent.'}`;
      alert(msg);
      await loadPasses();
      if (refreshView && viewPass && String(viewPass._id) === String(pass._id) && data.pass) {
        setViewPass(data.pass);
        setSelectedPass(data.pass);
      }
    } catch (e) {
      alert(e.response?.data?.message || 'Approve failed');
    } finally {
      setApproveLoadingId(null);
    }
  };

  useEffect(() => {
    loadPasses();
  }, []);

  const passSearchQ = passSearch.trim();
  const filteredPasses = useMemo(() => {
    if (!passSearchQ) return passes;
    return passes.filter((p) => passMatchesSearch(p, passSearchQ));
  }, [passes, passSearchQ]);

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

  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.setAttribute('id', 'passes-global-print-style');
    styleEl.textContent = `
      @page {
        size: A4 landscape;
        margin: 10mm;
      }

      @media print {
        html, body {
          width: 297mm;
          height: auto;
          margin: 0 !important;
          padding: 0 !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          background: #ffffff !important;
        }

        .pass-print-root {
          position: static !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
        }

        .pass-print-sheet {
          width: 100% !important;
          min-height: auto !important;
          height: auto !important;
          max-width: 277mm !important;
          box-sizing: border-box !important;
          page-break-after: auto !important;
        }

        .pass-header-logo-wrap {
          width: 30mm !important;
          height: 30mm !important;
          flex-shrink: 0 !important;
          box-sizing: border-box !important;
        }

        .pass-header-emblem {
          width: 30mm !important;
          height: 30mm !important;
          max-width: 30mm !important;
          max-height: 30mm !important;
          min-width: 30mm !important;
          min-height: 30mm !important;
          object-fit: contain !important;
          box-sizing: border-box !important;
          flex-shrink: 0 !important;
        }

        .pass-header-logo-wrap .pass-header-emblem {
          width: 100% !important;
          height: 100% !important;
          max-width: 100% !important;
          max-height: 100% !important;
          min-width: 0 !important;
          min-height: 0 !important;
        }

        .pass-print-table {
          width: 100% !important;
          table-layout: fixed !important;
        }

        .pass-print-table thead {
          display: table-header-group !important;
        }

        .pass-print-table tr,
        .pass-print-signatures,
        .pass-print-meta {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }

        .no-print {
          display: none !important;
        }

        .print-template-hidden {
          display: none !important;
        }

        .pass-preview-modal {
          position: static !important;
          inset: auto !important;
          background: #ffffff !important;
          padding: 0 !important;
          overflow: visible !important;
        }

        .pass-preview-card {
          width: 100% !important;
          max-width: none !important;
          max-height: none !important;
          border: none !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          overflow: visible !important;
        }

        .pass-preview-a4-landscape {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 277mm !important;
        }
      }

      /* On-screen preview: A4 landscape — 297mm wide (long edge), min 210mm short edge */
      @media screen {
        .pass-preview-a4-landscape {
          width: 297mm;
          min-width: 297mm;
          max-width: 297mm;
          min-height: 210mm;
          box-sizing: border-box;
        }
      }
    `;

    document.head.appendChild(styleEl);
    return () => styleEl.remove();
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
         unique_id: a.unique_id || a.uniqueId || (a.asset && typeof a.asset === 'object' ? a.asset.uniqueId : '') || '',
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
         unique_id: '',
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
      unique_id: asset.uniqueId || '',
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
         unique_id: '',
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
    if (printTimerRef.current) clearTimeout(printTimerRef.current);
    printTimerRef.current = setTimeout(() => {
      handlePrint();
    }, 500);
  };

  const handleDownloadPdf = async () => {
    try {
      const target = previewRef.current;
      if (!target || !viewPass) {
        alert('Open gate pass preview first, then download.');
        return;
      }

      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff'
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const safeName = `${(viewPass.file_no || viewPass.pass_number || 'gatepass').toString().replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      pdf.save(safeName);
    } catch (error) {
      console.error('PDF download failed', error);
      alert('Download failed. Please try again.');
    }
  };
  
  useEffect(() => {
    return () => {
      if (printTimerRef.current) clearTimeout(printTimerRef.current);
    };
  }, []);

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
        onDownload={handleDownloadPdf}
        onApprove={viewPass?.approvalStatus === 'pending' ? () => handleApprovePass(viewPass, { refreshView: true }) : undefined}
        approveLoading={Boolean(viewPass?._id && approveLoadingId === String(viewPass._id))}
        previewRef={previewRef}
        gatePassLogoUrl={gatePassLogoUrl}
      />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Security Handover / Gate Passes (New Format)</h1>
          <p className="text-gray-500">Manage Asset Movement and Security Handovers</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <input
            type="search"
            value={passSearch}
            onChange={(e) => setPassSearch(e.target.value)}
            placeholder="Search pass #, serial, unique ID, requester, status…"
            title="Matches pass number, file number, ticket, serial numbers, unique IDs, names, and locations."
            className="h-10 w-full min-w-0 rounded-lg border border-gray-300 px-3 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 sm:min-w-[280px]"
          />
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex shrink-0 items-center justify-center gap-2 rounded bg-amber-600 px-4 py-2 text-white hover:bg-amber-700"
          >
            <Plus size={20} /> Create Pass
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded shadow overflow-x-auto">
        {passes.length > 0 && filteredPasses.length === 0 && (
          <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            No passes match &quot;{passSearchQ}&quot;. Clear the search box to see all passes.
          </p>
        )}
        <table className="min-w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pass #</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Requested By</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Serial / Unique ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Admin approval</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Approved by</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredPasses.map((pass) => (
              <tr key={pass._id} className="hover:bg-gray-50">
                <td className="px-6 py-4 font-mono font-medium">
                  {highlightSearchInText(pass.file_no || pass.pass_number || '-', passSearchQ)}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`rounded px-2 py-1 text-xs font-bold ${
                      pass.type === 'Inbound' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {highlightSearchInText(pass.type || '-', passSearchQ)}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="font-medium">
                    {highlightSearchInText(pass.requested_by || pass.issued_to?.name || '-', passSearchQ)}
                  </div>
                </td>
                <td className="max-w-[220px] px-6 py-4 text-xs font-mono text-gray-800" title={passAssetIdSummary(pass)}>
                  {highlightSearchInText(passAssetIdSummary(pass) || '—', passSearchQ)}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {highlightSearchInText(
                    pass.createdAt ? new Date(pass.createdAt).toLocaleDateString() : '-',
                    passSearchQ
                  )}
                </td>
                <td className="px-6 py-4">
                  <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-800">
                    {highlightSearchInText(String(pass.status || '-'), passSearchQ)}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {pass.approvalStatus === 'pending' ? (
                    <span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
                      {highlightSearchInText('Pending', passSearchQ)}
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-900">
                      {highlightSearchInText('Approved', passSearchQ)}
                    </span>
                  )}
                </td>
                <td className="max-w-[140px] px-6 py-4 text-sm text-gray-700">
                  {highlightSearchInText(pass.approved_by || '—', passSearchQ)}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    {pass.approvalStatus === 'pending' && (
                      <button
                        type="button"
                        onClick={() => handleApprovePass(pass)}
                        disabled={approveLoadingId === String(pass._id)}
                        className="text-emerald-600 hover:text-emerald-800 p-1 disabled:opacity-50"
                        title="Approve gate pass and email technician"
                      >
                        <CheckCircle2 size={18} />
                      </button>
                    )}
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
                         <th className="p-2 border w-36">Unique ID</th>
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
                                      <div className="font-bold font-mono">{asset.serial_number}</div>
                                      {asset.uniqueId && (
                                        <div className="text-[10px] font-mono text-slate-600">ID: {asset.uniqueId}</div>
                                      )}
                                      <div className="text-gray-600">{asset.name}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                           </td>
                           <td className="p-2 border">
                              <input 
                                className="w-full p-1 border rounded font-mono text-xs" 
                                value={item.unique_id || ''}
                                onChange={e => {
                                  const newAssets = [...formData.assets];
                                  newAssets[index].unique_id = e.target.value;
                                  setFormData({...formData, assets: newAssets});
                                }}
                                placeholder="From asset lookup or type"
                              />
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
