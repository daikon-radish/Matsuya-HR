import { MONTH_NAMES } from '../lib/dates';

interface Props {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
}

export default function MonthPicker({ year, month, onChange }: Props) {
  const shift = (delta: number) => {
    const m = month - 1 + delta;
    onChange(year + Math.floor(m / 12), ((m % 12) + 12) % 12 + 1);
  };
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <button className="btn btn-sm" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
      <strong style={{ minWidth: 130, textAlign: 'center' }}>{MONTH_NAMES[month - 1]} {year}</strong>
      <button className="btn btn-sm" onClick={() => shift(1)} aria-label="Next month">›</button>
    </div>
  );
}

export function currentMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
