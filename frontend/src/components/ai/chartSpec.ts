/**
 * v5.11.0 — the ```chart block the assistant emits for data visualisation.
 * Pure parser (no React) so it is unit-tested and safe to run on partial
 * input: anything malformed returns null and the renderer falls back to a
 * plain code block.
 */
export type ChartType = 'bar' | 'line' | 'pie' | 'area';

export interface ChartSeries {
  name: string;
  data: number[];
}

export interface ChartSpec {
  type: ChartType;
  title?: string;
  labels: string[];
  series: ChartSeries[];
  /** Axis / value unit shown after numbers ("%", "₹", "ms"). */
  unit?: string;
}

const TYPES: ChartType[] = ['bar', 'line', 'pie', 'area'];

export function parseChartSpec(code: string): ChartSpec | null {
  let raw: unknown;
  try {
    raw = JSON.parse(code);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = typeof o.type === 'string' && TYPES.includes(o.type as ChartType) ? (o.type as ChartType) : 'bar';
  const labels = Array.isArray(o.labels) ? o.labels.map((l) => String(l)).slice(0, 60) : [];
  let series: ChartSeries[] = [];
  if (Array.isArray(o.series)) {
    series = o.series
      .map((sr) => {
        if (!sr || typeof sr !== 'object') return null;
        const r = sr as Record<string, unknown>;
        const data = Array.isArray(r.data) ? r.data.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];
        if (!data.length) return null;
        return { name: typeof r.name === 'string' ? r.name : 'Series', data: data.slice(0, 60) };
      })
      .filter((x): x is ChartSeries => !!x)
      .slice(0, 8);
  } else if (Array.isArray(o.data)) {
    // Shorthand: {"labels":[…],"data":[…]}
    const data = o.data.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (data.length) series = [{ name: typeof o.name === 'string' ? o.name : 'Value', data: data.slice(0, 60) }];
  }
  if (!series.length) return null;
  const n = Math.max(...series.map((sr) => sr.data.length));
  const filledLabels = labels.length >= n ? labels.slice(0, n) : [...labels, ...Array.from({ length: n - labels.length }, (_, i) => String(labels.length + i + 1))];
  return {
    type,
    title: typeof o.title === 'string' ? o.title.slice(0, 120) : undefined,
    labels: filledLabels,
    series: series.map((sr) => ({ ...sr, data: sr.data.length < n ? [...sr.data, ...Array(n - sr.data.length).fill(0)] : sr.data })),
    unit: typeof o.unit === 'string' ? o.unit.slice(0, 8) : undefined,
  };
}

/** Compact number for axis ticks and labels. */
export function fmtNum(v: number, unit = ''): string {
  const abs = Math.abs(v);
  const s = abs >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : abs >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : abs >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : Number.isInteger(v) ? String(v) : v.toFixed(2);
  return unit === '₹' || unit === '$' ? `${unit}${s}` : `${s}${unit}`;
}
