interface DeepLinksProps {
  /** Platform domain, e.g. example.people.aws.dev. */
  domain: string;
}

/**
 * Hand-off to the tools that own the detail this dashboard summarises. Beyla
 * propagates the W3C traceparent, so a slow span in Tempo maps 1:1 to the
 * Langfuse observation for the same trace_id.
 */
export function DeepLinks({ domain }: DeepLinksProps) {
  const grafana = `https://grafana.${domain}/grafana/`;
  const links = [
    {
      title: "Grafana",
      description: "The full Agentic Traffic Overview dashboard, alerting, and every other panel in the stack.",
      href: grafana,
    },
    {
      title: "Langfuse",
      description: "LLM call stack: prompt, completion, token usage, cost and evaluation scores per trace.",
      href: `https://langfuse.${domain}`,
    },
    {
      title: "Tempo (Grafana Explore)",
      description: "Distributed traces from Beyla eBPF spans — search by trace_id or service to follow a request.",
      href: `${grafana}explore?left=${encodeURIComponent(JSON.stringify({ datasource: "tempo", queries: [{ queryType: "traceql", query: "{}" }], range: { from: "now-1h", to: "now" } }))}`,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {links.map((link) => (
        <a
          key={link.title}
          href={link.href}
          target="_blank"
          rel="noreferrer noopener"
          className="group rounded-2xl bg-surface p-5 ring-1 ring-white/10 transition-colors hover:bg-surface-raised"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-ink">{link.title}</h3>
            <span aria-hidden="true" className="text-xs text-ink-muted transition-colors group-hover:text-ink">
              ↗
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{link.description}</p>
        </a>
      ))}
    </div>
  );
}
