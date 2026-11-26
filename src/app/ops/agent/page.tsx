import { MyAgentPage } from "@/components/agent/my-agent";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  return <MyAgentPage s={s} msg={(await searchParams).msg} />;
}
