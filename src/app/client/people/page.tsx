import { redirect } from "next/navigation";
import { PeoplePage } from "@/components/admin/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("client");
  if (s.role !== "client_admin") redirect("/client");
  return <PeoplePage s={s} msg={(await searchParams).msg} />;
}
