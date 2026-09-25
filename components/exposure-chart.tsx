"use client";

import { useMemo, useState } from "react";

// Stacked columns of exposure results over time. Result colors are status-like, fixed per result and
// never cycled (dataviz: good green, critical red, a categorical blue, a neutral gray for "skipped").
// Identity never rests on color alone: the legend, the hover readout and the table carry the names.

export type ExposureEvent = { at: number; result: number };

export const resultSeries = [
  { key: "applied", label: "Applied", color: "#0ca30c" },
  { key: "rehearsed", label: "Dry run", color: "#2a78d6" },
  { key: "failed", label: "Failed", color: "#d03b3b" },
  { key: "skipped", label: "Skipped", color: "#94a3b8" },
] as const;

const ranges = [
  { label: "24 hours", hours: 24, bucketHours: 1 },
  { label: "3 days", hours: 72, bucketHours: 6 },
  { label: "5 days", hours: 120, bucketHours: 6 },
  { label: "7 days", hours: 168, bucketHours: 6 },
] as const;

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 36 };
const GAP = 2;

function niceMax(value: number) {
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / step) * step;
}

export function ExposureChart({ events, now, timeZone }: { events: ExposureEvent[]; now: number; timeZone: string }) {
  const [rangeIndex, setRangeIndex] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const range = ranges[rangeIndex];

  const buckets = useMemo(() => {
    const size = range.bucketHours * 3_600_000;
    // Buckets end at the next whole bucket boundary so an hourly bar means a clock hour.
    const end = Math.ceil(now / size) * size;
    const count = range.hours / range.bucketHours;
    const start = end - count * size;
    const rows = Array.from({ length: count }, (_, index) => ({ start: start + index * size, counts: [0, 0, 0, 0] }));
    for (const event of events) {
      if (event.at < start || event.at >= end) continue;
      rows[Math.floor((event.at - start) / size)].counts[event.result] += 1;
    }
    return rows;
  }, [events, now, range]);

  const format = useMemo(() => new Intl.DateTimeFormat("en-US", range.bucketHours === 1
    ? { timeZone, hour: "numeric" }
    : { timeZone, month: "short", day: "numeric", hour: "numeric" }), [range, timeZone]);

  const totals = resultSeries.map((_, series) => buckets.reduce((sum, row) => sum + row.counts[series], 0));
  const max = niceMax(Math.max(0, ...buckets.map((row) => row.counts.reduce((a, b) => a + b, 0))));
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotWidth / buckets.length;
  const barWidth = Math.max(2, slot - GAP);
  const y = (value: number) => (value / max) * plotHeight;
  const labelEvery = Math.ceil(buckets.length / 8);
  const active = hovered === null ? null : buckets[hovered];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-700">
        {resultSeries.map((series, index) => (
          <span className="inline-flex items-center gap-2" key={series.key}>
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: series.color }} />
            {series.label} <span className="font-semibold text-slate-950">{totals[index]}</span>
          </span>
        ))}
      </div>

      <div className="relative mt-3">
        <svg aria-label={`Exposure results over the last ${range.label}`} className="h-auto w-full" role="img" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          {[0, max / 2, max].map((tick) => (
            <g key={tick}>
              <line stroke="#e2e8f0" x1={PAD.left} x2={WIDTH - PAD.right} y1={PAD.top + plotHeight - y(tick)} y2={PAD.top + plotHeight - y(tick)} />
              <text fill="#64748b" fontSize="11" textAnchor="end" x={PAD.left - 6} y={PAD.top + plotHeight - y(tick) + 4}>{tick}</text>
            </g>
          ))}
          {buckets.map((row, index) => {
            const x = PAD.left + index * slot + GAP / 2;
            let base = PAD.top + plotHeight;
            return (
              <g key={row.start} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}>
                {/* The hit target is the whole column, far larger than a thin segment. */}
                <rect fill={hovered === index ? "#f1f5f9" : "transparent"} height={plotHeight} width={slot} x={PAD.left + index * slot} y={PAD.top} />
                {row.counts.map((count, series) => {
                  if (!count) return null;
                  const height = Math.max(1, y(count) - GAP);
                  base -= y(count);
                  return <rect fill={resultSeries[series].color} height={height} key={series} rx={series === row.counts.findLastIndex(Boolean) ? 3 : 0} width={barWidth} x={x} y={base + GAP} />;
                })}
                {index % labelEvery === 0 && (
                  <text fill="#64748b" fontSize="11" textAnchor="middle" x={PAD.left + index * slot + slot / 2} y={HEIGHT - 8}>{format.format(row.start)}</text>
                )}
              </g>
            );
          })}
        </svg>
        {active && (
          <div className="pointer-events-none absolute right-2 top-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
            <p className="font-semibold text-slate-950">{format.format(active.start)} – {format.format(active.start + range.bucketHours * 3_600_000)}</p>
            {resultSeries.map((series, index) => (
              <p className="mt-0.5 flex items-center gap-2 text-slate-700" key={series.key}>
                <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: series.color }} />
                {series.label}: <span className="font-semibold text-slate-950">{active.counts[index]}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <label className="mt-4 block text-sm text-slate-700">
        <span className="font-medium">Time range: {range.label}</span>
        <input
          aria-valuetext={range.label}
          className="mt-2 block w-full max-w-md accent-slate-700"
          max={ranges.length - 1}
          min={0}
          onChange={(event) => { setRangeIndex(Number(event.target.value)); setHovered(null); }}
          step={1}
          type="range"
          value={rangeIndex}
        />
        <span className="mt-1 flex max-w-md justify-between text-xs text-slate-500">
          {ranges.map((option) => <span key={option.label}>{option.label}</span>)}
        </span>
      </label>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-600">Show as table</summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-slate-500"><tr><th className="py-1 font-medium">From</th>{resultSeries.map((series) => <th className="py-1 text-right font-medium" key={series.key}>{series.label}</th>)}</tr></thead>
          <tbody>
            {buckets.filter((row) => row.counts.some(Boolean)).map((row) => (
              <tr className="border-t border-slate-100" key={row.start}>
                <td className="py-1">{format.format(row.start)}</td>
                {row.counts.map((count, index) => <td className="py-1 text-right" key={index}>{count}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
