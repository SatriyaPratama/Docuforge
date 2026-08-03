import type { ParsedPage } from '@/lib/types';
import { saveAs } from 'file-saver';
import ExcelJS from 'exceljs';

export type ExportScope = 'this-page' | 'all-pages';

function scopedPages(pages: ParsedPage[], scope: ExportScope, pageIndex: number): ParsedPage[] {
  if (scope === 'this-page') {
    const selected = pages[pageIndex];
    return selected ? [selected] : [];
  }
  return pages;
}

function textFromHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function uniqueSheetName(baseName: string, usedNames: Set<string>): string {
  // Excel sheet names: max 31 chars, no \ / ? * [ ] :
  const clean = baseName.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Table';
  if (!usedNames.has(clean)) {
    usedNames.add(clean);
    return clean;
  }

  let suffix = 2;
  while (suffix < 100) {
    const candidate = `${clean.slice(0, 31 - (` (${suffix})`.length))} (${suffix})`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    suffix += 1;
  }

  const fallback = `Table ${usedNames.size + 1}`.slice(0, 31);
  usedNames.add(fallback);
  return fallback;
}

export function hasTableBlocks(pages: ParsedPage[], scope: ExportScope, pageIndex: number): boolean {
  const selected = scopedPages(pages, scope, pageIndex);
  return selected.some((page) => page.blocks.some((block) => block.type === 'Table'));
}

export interface ExcelPreviewSheet {
  name: string;
  pageIndex: number;
  rows: string[][];
}

/** Build the workbook's page sheets once, for both preview and download. */
export function buildExcelSheets(
  pages: ParsedPage[],
  scope: ExportScope,
  pageIndex: number,
): ExcelPreviewSheet[] {
  const usedNames = new Set<string>();
  return scopedPages(pages, scope, pageIndex).map((page) => {
    const rows: string[][] = [];
    for (const block of page.blocks) {
      if (block.type === 'Table' && block.tableData?.length) {
        if (rows.length && rows[rows.length - 1].length) rows.push([]);
        rows.push(...block.tableData.map((row) => row.map((cell) => String(cell ?? ''))));
        continue;
      }

      const text = textFromHtml(block.markdown || block.html);
      if (text) rows.push([block.type, text]);
    }

    return {
      name: uniqueSheetName(`Page ${page.pageIndex + 1}`, usedNames),
      pageIndex: page.pageIndex,
      rows,
    };
  });
}

export function exportMarkdown(pages: ParsedPage[], filename: string) {
  const lines: string[] = [];
  for (const page of pages) {
    lines.push(`\n\n<!-- Page ${page.pageIndex + 1} -->\n`);
    for (const block of page.blocks) {
      lines.push(block.markdown);
      lines.push('');
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  saveAs(blob, `${filename}.md`);
}

export function exportHtml(pages: ParsedPage[], filename: string) {
  const bodyParts: string[] = [];
  for (const page of pages) {
    bodyParts.push(`<section data-page="${page.pageIndex + 1}">`);
    for (const block of page.blocks) {
      bodyParts.push(block.html);
    }
    bodyParts.push('</section>');
  }
  const html = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<title>${escapeHtml(filename)}</title>\n</head>\n<body>\n${bodyParts.join('\n')}\n</body>\n</html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  saveAs(blob, `${filename}.html`);
}

/** RFC 4180 field escaping */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportCsv(
  pages: ParsedPage[],
  filename: string,
  scope: ExportScope,
  pageIndex: number,
) {
  const selected = scopedPages(pages, scope, pageIndex);
  const csvRows: string[][] = [];

  for (const page of selected) {
    for (const block of page.blocks) {
      if (block.type !== 'Table' || !block.tableData?.length) continue;
      csvRows.push(...block.tableData);
      csvRows.push([]);
    }
  }

  if (csvRows.length > 0 && csvRows[csvRows.length - 1].length === 0) {
    csvRows.pop();
  }

  const csv = csvRows.map((row) => row.map(csvField).join(',')).join('\r\n');
  // BOM so Excel opens UTF-8 CSVs correctly
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, `${filename}.csv`);
}

export async function exportExcel(
  pages: ParsedPage[],
  filename: string,
  scope: ExportScope,
  pageIndex: number,
) {
  const wb = new ExcelJS.Workbook();
  const sheets = buildExcelSheets(pages, scope, pageIndex);

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    ws.addRows(sheet.rows);
    if (sheet.rows.length) ws.getRow(1).font = { bold: true };

    const colCount = Math.max(1, ...sheet.rows.map((row) => row.length));
    for (let c = 1; c <= colCount; c += 1) {
      const longest = sheet.rows.reduce(
        (max, row) => Math.max(max, (row[c - 1] ?? '').length),
        0,
      );
      ws.getColumn(c).width = Math.min(60, Math.max(10, longest + 2));
    }
  }

  if (wb.worksheets.length === 0) return;

  const buf = await wb.xlsx.writeBuffer();
  saveAs(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${filename}.xlsx`,
  );
}
