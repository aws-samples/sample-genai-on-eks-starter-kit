/** Value formatters matching the units the Grafana panels declare. */

export function formatPercentUnit(value: number | null, digits = 2): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatSeconds(value: number | null): string {
  if (value === null) return "—";
  if (value < 1) return `${(value * 1000).toFixed(0)} ms`;
  return `${value.toFixed(2)} s`;
}

export function formatUsd(value: number | null, digits = 2): string {
  if (value === null) return "—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

export function formatBytes(value: number | null, digits = 1): string {
  if (value === null) return "—";
  if (value === 0) return "0 B";
  const exponent = Math.min(Math.floor(Math.log(Math.abs(value)) / Math.log(1024)), BYTE_UNITS.length - 1);
  return `${(value / 1024 ** exponent).toFixed(digits)} ${BYTE_UNITS[exponent]}`;
}

export function formatBytesPerSecond(value: number | null): string {
  if (value === null) return "—";
  return `${formatBytes(value)}/s`;
}

export function formatShort(value: number | null, digits = 2): string {
  if (value === null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(digits)}G`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(digits)}k`;
  if (abs > 0 && abs < 0.01) return value.toExponential(1);
  return value.toFixed(abs >= 100 ? 0 : digits);
}

export function formatCount(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-US");
}

export function formatReqps(value: number | null): string {
  if (value === null) return "—";
  return `${formatShort(value)} /s`;
}

export function formatClock(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** DCGM reports utilisation and KV-cache style gauges already on a 0-100 scale,
 *  unlike the 0-1 ratios the NFM/vLLM panels use. */
export function formatPercent100(value: number | null, digits = 0): string {
  if (value === null) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatCelsius(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(0)}°C`;
}

export function formatWatts(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)} kW`;
  return `${value.toFixed(0)} W`;
}

/** Human-readable category names for NFM flow categories. */
export function prettifyCategory(value: string): string {
  if (!value) return "unknown";
  return value.replace(/_/g, "-").toLowerCase();
}

/** Coarse human duration for ages: "3d 4h", "2h 15m", "12m", "40s". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}
