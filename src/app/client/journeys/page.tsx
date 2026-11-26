import { JourneysPage } from "@/components/agent/handoffs";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
  const s = await requireSession("client");
  return <JourneysPage s={s} chain={(await searchParams).chain} />;
}
