import { AppShell } from "@/components/app-shell";
import { requireSession } from "@/lib/auth";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession("client");
  return <AppShell session={s} area="client">{children}</AppShell>;
}
