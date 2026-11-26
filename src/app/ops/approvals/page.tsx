import { getLocale, getTranslations } from "next-intl/server";
import { Card, PageHeader, Pill, statusTone } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { fmtDate, type Loc } from "@/lib/format";
import { approvalsList } from "@/lib/queries";

export default async function Page() {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const list = await approvalsList(s);
  return (
    <>
      <PageHeader title={t("nav.approvals")} sub={t("pages.approvalsSub")} />
      {list.length === 0 ? (
        <Card><p className="py-6 text-center text-sm text-muted">{t("approvals.empty")}</p></Card>
      ) : (
        <div className="grid gap-3">
          {list.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><Pill tone="dark">{a.tool}</Pill><Pill tone={a.tier >= 3 ? "red" : "yellow"}>{t("approvals.tier", { tier: a.tier })}</Pill><Pill tone={statusTone(a.status)}>{t(`status.${a.status}`)}</Pill></div>
                  <p className="mt-2 text-sm font-medium">{l === "ar" && a.summary_ar ? a.summary_ar : a.summary}</p>
                  <p className="mt-1 text-xs text-muted">{fmtDate(a.created_at, l)}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
