import { InspectionsPage } from "@/components/quality/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("client");
  return <InspectionsPage s={s} base="/client" msg={(await searchParams).msg} />;
}
