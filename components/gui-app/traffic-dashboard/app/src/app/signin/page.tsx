import { signIn } from "@/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-6">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 ring-1 ring-white/10">
        <h1 className="text-lg font-semibold tracking-tight text-ink">Agentic Traffic Studio</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
          Network, LLM and L7 telemetry for the agentic AI platform. Sign in with your platform identity to
          continue.
        </p>
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("keycloak", { redirectTo: callbackUrl || "/" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-xl bg-surface-raised px-4 py-2.5 text-sm font-medium text-ink ring-1 ring-white/10 transition-colors hover:bg-white/10"
          >
            Sign in with Keycloak
          </button>
        </form>
        <p className="mt-4 text-[11px] leading-relaxed text-ink-muted">
          Authentication is handled by the platform Keycloak realm. Prometheus is never exposed to the
          browser — all queries are proxied server-side.
        </p>
      </div>
    </main>
  );
}
