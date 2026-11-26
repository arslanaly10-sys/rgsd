import { TriagePage } from "@/components/delivery/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  return <TriagePage s={s} base="/ops" msg={(await searchParams).msg} />;
}
