"use client";

import { useId, useMemo, useState } from "react";
import { ChartRow } from "@/lib/useSeries";
import { LINE_WIDTH, SERIES, STRUCTURE } from "@/lib/theme";

interface SparklineProps {
  rows: ChartRow[];
  /** Row key holding the value (useRangeSeries names a single series by its legend). */
  seriesKey: string;
  height?: number;
  /** Called with the hovered row (or null when the pointer leaves). */
  onHover?: (row: ChartRow | null) => void;
  /** Optional threshold to draw as a hairline reference (e.g. the KCD 70% GPU target). */
  reference?: number;
}

/**
 * Trend-only line for a stat tile: no axes, no ticks, a single 2px stroke.
 * Nulls break the path rather than being interpolated. Hover reports the
 * nearest row so the tile can show that point's value in its caption.
 */
export function Sparkline({ rows, seriesKey, height = 32, onHover, reference }: SparklineProps) {
  const width = 200; // viewBox units; the SVG stretches to the tile width
  const pad = 2;
  const gradientId = useId();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const values = rows.map((r) => r[seriesKey]).filter((v): v is number => typeof v === "number");
    if (rows.length < 2 || values.length === 0) return null;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (reference !== undefined) {
      min = Math.min(min, reference);
      max = Math.max(max, reference);
    }
    if (max === min) {
      max += 1;
      min -= 1;
    }
    const t0 = rows[0].t;
    const t1 = rows[rows.length - 1].t;
    const span = Math.max(t1 - t0, 1);
    const x = (t: number) => pad + ((t - t0) / span) * (width - pad * 2);
    const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (height - pad * 2);

    let d = "";
    let pen = false;
    for (const row of rows) {
      const v = row[seriesKey];
      if (typeof v !== "number") {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(row.t).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    }
    return { d, x, y, refY: reference !== undefined ? y(reference) : null, points: rows.map((r) => x(r.t)) };
  }, [rows, seriesKey, reference, height]);

  if (!geometry) {
    return <div style={{ height }} aria-hidden="true" />;
  }

  function locate(clientX: number, target: SVGSVGElement) {
    const rect = target.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    let bestDist = Infinity;
    geometry!.points.forEach((px, i) => {
      const dist = Math.abs(px - vx);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setHoverX(geometry!.points[best]);
    onHover?.(rows[best]);
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      role="img"
      aria-label="Trend over the selected window"
      onMouseMove={(e) => locate(e.clientX, e.currentTarget)}
      onMouseLeave={() => {
        setHoverX(null);
        onHover?.(null);
      }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={SERIES[0]} stopOpacity="0.18" />
          <stop offset="100%" stopColor={SERIES[0]} stopOpacity="0" />
        </linearGradient>
      </defs>
      {geometry.refY !== null && (
        <line
          x1={pad}
          x2={width - pad}
          y1={geometry.refY}
          y2={geometry.refY}
          stroke={STRUCTURE.baseline}
          strokeWidth="1"
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path
        d={geometry.d}
        fill="none"
        stroke={SERIES[0]}
        strokeWidth={LINE_WIDTH}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {hoverX !== null && (
        <line
          x1={hoverX}
          x2={hoverX}
          y1={0}
          y2={height}
          stroke={STRUCTURE.baseline}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
