"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { SECTIONS, SECTION_GROUPS } from "@/lib/sections";
import { Chevrons, SectionIcon } from "./SectionIcons";

interface SidebarProps {
  active: string;
  onChange: (id: string) => void;
}

const STORAGE_KEY = "ats.sidebar.collapsed";
/** Below this width the rail opens collapsed unless the user has chosen otherwise. */
const NARROW_VIEWPORT = "(max-width: 1023px)";

/** Expanded / collapsed rail widths; DashboardBody does not need these because the rail sits in the same flex row. */
const WIDTH_EXPANDED = "w-60";
const WIDTH_COLLAPSED = "w-14";

/**
 * Left navigation rail in the Datadog style: brand at the top, section items
 * grouped under small headings, a collapse toggle pinned to the bottom. Collapsed
 * it is an icon-only rail and each item shows its label as a flyout on hover or
 * focus, so nothing is reachable in one state and not the other.
 *
 * Semantically it is still the dashboard's tablist (the panels are role=tabpanel
 * and point back here through aria-labelledby), just vertical: Up/Down/Home/End
 * move between items and activate them, and only the selected item is in the
 * tab order. Group headings are presentational.
 *
 * The collapsed preference lives in localStorage. The server render has no
 * access to it, so the first paint is always expanded and the client corrects
 * itself on mount; the transition is suppressed on that first pass so the rail
 * does not visibly snap.
 */
export function Sidebar({ active, onChange }: SidebarProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "1" || stored === "0") setCollapsed(stored === "1");
    else setCollapsed(window.matchMedia(NARROW_VIEWPORT).matches);
    // Enable the width transition only after the stored state has been applied.
    const frame = window.requestAnimationFrame(() => setHydrated(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      window.localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      return !c;
    });
  };

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = SECTIONS.length;
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = (index + 1) % count;
        break;
      case "ArrowUp":
        next = (index - 1 + count) % count;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(SECTIONS[next].id);
    refs.current[next]?.focus();
  }

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={`sticky top-0 z-30 flex h-screen shrink-0 flex-col border-r border-white/10 bg-surface ${
        collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED
      } ${hydrated ? "transition-[width] duration-200 ease-out motion-reduce:transition-none" : ""}`}
    >
      {/* Brand. The mark stays in the collapsed rail; the wordmark only fits expanded. */}
      <div className={`flex h-14 shrink-0 items-center border-b border-white/10 ${collapsed ? "justify-center" : "gap-2.5 px-4"}`}>
        <span
          aria-hidden="true"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/15 font-mono text-[11px] font-semibold text-accent ring-1 ring-accent/30"
        >
          ATS
        </span>
        {!collapsed && (
          <span className="min-w-0 truncate text-sm font-semibold tracking-tight text-ink">Agentic Traffic Studio</span>
        )}
      </div>

      {/* Sections. overflow-visible while collapsed so the label flyouts are not clipped;
          the rail's eight items fit any laptop height, so it does not need to scroll then. */}
      <nav
        role="tablist"
        aria-orientation="vertical"
        aria-label="Dashboard sections"
        className={`flex-1 py-3 ${collapsed ? "overflow-visible px-2" : "overflow-y-auto px-3"}`}
      >
        {SECTION_GROUPS.map((group, groupIndex) => {
          const items = SECTIONS.filter((s) => s.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className={groupIndex > 0 ? "mt-3" : ""}>
              {collapsed ? (
                groupIndex > 0 && <div aria-hidden="true" className="mx-2 mb-3 border-t border-white/10" />
              ) : (
                <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{group}</div>
              )}
              <ul className="space-y-0.5">
                {items.map((section) => {
                  const index = SECTIONS.indexOf(section);
                  const selected = section.id === active;
                  return (
                    <li key={section.id} className="relative">
                      <button
                        ref={(el) => {
                          refs.current[index] = el;
                        }}
                        type="button"
                        role="tab"
                        id={`tab-${section.id}`}
                        aria-selected={selected}
                        aria-controls={`panel-${section.id}`}
                        aria-label={collapsed ? section.label : undefined}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(section.id)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                        className={`group relative flex w-full items-center rounded-lg text-xs transition-colors ${
                          collapsed ? "h-9 justify-center" : "h-8 gap-2.5 px-2"
                        } ${
                          selected
                            ? "bg-surface-raised font-medium text-ink"
                            : "text-ink-secondary hover:bg-surface-raised/60 hover:text-ink"
                        }`}
                      >
                        {/* Selected marker on the left edge, the vertical counterpart of the old underline. */}
                        {selected && (
                          <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />
                        )}
                        <SectionIcon id={section.id} className={selected ? "shrink-0 text-accent" : "shrink-0 text-ink-muted group-hover:text-ink-secondary"} />
                        {!collapsed && <span className="truncate">{section.label}</span>}
                        {collapsed && (
                          <span
                            role="presentation"
                            className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-surface-raised px-2 py-1 text-[11px] font-medium text-ink opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                          >
                            {section.label}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle. */}
      <div className={`shrink-0 border-t border-white/10 py-2 ${collapsed ? "px-2" : "px-3"}`}>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={`flex h-8 w-full items-center rounded-lg text-xs text-ink-muted transition-colors hover:bg-surface-raised/60 hover:text-ink ${
            collapsed ? "justify-center" : "gap-2.5 px-2"
          }`}
        >
          <Chevrons direction={collapsed ? "right" : "left"} className="shrink-0" />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
