import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Scanner } from "@/components/field/scanner";

export default async function Scan() {
  const t = await getTranslations("field");
  return (
    <>
      <header className="bg-ink px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
        <Link href="/field" className="text-xs text-white/60">← {t("back")}</Link>
        <h1 className="mt-2 text-xl font-semibold">{t("scan")}</h1>
        <p className="text-xs text-white/60">{t("scanHelp")}</p>
      </header>
      <Scanner />
    </>
  );
}
