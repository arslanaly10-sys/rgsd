import { getTranslations } from "next-intl/server";
import { Card, PageHeader, Pill, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { policies } from "@/lib/queries";

export default async function Page() {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const list = await policies(s);
  const tone = (tier: number) => (tier === 0 ? "green" : tier === 1 ? "neutral" : tier === 2 ? "yellow" : "red") as "green" | "neutral" | "yellow" | "red";
  return (
    <>
      <PageHeader title={t("nav.agents")} sub={t("pages.agentsSub")} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((tier) => (
          <div key={tier} className="rounded-xl border border-line bg-panel p-4">
            <Pill tone={tone(tier)}>T{tier}</Pill>
            <p className="mt-2 text-sm">{t(`tiers.${tier}`)}</p>
          </div>
        ))}
      </div>
      <Card>
        <Table head={["Tool", "Tier", "Who can trigger", "Runs without approval for", "Approvers"]}>
          {list.map((p) => (
            <tr key={p.tool}>
              <Td><div className="font-mono text-[12.5px] font-medium">{p.tool}</div><div className="text-xs text-muted">{p.description}</div></Td>
              <Td><Pill tone={tone(p.tier)}>T{p.tier}</Pill></Td>
              <Td className="max-w-[260px] text-xs text-muted">{p.allowed_roles.map((r) => t(`roles.${r}`)).join(", ")}</Td>
              <Td className="text-xs text-muted">{p.tier <= 1 ? "Everyone allowed" : p.auto_roles.map((r) => t(`roles.${r}`)).join(", ") || "Nobody"}</Td>
              <Td className="text-xs text-muted">{p.approver_roles.map((r) => t(`roles.${r}`)).join(", ") || "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
