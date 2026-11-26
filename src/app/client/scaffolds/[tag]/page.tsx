import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadScaffold, ScaffoldDetail } from "@/components/scaffold-detail";
import { PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";

export default async function Page({ params }: { params: Promise<{ tag: string }> }) {
  const s = await requireSession("client");
  const t = await getTranslations();
  const tag = decodeURIComponent((await params).tag).toUpperCase();
  if (!/^[A-Z]{3}-\d{4}$/.test(tag)) notFound();
  const data = await loadScaffold(s, tag); // RLS: only this client's scaffolds
  if (!data) notFound();
  return (
    <>
      <Link href="/client/scaffolds" className="text-sm text-muted hover:text-ink">← {t("nav.scaffolds")}</Link>
      <PageHeader title={tag} sub={data.sc.location_desc ?? undefined} />
      <ScaffoldDetail data={data} staff={false} />
    </>
  );
}
