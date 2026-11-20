"use client";

/**
 * Shared no-data copy for the GPU panels.
 *
 * An empty result here is the normal state much of the time, not a fault: the
 * GLM workloads are KEDA-scaled to zero outside weekday business hours, and
 * Karpenter then removes the GPU nodes along with their DCGM exporters. The copy
 * says so, so nobody goes looking for a broken exporter at 02:00.
 */
export function GpuEmptyState({ isLoading, height = 256 }: { isLoading?: boolean; height?: number }) {
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
            No GPU metrics right now. GPU workloads scale to zero outside weekday business hours
            (09:00–18:00 KST), which removes the GPU nodes and their DCGM exporters — so an empty
            panel here is expected when nothing is scheduled. If GPU pods <em>are</em> running,
            check that the NVIDIA GPU Operator&apos;s DCGM exporter is being scraped.
          </>
        )}
      </p>
    </div>
  );
}
