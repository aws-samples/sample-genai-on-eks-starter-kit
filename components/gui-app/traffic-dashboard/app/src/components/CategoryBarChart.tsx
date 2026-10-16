"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "./ChartFrame";
import { ChartTooltip } from "./ChartTooltip";
import { prettifyCategory } from "@/lib/format";
import { INK, STRUCTURE, colorForIndex } from "@/lib/theme";
import { useInstantVector } from "@/lib/useSeries";

interface CategoryBarChartProps {
  expr: string;
  /** Label to group by; rows missing it fall back to "unknown". */
  labelKey: string;
  formatValue: (value: number | null) => string;
  height?: number;
}

/**
 * Horizontal bars for a small categorical set (the bargauge equivalent). Bars
 * sorted by magnitude, but the colour is keyed to the category name so a
 * category keeps its colour as the ordering changes.
 */
export function CategoryBarChart({ expr, labelKey, formatValue, height = 240 }: CategoryBarChartProps) {
  const { rows, isLoading, error } = useInstantVector(expr);

  const data = rows.map((row) => ({
    name: prettifyCategory(row.labels[labelKey] ?? "unknown"),
    value: row.value,
  }));
  // Stable colour assignment: alphabetical index, not bar position.
  const colorByName = new Map(
    [...data]
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
      .map((name, index) => [name, colorForIndex(index)] as const),
  );

  return (
    <ChartFrame height={height} isLoading={isLoading} error={error} isEmpty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={STRUCTURE.gridline} strokeDasharray="2 4" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(value: number) => formatValue(value)}
            stroke={STRUCTURE.baseline}
            tick={{ fill: INK.muted, fontSize: 11 }}
            tickLine={false}
            className="tabular"
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke={STRUCTURE.baseline}
            tick={{ fill: INK.secondary, fontSize: 11 }}
            tickLine={false}
            width={96}
          />
          <Tooltip
            content={<ChartTooltip formatValue={formatValue} formatLabel={(label) => String(label)} />}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar dataKey="value" name="bytes" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={colorByName.get(entry.name) ?? colorForIndex(0)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
