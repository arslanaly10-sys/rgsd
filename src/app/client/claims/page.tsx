import { ClaimsPage } from "@/components/commercial/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("client");
  return <ClaimsPage s={s} base="/client" msg={(await searchParams).msg} />;
}
