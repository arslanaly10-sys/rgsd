import { DocReviewPage } from "@/components/quality/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("client");
  return <DocReviewPage s={s} base="/client" msg={(await searchParams).msg} />;
}
