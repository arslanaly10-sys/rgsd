import { StatementPage } from "@/components/commercial/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string; client?: string }> }) {
  const s = await requireSession("client");
  const sp = await searchParams;
  return <StatementPage s={s} base="/client" msg={sp.msg} client={sp.client} />;
}
