import { signOut } from "@/auth";

interface TopNavProps {
  user?: { name?: string | null; email?: string | null };
}

/** Sidebar-less top navigation: brand, identity + sign-out. Section navigation
 *  lives in the tab strip inside DashboardBody. */
export function TopNav({ user }: TopNavProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-page/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-6">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight text-ink">Agentic Traffic Studio</span>
          <span className="hidden text-[11px] text-ink-muted sm:inline">eBPF · vLLM · NFM</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {user && (
            <span className="hidden text-xs text-ink-muted sm:inline" title={user.email ?? undefined}>
              {user.name || user.email}
            </span>
          )}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button
              type="submit"
              className="rounded-lg px-2.5 py-1.5 text-xs text-ink-secondary ring-1 ring-white/10 transition-colors hover:bg-surface hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
