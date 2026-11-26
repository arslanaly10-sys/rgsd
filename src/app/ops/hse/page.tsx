import { HsePage } from "@/components/quality/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  return <HsePage s={s} base="/ops" msg={(await searchParams).msg} />;
}
