import { getTranslations } from "next-intl/server";
import { ScaffoldRegister } from "@/components/scaffold-register";
import { PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession("staff");
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t("nav.scaffolds")} sub={t("pages.scaffoldsSub")} />
      <ScaffoldRegister session={s} searchParams={await searchParams} basePath="/ops/scaffolds" />
    </>
  );
}
