"use client";

import { ReactNode, useCallback, useEffect, useState } from "react";
import { AtAGlance } from "./sections/AtAGlance";
import { NetworkStructure } from "./sections/NetworkStructure";
import { LlmPerformance } from "./sections/LlmPerformance";
import { CacheHitRate } from "./sections/CacheHitRate";
import { L7Red } from "./sections/L7Red";
import { ServiceMapSection } from "./sections/ServiceMapSection";
import { AcceleratorSection } from "./sections/AcceleratorSection";
import { DeepLinks } from "./sections/DeepLinks";
import { Sidebar } from "./Sidebar";
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
 * Reads the active section from the URL fragment so `#llm` style deep links keep
 * working and the browser back/forward buttons move between sections. The server
 * render has no fragment, so it always paints the default section and the client
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
    // element with that id, which would jump past the sticky header rows. pushState
    // still records a history entry so Back returns to the previous section.
    if (window.location.hash !== `#${id}`) {
      window.history.pushState(null, "", `#${id}`);
    }
  }, []);

  return [active, select];
}

/**
 * Page shell: the collapsible navigation rail on the left; on the right a single
 * sticky header (section title, time window, identity/sign-out — the last is a
 * server node) above the scrolling content column.
 */
export function DashboardBody({ domain, userMenu }: { domain: string; userMenu?: ReactNode }) {
  const [minutes, setMinutes] = useState<number>(60);
  const [active, setActive] = useActiveSection();
  const section = getSection(active);
  const windowed = WINDOWED_SECTIONS.has(active);

  return (
    <div className="flex min-h-screen">
      <Sidebar active={active} onChange={setActive} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-page/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-4 px-6">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold tracking-tight text-ink">{section.title}</h2>
              <p className="truncate text-xs text-ink-muted" title={section.description}>
                {section.description}
              </p>
            </div>

            {/* Time window: a plain segmented control, dimmed where the section shows current state only. */}
            <div
              role="group"
              aria-label="Time window"
              className={`flex shrink-0 items-center gap-0.5 rounded-lg bg-surface p-0.5 transition-opacity ${windowed ? "" : "opacity-40"}`}
              title={windowed ? undefined : "This section shows the current state; the time window does not apply."}
            >
              {WINDOWS.map((w) => (
                <button
                  key={w.label}
                  type="button"
                  onClick={() => setMinutes(w.minutes)}
                  aria-pressed={minutes === w.minutes}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    minutes === w.minutes ? "bg-surface-raised font-medium text-ink" : "text-ink-secondary hover:text-ink"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>

            {userMenu}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-6 pb-10 pt-5">
          {/* The health of the telemetry pipeline itself comes first: if a collector
              is down, every panel below it is suspect. */}
          <div className="mb-5">
            <AgentHealthStrip />
          </div>

          <section
            key={section.id}
            role="tabpanel"
            id={`panel-${section.id}`}
            aria-labelledby={`tab-${section.id}`}
          >
            <SectionPanel id={section.id} minutes={minutes} domain={domain} />
          </section>
        </main>
      </div>
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
