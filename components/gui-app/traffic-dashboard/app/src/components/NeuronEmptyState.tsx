"use client";

/**
 * Shared no-data copy for the Neuron panels. Two normal reasons for an empty
 * result: the cluster has no Inferentia/Trainium nodes right now, or the
 * neuron-monitor DaemonSet (components/o11y/neuron-monitor) is not installed.
 */
export function NeuronEmptyState({ isLoading, height = 256 }: { isLoading?: boolean; height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-dashed border-gridline px-4 text-center text-xs text-ink-muted"
      style={{ height }}
    >
      <p className="max-w-md leading-relaxed">
        {isLoading ? (
          "Loading…"
        ) : (
          <>
            No Neuron metrics right now. Either no Inferentia / Trainium node is in the cluster, or the
            neuron-monitor DaemonSet is not running — install it from{" "}
            <code className="text-ink-secondary">components/o11y/neuron-monitor</code>. Neuron pools are
            not visible to the DCGM (GPU) exporter.
          </>
        )}
      </p>
    </div>
  );
}
