import Link from "next/link";
import { Card, Flash, Mono, PageHeader, Pill, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/auth";
import { reconcile } from "@/lib/fleet";
import { fmtNum, fmtSAR } from "@/lib/format";
import { runMaterialsCheck } from "@/lib/actions/fleet";

export default async function Reconciliation({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  const { msg } = await searchParams;
  const gaps = await reconcile(s);
  return (
    <>
      <Link href="/ops/fleet" className="text-sm text-muted hover:text-ink">← Fleet & logistics</Link>
      <PageHeader title="Material reconciliation" sub="For every site and item: delivered − returned should equal what is on hire. A gap means material on site that nobody is billing (or that is lost), or rental charged on material that already came back."
        actions={<form action={runMaterialsCheck}><SubmitButton className="rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-white" pending="Checking…">Create tasks for gaps</SubmitButton></form>} />
      <Flash msg={msg} />
      <Card>
        <Table head={["Site", "Item", "Delivered", "Returned", "Should be on site", "On hire", "Gap", "What it means"]} empty={gaps.length ? undefined : "Everything matches."}>
          {gaps.map((g) => (
            <tr key={`${g.site_code}${g.sku}`}>
              <Td><Mono>{g.site_code}</Mono></Td>
              <Td><Mono>{g.sku}</Mono><div className="text-xs text-muted">{g.item}</div></Td>
              <Td className="tabular">{fmtNum(g.delivered, "en")}</Td>
              <Td className="tabular">{fmtNum(g.returned, "en")}</Td>
              <Td className="tabular">{fmtNum(g.expected_on_site, "en")}</Td>
              <Td className="tabular">{fmtNum(g.on_hire, "en")}</Td>
              <Td className={`tabular font-semibold ${g.variance > 0 ? "text-tag-yellow" : "text-tag-red"}`}>{g.variance > 0 ? "+" : ""}{fmtNum(g.variance, "en")}</Td>
              <Td className="max-w-[300px] text-sm">{g.kind === "unbilled_or_lost" ? <><Pill tone="yellow">unbilled or lost</Pill> <span className="text-muted">≈ {fmtSAR(g.value, "en")} of stock</span></> : <><Pill tone="red">over-billing</Pill> <span className="text-muted">rental still charged</span></>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
