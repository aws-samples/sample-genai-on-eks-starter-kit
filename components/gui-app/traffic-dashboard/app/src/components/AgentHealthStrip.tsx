"use client";

import { useEffect, useState } from "react";
import { AgentState, AgentStatus, useAgentHealth } from "@/lib/agents";
import { REFRESH_MS } from "@/lib/useSeries";
import { INK, STATUS, STATUS_GLYPH, STATUS_LABEL } from "@/lib/theme";

const KIND_LABEL = { daemonset: "DaemonSet", deployment: "Deployment", statefulset: "StatefulSet" } as const;

const STATE_GLYPH: Record<AgentState, string> = { ...STATUS_GLYPH, absent: "○" };
const STATE_LABEL: Record<AgentState, string> = { ...STATUS_LABEL, absent: "Not installed" };
const STATE_COLOR: Record<AgentState, string> = { ...STATUS, absent: INK.muted };

const PANEL_ID = "agents-panel";

/**
 * Header strip: is the telemetry pipeline itself healthy? Collapsed by default
 * to a single row — heading, state counts, and only the agents that need
 * attention. Expand it to see every agent grouped (DaemonSets on every node,
 * the Prometheus stack, Tempo, Langfuse) as chips showing ready/desired, with
 * scrape health and restarts folded into the state. Status is glyph + text;
 * colour only reinforces it. Hover, focus or click a chip for the detail.
 */
export function AgentHealthStrip() {
  const { groups, counts, isLoading, error } = useAgentHealth();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);

  const installed = Object.entries(counts)
    .filter(([state]) => state !== "absent")
    .reduce((sum, [, n]) => sum + n, 0);
  const attention = groups.flatMap((g) => g.statuses).filter((s) => s.state !== "good" && s.state !== "absent");

  // A pinned chip detail closes on click elsewhere or Escape.
  useEffect(() => {
    if (pinned === null) return;
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-agent-chip]")) setPinned(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(null);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  const toggle = () => {
    setOpen((o) => !o);
    setPinned(null);
  };

  return (
    <section aria-labelledby="agents-heading" className="rounded-2xl bg-surface px-5 py-3 ring-1 ring-white/10">
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <h1 id="agents-heading" className="text-sm font-semibold tracking-tight text-ink">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={PANEL_ID}
              onClick={toggle}
              className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <Chevron open={open} />
              <span>Agents &amp; collectors</span>
            </button>
          </h1>
          <Summary counts={counts} installed={installed} isLoading={isLoading} error={error} />

          {!open && attention.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Agents needing attention">
              {attention.map((s) => (
                <AgentChip key={chipKey(s)} status={s} isLoading={isLoading} pinned={pinned} setPinned={setPinned} />
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={PANEL_ID}
          onClick={toggle}
          className="shrink-0 rounded-md py-0.5 text-xs text-ink-secondary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-white/40"
        >
          {open ? "Hide details" : `Show all ${installed + counts.absent}`}
        </button>
      </div>

      {open && (
        <div id={PANEL_ID} className="mt-3 flex flex-wrap items-start gap-x-8 gap-y-3 border-t border-white/10 pt-3">
          {groups.map(({ group, statuses }) => (
            <div key={group.id} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                {group.label}
              </span>
              {statuses.map((s) => (
                <AgentChip key={chipKey(s)} status={s} isLoading={isLoading} pinned={pinned} setPinned={setPinned} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const chipKey = (s: AgentStatus) => `${s.def.namespace}/${s.def.name}`;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

function Summary({
  counts,
  installed,
  isLoading,
  error,
}: {
  counts: Record<AgentState, number>;
  installed: number;
  isLoading: boolean;
  error: Error | undefined;
}) {
  if (error) {
    return (
      <span className="text-xs text-ink-secondary" title={error.message}>
        Unavailable: {error.message}
      </span>
    );
  }
  if (isLoading && installed === 0) {
    return <span className="text-xs text-ink-muted">···</span>;
  }
  const parts = (["good", "warning", "serious", "critical", "absent"] as const)
    .map((state) => ({ state, n: counts[state] }))
    .filter((p) => p.n > 0 || p.state === "good");

  return (
    <span
      className="flex flex-wrap items-center gap-x-3 text-xs"
      title={`kube-state-metrics + scrape targets, refreshed every ${REFRESH_MS / 1000}s`}
    >
      {parts.map((p) => (
        <span key={p.state} className="flex items-center gap-1 text-ink-secondary">
          <span aria-hidden="true" style={{ color: STATE_COLOR[p.state] }}>
            {STATE_GLYPH[p.state]}
          </span>
          <span className="tabular">{p.n}</span>
          <span>{STATE_LABEL[p.state].toLowerCase()}</span>
        </span>
      ))}
    </span>
  );
}

function AgentChip({
  status,
  isLoading,
  pinned,
  setPinned,
}: {
  status: AgentStatus;
  isLoading: boolean;
  pinned: string | null;
  setPinned: (key: string | null) => void;
}) {
  const { def, state, reason, desired, ready, scrapeUp, scrapeTargets, restarts1h } = status;
  const pending = isLoading && desired === null;
  const count = pending ? "…" : desired === null ? "" : `${ready ?? 0}/${desired}`;
  const key = chipKey(status);
  const tooltipId = `agent-tip-${def.namespace}-${def.name}`;
  const isPinned = pinned === key;

  const togglePinned = () => setPinned(isPinned ? null : key);

  return (
    <div
      role="button"
      tabIndex={0}
      data-agent-chip
      aria-expanded={isPinned}
      aria-describedby={tooltipId}
      onClick={togglePinned}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          togglePinned();
        }
      }}
      className={`group relative flex cursor-pointer items-center gap-1.5 rounded-full bg-surface-raised px-2.5 py-1 text-xs ring-1 outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
        isPinned ? "ring-white/40" : "ring-white/10"
      } ${state === "absent" ? "opacity-60" : ""}`}
    >
      <span
        aria-hidden="true"
        className="text-[10px] leading-none"
        style={{ color: STATE_COLOR[pending ? "absent" : state] }}
      >
        {STATE_GLYPH[pending ? "absent" : state]}
      </span>
      <span className="text-ink">{def.label}</span>
      {count && <span className="tabular text-ink-secondary">{count}</span>}
      {!pending && reason && state !== "absent" && <span className="text-ink-muted">· {reason}</span>}
      <span className="sr-only">{`, ${STATE_LABEL[state]}`}</span>

      <div
        role="tooltip"
        id={tooltipId}
        className={`absolute left-1/2 top-full z-30 mt-1.5 w-72 -translate-x-1/2 rounded-xl bg-surface p-3 text-left shadow-xl ring-1 ring-white/10 ${
          isPinned ? "block" : "pointer-events-none hidden group-hover:block group-focus-visible:block"
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-ink">{def.label}</span>
          <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: STATE_COLOR[state] }}>
            <span aria-hidden="true">{STATE_GLYPH[state]}</span>
            <span>{STATE_LABEL[state]}</span>
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-ink-muted" title={`${def.namespace}/${def.name}`}>
          {KIND_LABEL[def.kind]} · {def.namespace}/{def.name}
        </p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <dt className="text-ink-muted">Rollout</dt>
          <dd className="tabular text-ink-secondary">
            {desired === null
              ? "no kube-state-metrics series"
              : `${ready ?? 0} of ${desired} ${def.kind === "daemonset" ? "nodes" : "replicas"} ready`}
          </dd>
          <dt className="text-ink-muted">Scrape</dt>
          <dd className="tabular text-ink-secondary">
            {def.jobs === undefined
              ? "not scraped directly"
              : scrapeTargets === null
                ? "no targets discovered"
                : `${scrapeUp ?? 0} of ${scrapeTargets} targets up`}
          </dd>
          <dt className="text-ink-muted">Restarts</dt>
          <dd className="tabular text-ink-secondary">{Math.round(restarts1h)} in the last hour</dd>
        </dl>
        <p className="mt-2 text-[11px] text-ink-secondary">{def.role}</p>
      </div>
    </div>
  );
}
