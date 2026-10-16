import { auth } from "@/auth";
import { DashboardBody } from "@/components/DashboardBody";
import { TopNav } from "@/components/TopNav";

// Rendered per request: the session and the deep-link domain are runtime values.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const domain = process.env.DOMAIN ?? "";

  return (
    <>
      <TopNav user={session?.user ?? undefined} />
      <main>
        <DashboardBody domain={domain} />
      </main>
    </>
  );
}
