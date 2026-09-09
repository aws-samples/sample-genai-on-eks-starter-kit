"use client";

import { useCallback, useEffect, useState } from "react";
import { AtAGlance } from "./sections/AtAGlance";
import { NetworkStructure } from "./sections/NetworkStructure";
import { LlmPerformance } from "./sections/LlmPerformance";
import { CacheHitRate } from "./sections/CacheHitRate";
import { L7Red } from "./sections/L7Red";
import { ServiceMapSection } from "./sections/ServiceMapSection";
import { AcceleratorSection } from "./sections/AcceleratorSection";
import { DeepLinks } from "./sections/DeepLinks";
import { SectionTabs } from "./SectionTabs";
import { AgentHealthStrip } from "./AgentHealthStrip";
import { DEFAULT_SECTION_ID, getSection, isSectionId } from "@/lib/sections";

const WINDOWS = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
] as const;

/** Sections whose panels take the time window; the switcher is dimmed elsewhere. */
const WINDOWED_SECTIONS = new Set(["at-a-glance", "network", "llm", "cache", "l7", "gpu"]);

/**
 * Reads the active tab from the URL fragment so `#llm` style deep links keep
 * working and the browser back/forward buttons move between tabs. The server
 * render has no fragment, so it always paints the default tab and the client
 * corrects itself on mount.
 */
function useActiveSection(): [string, (id: string) => void] {
  const [active, setActive] = useState<string>(DEFAULT_SECTION_ID);

  useEffect(() => {
    const readHash = () => {
      const id = window.location.hash.slice(1);
      if (isSectionId(id)) setActive(id);
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  const select = useCallback((id: string) => {
    setActive(id);
    // pushState rather than assigning location.hash: the latter scrolls to the
    // element with that id, which would jump past the sticky tab strip. pushState
    // still records a history entry so Back returns to the previous tab.
    if (window.location.hash !== `#${id}`) {
      window.history.pushState(null, "", `#${id}`);
    }
  }, []);

  return [active, select];
}

export function DashboardBody({ domain }: { domain: string }) {
  const [minutes, setMinutes] = useState<number>(60);
  const [active, setActive] = useActiveSection();
  const section = getSection(active);
  const windowed = WINDOWED_SECTIONS.has(active);

  return (
    <div className="mx-auto max-w-[1600px] px-6 pb-10 pt-8">
      {/* Header: the health of the telemetry pipeline itself. If a collector is
          down, every panel below it is suspect, so that is the first thing shown. */}
      <div className="mb-4">
        <AgentHealthStrip />
      </div>

      {/* Tab strip + time window share one sticky row directly under the top nav
          (h-14), so both stay reachable while a long panel scrolls. */}
      <div className="sticky top-14 z-10 -mx-6 mb-6 border-b border-white/10 bg-page/85 px-6 backdrop-blur">
        <div className="flex items-center gap-4">
          <SectionTabs active={active} onChange={setActive} />
          <div
            className={`my-1.5 flex shrink-0 items-center gap-1 rounded-xl bg-surface p-1 ring-1 ring-white/10 transition-opacity ${
              windowed ? "" : "opacity-40"
            }`}
            title={windowed ? "Time window" : "This tab shows the current state; the time window does not apply."}
          >
            {WINDOWS.map((w) => (
              <button
                key={w.label}
                type="button"
                onClick={() => setMinutes(w.minutes)}
                aria-pressed={minutes === w.minutes}
                className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                  minutes === w.minutes
                    ? "bg-surface-raised font-medium text-ink"
                    : "text-ink-secondary hover:text-ink"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section
        key={section.id}
        role="tabpanel"
        id={`panel-${section.id}`}
        aria-labelledby={`tab-${section.id}`}
      >
        <div className="mb-4">
          <h2 className="text-sm font-semibold tracking-tight text-ink">{section.title}</h2>
          <p className="mt-0.5 text-xs text-ink-muted">{section.description}</p>
        </div>
        <SectionPanel id={section.id} minutes={minutes} domain={domain} />
      </section>
    </div>
  );
}

/**
 * Only the active panel is mounted. Inactive panels therefore stop polling
 * Prometheus; SWR keeps their last response cached, so switching back paints
 * the previous data immediately and revalidates in the background.
 */
function SectionPanel({ id, minutes, domain }: { id: string; minutes: number; domain: string }) {
  switch (id) {
    case "at-a-glance":
      return <AtAGlance minutes={minutes} />;
    case "network":
      return <NetworkStructure minutes={minutes} />;
    case "llm":
      return <LlmPerformance minutes={minutes} />;
    case "cache":
      return <CacheHitRate minutes={minutes} />;
    case "l7":
      return <L7Red minutes={minutes} />;
    case "service-map":
      return <ServiceMapSection />;
    case "gpu":
      return <AcceleratorSection minutes={minutes} />;
    case "links":
      return <DeepLinks domain={domain} />;
    default:
      return null;
  }
}
