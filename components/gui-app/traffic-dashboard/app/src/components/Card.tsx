import { ReactNode } from "react";

interface CardProps {
  title: string;
  /** One-line explanation of what the panel measures. */
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Rounded-2xl surface on the page background with a hairline ring. */
export function Card({ title, subtitle, action, children, className = "" }: CardProps) {
  return (
    <section
      className={`rounded-2xl bg-surface ring-1 ring-white/10 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ${className}`}
    >
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-ink">{title}</h2>
          {subtitle && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
