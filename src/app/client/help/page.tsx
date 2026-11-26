import { HelpPage } from "@/components/commercial/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("client");
  return <HelpPage s={s} base="/client" msg={(await searchParams).msg} />;
}
