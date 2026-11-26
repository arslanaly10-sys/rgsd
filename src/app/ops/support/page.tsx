import { SupportPage } from "@/components/commercial/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  return <SupportPage s={s} base="/ops" msg={(await searchParams).msg} />;
}
