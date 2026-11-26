import { AppShell } from "@/components/app-shell";
import { requireSession } from "@/lib/auth";
import { navBadges } from "@/lib/queries";

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession("staff");
  const badges = await navBadges(s);
  return <AppShell session={s} area="ops" badges={badges}>{children}</AppShell>;
}
