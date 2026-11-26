import { redirect } from "next/navigation";
import { HubPage } from "@/components/admin/pages";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string; who?: string }> }) {
  const s = await requireSession("staff");
  if (s.role !== "admin") redirect("/ops");
  const sp = await searchParams;
  return <HubPage s={s} />;
}
