"use client";

/**
 * No-data copy for a panel that is empty because the section filter excluded
 * everything, not because the exporter is missing. The distinction matters: the
 * GPU and Neuron empty states explain scale-to-zero and uninstalled DaemonSets,
 * which would send someone debugging a cluster that is fine.
 */
export function FilteredEmptyState({ message, height = 256 }: { message: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-dashed border-gridline px-4 text-center text-xs text-ink-muted"
      style={{ height }}
    >
      <p className="max-w-md leading-relaxed">{message} Clear a filter to widen the view.</p>
    </div>
  );
}
