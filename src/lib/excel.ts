// SheetJS is large, so it's loaded only when someone actually exports or imports.
const loadXLSX = () => import('xlsx');

export type Cell = string | number | boolean | null | undefined;

export interface SheetSpec {
  name: string;
  rows: Cell[][];
  /** Column widths in characters */
  widths?: number[];
}

export async function downloadWorkbook(filename: string, sheets: SheetSpec[]): Promise<void> {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    if (s.widths) ws['!cols'] = s.widths.map((wch) => ({ wch }));
    // Sheet names are limited to 31 characters and can't contain : \ / ? * [ ]
    XLSX.utils.book_append_sheet(wb, ws, s.name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

/** First sheet as row objects keyed by header, with raw cell values (numbers for dates/times). */
export async function readFirstSheet(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await loadXLSX();
  // raw: CSV text stays as typed, so '12/10/2026' reaches parseDateCell as day/month instead of SheetJS's US month/day.
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: true, defval: null });
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Excel serial number, 'YYYY-MM-DD' or Singapore-style 'D/M/YYYY' → 'YYYY-MM-DD' */
export function parseDateCell(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${year}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  return null;
}

/** Excel time fraction, '9:30', '0930', '9:30 PM', '21.30' → 'HH:MM' */
export function parseTimeCell(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (v < 1) {
      const mins = Math.round(v * 1440) % 1440;
      return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
    }
    v = String(v).padStart(4, '0');
  }
  const s = String(v).trim().toLowerCase();
  const m = s.match(/^(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}
