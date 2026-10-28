import { describe, expect, it } from 'vitest';
import { parseDateCell, parseTimeCell, readFirstSheet } from './excel';

describe('timesheet import', () => {
  it('reads CSV dates as day/month, the Singapore way', async () => {
    const csv = 'Employee,Date,Start,End,Break (min)\nT001,12/10/2026,9:00 AM,6:00 PM,60\nT002,2026-10-11,1000,1630,30\n';
    const rows = await readFirstSheet(new File([csv], 'hours.csv'));
    const parsed = rows.map((r) => [parseDateCell(r['Date']), parseTimeCell(r['Start']), parseTimeCell(r['End']), Number(r['Break (min)'])]);
    expect(parsed).toEqual([
      ['2026-10-12', '09:00', '18:00', 60],
      ['2026-10-11', '10:00', '16:30', 30],
    ]);
  });
});
