import { auth } from "@/auth";
import { DashboardBody } from "@/components/DashboardBody";
import { UserMenu } from "@/components/UserMenu";

// Rendered per request: the session and the deep-link domain are runtime values.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const domain = process.env.DOMAIN ?? "";

  // UserMenu is a server component (sign-out is a server action); it is passed
  // into the client-side shell as a node and rendered inside the page header.
  return <DashboardBody domain={domain} userMenu={<UserMenu user={session?.user ?? undefined} />} />;
}
