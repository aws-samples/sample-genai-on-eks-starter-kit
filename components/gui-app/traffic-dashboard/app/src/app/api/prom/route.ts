import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Server-side Prometheus proxy. Prometheus is never exposed to the browser:
 * the pod-internal URL stays in PROMETHEUS_URL and every request here requires
 * an authenticated Auth.js session.
 *
 * NOTE: the default service name assumes kube-prometheus-stack installed with
 * release name `prometheus` in the `monitoring` namespace (what
 * components/nvidia-platform/monitoring installs). Override PROMETHEUS_URL if
 * the release name differs.
 */
const PROMETHEUS_URL =
  process.env.PROMETHEUS_URL || "http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090";

const MAX_POINTS = 240;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const query = params.get("query");
  if (!query) {
    return NextResponse.json({ error: "Missing 'query' parameter" }, { status: 400 });
  }

  const type = params.get("type") === "range" ? "range" : "instant";
  // PROMETHEUS_URL may carry a route prefix (e.g. .../prometheus). Append the
  // API path instead of new URL(path, base), which discards the base's path.
  const upstream = new URL(
    `${PROMETHEUS_URL.replace(/\/+$/, "")}/api/v1/${type === "range" ? "query_range" : "query"}`,
  );
  upstream.searchParams.set("query", query);

  if (type === "range") {
    const minutes = clampMinutes(Number(params.get("minutes") ?? 60));
    const end = Math.floor(Date.now() / 1000);
    const start = end - minutes * 60;
    // Keep the payload bounded regardless of window: at most MAX_POINTS points,
    // and never a step finer than 15s (the scrape interval).
    const step = Math.max(15, Math.ceil((minutes * 60) / MAX_POINTS));
    upstream.searchParams.set("start", String(start));
    upstream.searchParams.set("end", String(end));
    upstream.searchParams.set("step", String(step));
  }

  try {
    const res = await fetch(upstream, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    // Prometheus answers requests outside its routePrefix with a plain-text
    // "404 page not found"; parse defensively so a wrong PROMETHEUS_URL shows
    // up as "Prometheus returned 404 at …" instead of a JSON syntax error.
    const text = await res.text();
    let body: { status?: string; data?: unknown; error?: string };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      return NextResponse.json(
        { error: `Prometheus returned ${res.status} (non-JSON) at ${upstream.origin}${upstream.pathname}: ${text.slice(0, 120).trim()}` },
        { status: 502 },
      );
    }

    if (!res.ok || body.status !== "success") {
      return NextResponse.json(
        { error: body.error || `Prometheus returned ${res.status}` },
        { status: res.ok ? 502 : res.status },
      );
    }
    return NextResponse.json(body.data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prometheus request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function clampMinutes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 60;
  return Math.min(Math.max(Math.round(value), 5), 24 * 60);
}
