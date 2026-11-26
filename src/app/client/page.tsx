import { ClientOverview } from "@/components/client/overview";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ClientHome({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("client");
  return <ClientOverview s={s} msg={(await searchParams).msg} />;
}
