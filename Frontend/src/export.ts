import type { Cell, Font } from 'exceljs';
import type { DefinitionOut, FieldUpdate, ProjectInfo } from './types';
import { definitionColumns } from './definitionColumns';

type VersionMetadata = Pick<ProjectInfo, 'version' | 'version_date'>;
const chinese = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;

function protocolVersion(metadata: VersionMetadata) {
  const version = metadata.version?.trim().replace(/^v\s*/i, '') ?? '';
  const date = metadata.version_date?.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!/^\d+(?:\.\d+)*$/.test(version) || !date) throw new Error('请先在方案校验页填写并保存方案版本（例如 1.0）和有效的版本日期（YYYY-MM-DD）。');
  const [, year, month, day] = date;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() + 1 !== Number(month) || parsed.getUTCDate() !== Number(day)) {
    throw new Error('方案版本日期无效，请在方案校验页修正并保存后再导出。');
  }
  return `V${version.includes('.') ? version : `${version}.0`} / ${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function formatCell(cell: Cell, header: boolean) {
  const font: Partial<Font> = { name: chinese.test(cell.text) ? '微软雅黑' : 'Times New Roman', size: 10, bold: header };
  cell.font = font;
  cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
  if (typeof cell.value !== 'string' || !cell.value) return;
  const runs = cell.value.split(/([\p{Script=Han}\u3000-\u303f\uff00-\uffef]+)/u).filter(Boolean);
  if (runs.length > 1) cell.value = { richText: runs.map((text) => ({ text, font: { ...font, name: chinese.test(text) ? '微软雅黑' : 'Times New Roman' } })) };
}

export async function definitionsWorkbook(rows: DefinitionOut[], fields: FieldUpdate[] | undefined, metadata: VersionMetadata) {
  const version = protocolVersion(metadata);
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('PD 定义', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: '方案版本', key: 'protocol_version', width: 30 },
    ...definitionColumns(fields).filter((column) => column.name !== 'position')
      .map((column) => ({ header: column.label, key: column.name, width: column.width })),
  ];
  rows.forEach((row) => {
    const cells = sheet.addRow({
      pd_category_name: row.pd_category_name, pd_ord: row.pd_ord,
      requirements: row.requirements, description: row.description,
      review_method: row.review_method ?? '', severity: row.severity ?? '', note: row.note ?? '',
      protocol_version: version,
    });
    cells.height = Math.min(409, Math.max(24, ...sheet.columns.map((column, columnIndex) => {
      const text = cells.getCell(columnIndex + 1).text;
      const length = (value: string) => Array.from(value).reduce((total, character) => total + (chinese.test(character) ? 2 : 1), 0);
      return text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(length(line) / Math.max(1, (column.width ?? 20) - 2))), 0) * 14 + 8;
    })));
  });
  sheet.eachRow((row, rowIndex) => row.eachCell({ includeEmpty: true }, (cell) => formatCell(cell, rowIndex === 1)));
  for (const key of ['pd_category_name', 'requirements'] as const) {
    let start = 0;
    for (let end = 1; end <= rows.length; end += 1) {
      if (end < rows.length && rows[end][key] === rows[start][key]) continue;
      if (end - start > 1 && rows[start][key]) sheet.mergeCells(start + 2, sheet.getColumn(key).number, end + 1, sheet.getColumn(key).number);
      start = end;
    }
  }
  if (rows.length > 1) sheet.mergeCells(2, sheet.getColumn('protocol_version').number, rows.length + 1, sheet.getColumn('protocol_version').number);
  const header = sheet.getRow(1);
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F0' } };
  header.height = 26;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  return workbook;
}

export async function downloadDefinitions(rows: DefinitionOut[], projectId: number, fields: FieldUpdate[], metadata: VersionMetadata) {
  const workbook = await definitionsWorkbook(rows, fields, metadata);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url; link.download = `PD-definitions-${projectId}.xlsx`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
