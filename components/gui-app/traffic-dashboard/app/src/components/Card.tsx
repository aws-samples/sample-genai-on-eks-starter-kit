"use client";

import { ReactNode } from "react";
import { usePortletSized } from "./PortletGrid";

interface CardProps {
  title: string;
  /** One-line explanation of what the panel measures. */
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Rounded-2xl surface on the page background with a hairline ring. Fills its
 * grid cell; when the enclosing portlet has a user-set height the body becomes
 * the flexible part — charts stretch into it and anything taller scrolls.
 */
export function Card({ title, subtitle, action, children, className = "" }: CardProps) {
  const sized = usePortletSized();
  return (
    <section
      className={`flex h-full min-h-0 flex-col rounded-2xl bg-surface ring-1 ring-white/10 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ${className}`}
    >
      <header className="mb-4 flex shrink-0 items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-ink">{title}</h2>
          {subtitle && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className={sized ? "flex min-h-0 flex-1 flex-col overflow-auto" : ""}>{children}</div>
    </section>
  );
}
