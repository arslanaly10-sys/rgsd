import { redirect } from "next/navigation";
import { TeamAgentsPage } from "@/components/agent/my-agent";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  if (!["admin", "ops_manager"].includes(s.role)) redirect("/ops/agent");
  return <TeamAgentsPage s={s} msg={(await searchParams).msg} />;
}
