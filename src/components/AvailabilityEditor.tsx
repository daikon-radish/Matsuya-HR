import { useEffect, useState } from 'react';
import { formatDate, todayYMD, WEEKDAY_SHORT } from '../lib/dates';
import { errorMessage, hhmm, useLoad } from '../lib/data';
import { must, supabase } from '../lib/supabase';
import type { Availability } from '../lib/types';

interface WeekRow {
  on: boolean;
  start: string;
  end: string;
  note: string;
}

const ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function AvailabilityEditor({ employeeId }: { employeeId: string }) {
  const { data, error, reload } = useLoad(
    async () => must(await supabase.from('availability').select('*').eq('employee_id', employeeId).order('date')) as Availability[],
    [employeeId],
  );
  const [week, setWeek] = useState<Record<number, WeekRow>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [one, setOne] = useState({ date: todayYMD(), available: false, allDay: true, start: '09:00', end: '18:00', note: '' });

  useEffect(() => {
    const rows: Record<number, WeekRow> = {};
    for (const d of ORDER) {
      const r = data?.find((a) => a.weekday === d);
      rows[d] = r
        ? { on: r.available, start: hhmm(r.start_time) || '09:00', end: hhmm(r.end_time) || '22:00', note: r.note ?? '' }
        : { on: false, start: '09:00', end: '22:00', note: '' };
    }
    setWeek(rows);
  }, [data]);

  const exceptions = (data ?? []).filter((a) => a.date && a.date >= todayYMD());

  async function saveWeek() {
    setBusy(true);
    setMsg(null);
    try {
      must(await supabase.from('availability').delete().eq('employee_id', employeeId).not('weekday', 'is', null));
      const rows = ORDER.filter((d) => week[d]?.on).map((d) => ({
        employee_id: employeeId,
        weekday: d,
        start_time: week[d].start,
        end_time: week[d].end,
        available: true,
        note: week[d].note || null,
      }));
      if (rows.length) must(await supabase.from('availability').insert(rows));
      setMsg('Weekly availability saved');
      reload();
    } catch (err) {
      setMsg(errorMessage(err));
    }
    setBusy(false);
  }

  async function addException() {
    setMsg(null);
    try {
      must(
        await supabase.from('availability').insert({
          employee_id: employeeId,
          date: one.date,
          available: one.available,
          start_time: one.allDay ? null : one.start,
          end_time: one.allDay ? null : one.end,
          note: one.note || null,
        }),
      );
      setOne((o) => ({ ...o, note: '' }));
      reload();
    } catch (err) {
      setMsg(errorMessage(err));
    }
  }

  async function removeException(id: string) {
    try {
      must(await supabase.from('availability').delete().eq('id', id));
      reload();
    } catch (err) {
      setMsg(errorMessage(err));
    }
  }

  const setDay = (d: number, patch: Partial<WeekRow>) => setWeek((w) => ({ ...w, [d]: { ...w[d], ...patch } }));

  return (
    <div className="stack">
      {error && <div className="alert error">{error}</div>}
      {msg && <div className={`alert ${msg.includes('saved') ? 'ok' : 'error'}`}>{msg}</div>}
      <div>
        <h2>Usual weekly availability</h2>
        <p className="muted small">Tick the days you can work and the hours you're free. HR uses this when assigning shifts.</p>
      </div>
      <div className="avail-grid">
        {ORDER.map((d) =>
          week[d] ? (
            <div key={d} style={{ display: 'contents' }}>
              <label className="check">
                <input type="checkbox" checked={week[d].on} onChange={(e) => setDay(d, { on: e.target.checked })} />
                {WEEKDAY_SHORT[d]}
              </label>
              <div className="avail-day">
                {week[d].on ? (
                  <>
                    <input type="time" value={week[d].start} onChange={(e) => setDay(d, { start: e.target.value })} aria-label={`${WEEKDAY_SHORT[d]} from`} />
                    <span className="muted">to</span>
                    <input type="time" value={week[d].end} onChange={(e) => setDay(d, { end: e.target.value })} aria-label={`${WEEKDAY_SHORT[d]} until`} />
                    <input placeholder="Note (optional)" value={week[d].note} onChange={(e) => setDay(d, { note: e.target.value })} style={{ maxWidth: 220 }} />
                  </>
                ) : (
                  <span className="muted small">Not available</span>
                )}
              </div>
            </div>
          ) : null,
        )}
      </div>
      <div>
        <button className="btn btn-primary" onClick={saveWeek} disabled={busy}>Save weekly availability</button>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <h2>Specific dates</h2>
        <p className="muted small">For one-off changes, e.g. exams, a trip, or an extra day you can work.</p>
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 160 }}>
          Date
          <input type="date" value={one.date} onChange={(e) => setOne({ ...one, date: e.target.value })} />
        </label>
        <label className="field" style={{ width: 160 }}>
          I am
          <select value={one.available ? 'yes' : 'no'} onChange={(e) => setOne({ ...one, available: e.target.value === 'yes' })}>
            <option value="no">Not available</option>
            <option value="yes">Available</option>
          </select>
        </label>
        <label className="check" style={{ paddingBottom: 8 }}>
          <input type="checkbox" checked={one.allDay} onChange={(e) => setOne({ ...one, allDay: e.target.checked })} /> All day
        </label>
        {!one.allDay && (
          <>
            <label className="field" style={{ width: 120 }}>
              From
              <input type="time" value={one.start} onChange={(e) => setOne({ ...one, start: e.target.value })} />
            </label>
            <label className="field" style={{ width: 120 }}>
              To
              <input type="time" value={one.end} onChange={(e) => setOne({ ...one, end: e.target.value })} />
            </label>
          </>
        )}
        <label className="field" style={{ flex: 1, minWidth: 160 }}>
          Note
          <input value={one.note} onChange={(e) => setOne({ ...one, note: e.target.value })} />
        </label>
        <button className="btn" onClick={addException}>Add</button>
      </div>
      {exceptions.length > 0 && (
        <table className="table">
          <tbody>
            {exceptions.map((a) => (
              <tr key={a.id}>
                <td className="nowrap">{formatDate(a.date)}</td>
                <td>{a.available ? <span className="badge ok">Available</span> : <span className="badge danger">Not available</span>}</td>
                <td>{a.start_time ? `${hhmm(a.start_time)}–${hhmm(a.end_time)}` : 'All day'}</td>
                <td className="muted">{a.note}</td>
                <td className="right">
                  <button className="btn btn-ghost btn-sm" onClick={() => removeException(a.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
