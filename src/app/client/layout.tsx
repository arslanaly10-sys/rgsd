import { AppShell } from "@/components/app-shell";
import { requireSession } from "@/lib/auth";
import { clientBadges } from "@/lib/queries";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession("client");
  const badges = await clientBadges(s);
  return <AppShell session={s} area="client" badges={badges}>{children}</AppShell>;
}
