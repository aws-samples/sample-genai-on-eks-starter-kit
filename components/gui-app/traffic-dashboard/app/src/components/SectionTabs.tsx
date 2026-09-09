"use client";

import { KeyboardEvent, useEffect, useRef } from "react";
import { SECTIONS } from "@/lib/sections";

interface SectionTabsProps {
  active: string;
  onChange: (id: string) => void;
}

/**
 * WAI-ARIA tab strip for the dashboard sections. Roving tabindex: only the
 * selected tab is in the tab order, Left/Right/Home/End move between tabs and
 * activate them (automatic activation — the panel follows focus).
 */
export function SectionTabs({ active, onChange }: SectionTabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // On narrow viewports the strip scrolls horizontally; keep the selected tab
  // visible when it changes via deep link, keyboard or Back/Forward.
  useEffect(() => {
    const index = SECTIONS.findIndex((s) => s.id === active);
    refs.current[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = SECTIONS.length;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % count;
        break;
      case "ArrowLeft":
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
    <div
      role="tablist"
      aria-label="Dashboard sections"
      className="-mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {SECTIONS.map((section, index) => {
        const selected = section.id === active;
        return (
          <button
            key={section.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${section.id}`}
            aria-selected={selected}
            aria-controls={`panel-${section.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(section.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-xs transition-colors ${
              selected
                ? "border-accent font-medium text-ink"
                : "border-transparent text-ink-secondary hover:border-white/20 hover:text-ink"
            }`}
          >
            {section.label}
          </button>
        );
      })}
    </div>
  );
}
