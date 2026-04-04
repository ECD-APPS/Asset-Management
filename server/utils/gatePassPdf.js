const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const sharp = require('sharp');
const { normalizeGatePassAssets } = require('./gatePassNormalize');
const Setting = require('../models/Setting');

const formatPdfDate = (d) => {
  if (!d) return '';
  return new Date(d)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase()
    .replace(/ /g, '-');
};

const formatPdfDateTime = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return x.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

function buildQrPayload(pass) {
  const p = pass || {};
  const rows = Array.isArray(p.assets) ? p.assets : [];
  const summary = rows
    .map((a) => {
      const uid = String(a?.unique_id || a?.uniqueId || a?.asset?.uniqueId || '').trim();
      const sn = String(a?.serial_number || a?.asset?.serial_number || '').trim();
      if (sn && uid) return `${sn} (${uid})`;
      return sn || uid || '';
    })
    .filter(Boolean)
    .join('; ');
  return [
    'Expo Stores - Gate Pass',
    `Ref: ${p.file_no || p.pass_number || '-'}`,
    `Type: ${p.type || 'Security Handover'}`,
    `From: ${p.origin || '-'}`,
    `To: ${p.destination || '-'}`,
    `Requested By: ${p.requested_by || p.issued_to?.name || '-'}`,
    `Assets: ${summary || '—'}`,
    `Created: ${p.createdAt || ''}`
  ].join('\n');
}

function fetchUrlBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith('https') ? https : http;
    lib
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).href;
          fetchUrlBuffer(next).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function normalizeLogoForPdf(buffer) {
  if (!buffer || buffer.length === 0) return null;
  const head = buffer.slice(0, 400).toString('utf8').trimStart();
  const looksSvg = head.startsWith('<?xml') || head.startsWith('<svg');
  try {
    if (looksSvg) {
      return sharp(buffer)
        .png()
        .resize({ width: 280, height: 280, fit: 'inside', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .toBuffer();
    }
    const meta = await sharp(buffer).metadata();
    if (meta.format === 'svg') {
      return sharp(buffer).png().resize({ width: 280, height: 280, fit: 'inside' }).toBuffer();
    }
    return sharp(buffer).rotate().resize({ width: 280, height: 280, fit: 'inside' }).png().toBuffer();
  } catch {
    return buffer;
  }
}

async function resolveGatePassLogoBuffer(overrideUrl) {
  const raw = overrideUrl ? String(overrideUrl).trim().split('?')[0] : '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const b = await fetchUrlBuffer(raw);
      return normalizeLogoForPdf(b);
    } catch (e) {
      console.warn('Gate pass PDF: remote logo fetch failed:', e.message);
    }
  } else if (raw.startsWith('/')) {
    const fp = path.join(__dirname, '..', raw.replace(/^\/+/, ''));
    try {
      const b = await fs.readFile(fp);
      return normalizeLogoForPdf(b);
    } catch {
      /* try defaults */
    }
  }
  for (const rel of ['../../client/public/gatepass-logo.svg', '../../client/public/logo.svg']) {
    try {
      const fp = path.join(__dirname, rel);
      const b = await fs.readFile(fp);
      const n = await normalizeLogoForPdf(b);
      if (n) return n;
    } catch {
      /* next */
    }
  }
  return null;
}

async function loadBrandingLogoFromSettings() {
  try {
    const [gp, app] = await Promise.all([
      Setting.findOne({ key: 'gatePassLogoUrl' }).lean(),
      Setting.findOne({ key: 'logoUrl' }).lean()
    ]);
    return resolveGatePassLogoBuffer(gp?.value || app?.value || '');
  } catch {
    return resolveGatePassLogoBuffer('');
  }
}

/**
 * A4 landscape gate pass PDF — branded header (QR + title + logo), aligned with app Pass Preview.
 */
async function buildGatePassPdfBuffer(pass, assetsArg, options = {}) {
  const p = pass && typeof pass.toObject === 'function' ? pass.toObject() : pass;
  const assets = Array.isArray(assetsArg) ? assetsArg : normalizeGatePassAssets(p);

  const [logoBuffer, qrBuffer] = await Promise.all([
    options.logoBuffer !== undefined ? Promise.resolve(options.logoBuffer) : loadBrandingLogoFromSettings(),
    QRCode.toBuffer(buildQrPayload(p), {
      type: 'png',
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b3a53', light: '#ffffffff' }
    })
  ]);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 40,
      info: {
        Title: `Gate Pass ${p.file_no || p.pass_number || ''}`,
        Author: 'Expo City Dubai — Asset Management'
      }
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const marginL = doc.page.margins.left;
    const marginR = doc.page.margins.right;
    const pageW = doc.page.width - marginL - marginR;
    const headerBox = 76;
    let y = doc.page.margins.top;

    // --- Branded header row: QR | title | logo ---
    const colSide = 86;
    const midX = marginL + colSide;
    const midW = pageW - colSide * 2;

    try {
      doc.image(qrBuffer, marginL, y, { width: headerBox, height: headerBox, fit: [headerBox, headerBox] });
    } catch (e) {
      console.warn('Gate pass PDF: QR embed failed', e.message);
    }

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, marginL + pageW - headerBox, y, {
          width: headerBox,
          height: headerBox,
          fit: [headerBox, headerBox]
        });
      } catch (e) {
        console.warn('Gate pass PDF: logo embed failed', e.message);
      }
    }

    doc.fillColor('#0b3a53').font('Helvetica-Bold').fontSize(13);
    doc.text('GATE PASS — EXPO CITY DUBAI', midX, y + 18, {
      width: midW,
      align: 'center'
    });
    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    doc.text('Security handover document', midX, y + 40, { width: midW, align: 'center' });

    y += headerBox + 10;
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(marginL, y).lineTo(marginL + pageW, y).stroke();
    y += 8;

    // Navy title bar (matches UI)
    const barH = 22;
    doc.save();
    doc.rect(marginL, y, pageW, barH).fill('#0b3a53');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
    doc.text('SECURITY HANDOVER', marginL + 10, y + 6, { width: pageW / 2 - 20, align: 'left' });
    doc.text(`DATE ${formatPdfDate(p.createdAt)}`, marginL + pageW / 2 - 10, y + 6, {
      width: pageW / 2,
      align: 'right'
    });
    doc.restore();
    y += barH + 2;

    if (String(p.approvalStatus || '').toLowerCase() === 'pending') {
      doc.save();
      doc.rect(marginL, y, pageW, 18).fill('#fef3c7');
      doc.fillColor('#78350f').font('Helvetica-Bold').fontSize(7);
      doc.text(
        'PENDING ADMIN APPROVAL — Final email to technician is sent only after approval.',
        marginL + 6,
        y + 5,
        { width: pageW - 12 }
      );
      doc.restore();
      y += 22;
    }

    doc.fillColor('#000000');

    // Metadata block (two-column top row for file / ticket)
    const metaPad = 6;
    const half = (pageW - 1) / 2;
    const rowH = 18;
    const drawFileTicketRow = () => {
      doc.save();
      doc.rect(marginL, y, half, rowH).fill('#f1f5f9');
      doc.rect(marginL + half + 1, y, half, rowH).fill('#f1f5f9');
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8);
      doc.text('FILE NO.:', marginL + metaPad, y + 5, { lineBreak: false });
      doc.font('Helvetica').text(String(p.file_no || p.pass_number || '—'), marginL + 88, y + 5, {
        width: half - 96,
        ellipsis: true
      });
      doc.font('Helvetica-Bold').text('TICKET NO./PO.:', marginL + half + 1 + metaPad, y + 5, { lineBreak: false });
      doc.font('Helvetica').text(String(p.ticket_no || '—'), marginL + half + 1 + 118, y + 5, {
        width: half - 126,
        ellipsis: true
      });
      doc.restore();
      y += rowH + 1;
    };
    drawFileTicketRow();

    doc.save();
    doc.rect(marginL, y, pageW, rowH).fill('#ffffff');
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8);
    doc.text('PASS TYPE:', marginL + metaPad, y + 5, { lineBreak: false });
    doc.font('Helvetica').text(String(p.type || '—'), marginL + 118, y + 5, { width: pageW - 128, ellipsis: true });
    doc.restore();
    y += rowH + 1;

    const singleRows = [
      ['REQUESTED BY:', p.requested_by || p.issued_to?.name || '—', '#ffffff'],
      ['PROVIDED BY:', p.provided_by || '—', '#f8fafc'],
      ['COLLECTED BY:', p.collected_by || p.issued_to?.name || '—', '#ffffff'],
      ['APPROVED BY:', p.approved_by || '—', '#f8fafc']
    ];
    singleRows.forEach(([lab, val, fill]) => {
      doc.save();
      doc.rect(marginL, y, pageW, rowH).fill(fill);
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8);
      doc.text(lab, marginL + metaPad, y + 5, { lineBreak: false });
      doc.font('Helvetica').text(String(val), marginL + 118, y + 5, { width: pageW - 128, ellipsis: true });
      doc.restore();
      y += rowH + 1;
    });

    y += 8;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b');
    doc.text('MOVING FROM', marginL, y);
    doc.text('MOVING TO', marginL + pageW / 2, y);
    y += 12;
    doc.fillColor('#000').font('Helvetica').fontSize(9);
    doc.text(String(p.origin || '—'), marginL, y, { width: pageW / 2 - 14 });
    doc.text(String(p.destination || '—'), marginL + pageW / 2, y, { width: pageW / 2 - 14 });
    y += 28;

    const cols = [
      { w: 22, h: '#', key: 'idx' },
      { w: 72, h: 'Product', key: 'productName' },
      { w: 62, h: 'Model', key: 'model' },
      { w: 78, h: 'Serial', key: 'serial_number' },
      { w: 72, h: 'Unique ID', key: 'unique_id' },
      { w: 58, h: 'Mfr', key: 'brand' },
      { w: 52, h: 'Status', key: 'status' },
      { w: 46, h: 'Cond.', key: 'condition' },
      { w: 56, h: 'Ticket', key: 'ticket_number' },
      { w: 22, h: 'Qty', key: 'quantity' },
      { w: 130, h: 'Remarks', key: 'remarks' }
    ];
    let totalColW = cols.reduce((s, c) => s + c.w, 0);
    const scale = totalColW > pageW ? pageW / totalColW : 1;
    cols.forEach((c) => {
      c.w *= scale;
    });

    const headerH = 16;
    doc.save();
    doc.rect(marginL, y, pageW, headerH).fill('#0b3a53');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6.5);
    let hx = marginL;
    cols.forEach((c) => {
      doc.text(c.h, hx + 2, y + 4, { width: c.w - 4, align: 'center' });
      hx += c.w;
    });
    doc.restore();
    doc.fillColor('#000000');
    y += headerH;

    doc.font('Helvetica').fontSize(6).fillColor('#000000');
    assets.forEach((a, i) => {
      const rowData = {
        idx: String(i + 1),
        productName: a.productName || '—',
        model: a.model || '—',
        serial_number: a.serial_number || '—',
        unique_id: a.unique_id || '—',
        brand: a.brand || '—',
        status: a.status || '—',
        condition: a.condition || '—',
        ticket_number: a.ticket_number || '—',
        quantity: String(a.quantity ?? 1),
        remarks: (a.remarks || '—').replace(/\n/g, ' ')
      };
      const rowHeights = cols.map((c) => {
        const txt = String(rowData[c.key] ?? '—');
        return doc.heightOfString(txt, { width: c.w - 4 });
      });
      const rh = Math.max(14, ...rowHeights.map((h) => h + 6));
      if (y + rh > doc.page.height - doc.page.margins.bottom - 72) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });
        y = doc.page.margins.top;
      }
      let x = marginL;
      cols.forEach((c) => {
        const txt = String(rowData[c.key] ?? '—');
        doc.rect(x, y, c.w, rh).stroke('#64748b');
        doc.text(txt, x + 2, y + 3, { width: c.w - 4, align: c.key === 'remarks' ? 'left' : 'center' });
        x += c.w;
      });
      y += rh;
    });

    y += 10;
    const justText = String(p.justification || p.notes || '—');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
    doc.text('JUSTIFICATION: ', marginL, y, { continued: true, lineBreak: false });
    doc.font('Helvetica').text(justText, { width: pageW - 100 });
    y = doc.y + 10;

    doc.fontSize(7.5).fillColor('#64748b').font('Helvetica');
    doc.text(
      `Document No: ${p.file_no || p.pass_number || '—'}  |  Created: ${formatPdfDateTime(p.createdAt)}  |  Type: ${p.type || '—'}`,
      marginL,
      y,
      { width: pageW }
    );

    doc.end();
  });
}

module.exports = {
  buildGatePassPdfBuffer,
  formatPdfDate
};
