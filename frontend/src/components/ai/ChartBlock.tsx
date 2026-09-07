import { useMemo, useState } from 'react';
import { cn } from '@/utils/cn';
import { fmtNum, parseChartSpec, type ChartSpec } from './chartSpec';

/**
 * v5.11.0 — inline SVG charts for ```chart blocks: bar, line, area and pie.
 * No charting library; a few hundred bytes of geometry, theme tokens for
 * colour, hover tooltips, and a legend. Falls back to the raw JSON in a
 * code block when the spec doesn't parse.
 */
const PALETTE = [
  'rgb(var(--ember-500))',
  'rgb(96 165 250)',
  'rgb(251 191 36)',
  'rgb(244 114 182)',
  'rgb(167 139 250)',
  'rgb(45 212 191)',
  'rgb(251 146 60)',
  'rgb(163 163 163)',
];

const W = 640;
const H = 300;
const PAD = { l: 48, r: 16, t: 16, b: 40 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

function CartesianChart({ spec }: { spec: ChartSpec }) {
  const [hover, setHover] = useState<{ i: number; s: number } | null>(null);
  const n = spec.labels.length;
  const max = niceMax(Math.max(...spec.series.flatMap((s) => s.data)));
  const min = Math.min(0, ...spec.series.flatMap((s) => s.data));
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + innerH - ((v - min) / (max - min || 1)) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
  const groupW = innerW / Math.max(1, n);
  const isBar = spec.type === 'bar';
  const x = (i: number) => PAD.l + groupW * i + groupW / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={spec.title ?? 'chart'}>
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgb(var(--ink-700))" strokeWidth={1} />
          <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="rgb(var(--ink-400))">
            {fmtNum(t, spec.unit)}
          </text>
        </g>
      ))}
      {spec.labels.map((l, i) => (
        <text
          key={i}
          x={x(i)}
          y={H - PAD.b + 18}
          textAnchor={n > 12 ? 'end' : 'middle'}
          transform={n > 12 ? `rotate(-35 ${x(i)} ${H - PAD.b + 18})` : undefined}
          fontSize={11}
          fill="rgb(var(--ink-300))"
        >
          {l.length > 14 ? `${l.slice(0, 13)}…` : l}
        </text>
      ))}
      {spec.series.map((sr, s) => {
        const color = PALETTE[s % PALETTE.length];
        if (isBar) {
          const bw = Math.max(2, (groupW * 0.7) / spec.series.length);
          return sr.data.map((v, i) => {
            const bx = x(i) - (groupW * 0.7) / 2 + bw * s;
            const top = y(Math.max(0, v));
            const bottom = y(Math.min(0, v));
            const active = hover && hover.i === i && hover.s === s;
            return (
              <rect
                key={i}
                x={bx}
                y={top}
                width={bw - 1}
                height={Math.max(1, bottom - top)}
                rx={2}
                fill={color}
                opacity={hover && !active ? 0.55 : 1}
                onMouseEnter={() => setHover({ i, s })}
                onMouseLeave={() => setHover(null)}
                className="transition-opacity"
              />
            );
          });
        }
        const pts = sr.data.map((v, i) => `${x(i)},${y(v)}`).join(' ');
        return (
          <g key={s}>
            {spec.type === 'area' && (
              <polygon points={`${x(0)},${y(min)} ${pts} ${x(n - 1)},${y(min)}`} fill={color} opacity={0.18} />
            )}
            <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {sr.data.map((v, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(v)}
                r={hover && hover.i === i && hover.s === s ? 5 : 3}
                fill={color}
                onMouseEnter={() => setHover({ i, s })}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        );
      })}
      {hover && (
        <g>
          <rect
            x={Math.min(W - 150, Math.max(PAD.l, x(hover.i) - 60))}
            y={PAD.t}
            width={140}
            height={38}
            rx={6}
            fill="rgb(var(--ink-800))"
            stroke="rgb(var(--ink-600))"
          />
          <text x={Math.min(W - 150, Math.max(PAD.l, x(hover.i) - 60)) + 8} y={PAD.t + 15} fontSize={11} fill="rgb(var(--ink-300))">
            {spec.labels[hover.i]}
          </text>
          <text x={Math.min(W - 150, Math.max(PAD.l, x(hover.i) - 60)) + 8} y={PAD.t + 30} fontSize={12} fontWeight={700} fill="rgb(var(--ink-100))">
            {spec.series[hover.s].name}: {fmtNum(spec.series[hover.s].data[hover.i], spec.unit)}
          </text>
        </g>
      )}
    </svg>
  );
}

function PieChart({ spec }: { spec: ChartSpec }) {
  const data = spec.series[0].data;
  const total = data.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const [hover, setHover] = useState<number | null>(null);
  const cx = 150;
  const cy = 150;
  const r = 120;
  let angle = -Math.PI / 2;
  const slices = data.map((v, i) => {
    const frac = Math.max(0, v) / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
    const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
    return { i, frac, d: `M${cx},${cy} L${p0[0]},${p0[1]} A${r},${r} 0 ${large} 1 ${p1[0]},${p1[1]} Z` };
  });
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <svg viewBox="0 0 300 300" className="w-56 h-56 shrink-0" role="img" aria-label={spec.title ?? 'pie chart'}>
        {slices.map((sl) => (
          <path
            key={sl.i}
            d={sl.d}
            fill={PALETTE[sl.i % PALETTE.length]}
            stroke="rgb(var(--ink-900))"
            strokeWidth={2}
            opacity={hover != null && hover !== sl.i ? 0.5 : 1}
            onMouseEnter={() => setHover(sl.i)}
            onMouseLeave={() => setHover(null)}
            className="transition-opacity"
          />
        ))}
        <circle cx={cx} cy={cy} r={52} fill="rgb(var(--ink-900))" />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill="rgb(var(--ink-100))">
          {hover != null ? `${Math.round(slices[hover].frac * 100)}%` : fmtNum(total, spec.unit)}
        </text>
      </svg>
      <ul className="text-xs space-y-1.5 min-w-0">
        {spec.labels.map((l, i) => (
          <li key={i} className={cn('flex items-center gap-2', hover != null && hover !== i && 'opacity-50')} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="truncate text-ink-200">{l}</span>
            <span className="ml-auto tabular-nums text-ink-400">{fmtNum(data[i], spec.unit)} · {Math.round(slices[i].frac * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartBlock({ code, fallback }: { code: string; fallback: React.ReactNode }) {
  const spec = useMemo(() => parseChartSpec(code), [code]);
  if (!spec) return <>{fallback}</>;
  return (
    <figure className="my-2 rounded-lg bg-ink-850 p-3 animate-fade-up">
      {spec.title && <figcaption className="text-[13px] font-bold mb-2 text-ink-100">{spec.title}</figcaption>}
      {spec.type === 'pie' ? <PieChart spec={spec} /> : <CartesianChart spec={spec} />}
      {spec.type !== 'pie' && spec.series.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-300">
          {spec.series.map((sr, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
              {sr.name}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
