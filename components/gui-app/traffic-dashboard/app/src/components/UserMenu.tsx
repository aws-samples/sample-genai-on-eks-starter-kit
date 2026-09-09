import { signOut } from "@/auth";

interface UserMenuProps {
  user?: { name?: string | null; email?: string | null };
}

/** Identity + sign-out for the right end of the page header. Server component
 *  (sign-out is a server action), handed to DashboardBody as a node. */
export function UserMenu({ user }: UserMenuProps) {
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs">
      {user && (
        <span className="hidden text-ink-muted sm:inline" title={user.email ?? undefined}>
          {user.name || user.email}
        </span>
      )}
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/signin" });
        }}
      >
        <button type="submit" className="rounded-md px-1.5 py-1 text-ink-secondary transition-colors hover:text-ink">
          Sign out
        </button>
      </form>
    </div>
  );
}
