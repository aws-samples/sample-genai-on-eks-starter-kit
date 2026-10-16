"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame, SeriesLegend } from "./ChartFrame";
import { ChartTooltip } from "./ChartTooltip";
import { formatClock } from "@/lib/format";
import { INK, LINE_WIDTH, STATUS, STRUCTURE } from "@/lib/theme";
import { RangeQuery, useRangeSeries } from "@/lib/useSeries";

interface TimeSeriesChartProps {
  queries: RangeQuery[];
  /** Formatter shared by the y-axis ticks and the tooltip — one unit per chart. */
  formatValue: (value: number | null) => string;
  minutes?: number;
  height?: number;
  /** Y-axis label; charts carry exactly one axis, so this names its unit. */
  unitLabel?: string;
  /** Muted, labelled threshold marker. Same unit as the axis by definition. */
  threshold?: { value: number; label: string; color?: string };
  /** Custom empty-state; defaults to ChartFrame's generic copy. */
  emptyState?: React.ReactNode;
}

/**
 * Multi-series line chart. Single y-axis by design: when two quantities need
 * different units they go into two charts, never a dual axis.
 */
export function TimeSeriesChart({
  queries,
  formatValue,
  minutes = 60,
  height = 240,
  unitLabel,
  threshold,
  emptyState,
}: TimeSeriesChartProps) {
  const { rows, series, isLoading, error } = useRangeSeries(queries, minutes);

  if (emptyState && !error && !isLoading && rows.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <>
      <ChartFrame height={height} isLoading={isLoading} error={error} isEmpty={rows.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={STRUCTURE.gridline} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              scale="time"
              tickFormatter={formatClock}
              stroke={STRUCTURE.baseline}
              tick={{ fill: INK.muted, fontSize: 11 }}
              tickLine={false}
              minTickGap={40}
              className="tabular"
            />
            <YAxis
              tickFormatter={(value: number) => formatValue(value)}
              stroke={STRUCTURE.baseline}
              tick={{ fill: INK.muted, fontSize: 11 }}
              tickLine={false}
              width={64}
              className="tabular"
              label={
                unitLabel
                  ? {
                      value: unitLabel,
                      angle: -90,
                      position: "insideLeft",
                      fill: INK.muted,
                      fontSize: 11,
                      dy: 24,
                    }
                  : undefined
              }
            />
            <Tooltip
              content={<ChartTooltip formatValue={formatValue} />}
              cursor={{ stroke: STRUCTURE.baseline, strokeWidth: 1 }}
            />
            {threshold && (
              <ReferenceLine
                y={threshold.value}
                stroke={threshold.color ?? STATUS.critical}
                strokeDasharray="4 4"
                strokeOpacity={0.55}
                strokeWidth={1}
                label={{
                  value: threshold.label,
                  position: "insideTopRight",
                  fill: INK.muted,
                  fontSize: 10,
                }}
              />
            )}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.key}
                stroke={s.color}
                strokeWidth={LINE_WIDTH}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
      <SeriesLegend series={series} />
    </>
  );
}
