import ExcelJS from 'exceljs';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeSheetName(name) {
  const s = String(name || 'Sheet1').slice(0, 31);
  return s || 'Sheet1';
}

/**
 * @param {string} filename
 * @param {{ name: string, rows: any[][] }[]} sheets
 */
export async function downloadMultiSheetAoAXlsx(filename, sheets) {
  const wb = new ExcelJS.Workbook();
  for (const { name, rows } of sheets) {
    const ws = wb.addWorksheet(safeSheetName(name));
    for (const row of rows || []) ws.addRow(row);
  }
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), filename);
}

/**
 * @param {string[]} headers
 * @param {Record<string, unknown>[]} rows
 */
export async function downloadJsonHeadersRowsXlsx(filename, sheetName, headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(safeSheetName(sheetName));
  ws.addRow(headers);
  for (const row of rows || []) {
    ws.addRow(headers.map((h) => {
      const v = row[h];
      return v === undefined || v === null ? '' : v;
    }));
  }
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), filename);
}

/**
 * Column order follows the first row's keys (same idea as XLSX.utils.json_to_sheet).
 * @param {Record<string, unknown>[]} rows
 */
export async function downloadJsonAutoXlsx(filename, sheetName, rows) {
  const list = rows || [];
  if (!list.length) {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet(safeSheetName(sheetName));
    const buf = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buf], { type: XLSX_MIME }), filename);
    return;
  }
  const headers = Object.keys(list[0]);
  await downloadJsonHeadersRowsXlsx(filename, sheetName, headers, list);
}

/**
 * @param {string[]} headers
 * @param {Record<string, unknown>[]} rows
 * @returns {Promise<ArrayBuffer>}
 */
export async function jsonHeadersRowsToXlsxBuffer(sheetName, headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(safeSheetName(sheetName));
  ws.addRow(headers);
  for (const row of rows || []) {
    ws.addRow(headers.map((h) => {
      const v = row[h];
      return v === undefined || v === null ? '' : v;
    }));
  }
  return wb.xlsx.writeBuffer();
}
