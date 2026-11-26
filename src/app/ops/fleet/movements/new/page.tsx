import Link from "next/link";
import { getLocale } from "next-intl/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/auth";
import { L, type Loc } from "@/lib/format";
import { siteOptions } from "@/lib/queries";
import { intakeDeliveryNote } from "@/lib/actions/fleet";

export default async function NewMovement({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  const l = (await getLocale()) as Loc;
  const { msg } = await searchParams;
  const sites = await siteOptions(s);
  return (
    <>
      <Link href="/ops/fleet" className="text-sm text-muted hover:text-ink">← Fleet & logistics</Link>
      <PageHeader title="Log a delivery note" sub="Photograph or upload the signed delivery note or waybill. The Fleet agent reads the DN number, direction and every line, matches them to the catalogue and drafts the movement for you to check." />
      <Flash msg={msg} />
      <Card>
        <form action={intakeDeliveryNote} className="grid max-w-xl gap-4">
          <div className="grid gap-1">
            <label htmlFor="file" className="text-sm font-medium">Delivery note (photo or PDF)</label>
            <input id="file" name="file" type="file" accept="image/*,.pdf,.txt" capture="environment" required className="text-sm file:me-3 file:rounded-lg file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm file:font-semibold" />
          </div>
          <div className="grid gap-1">
            <label htmlFor="site" className="text-sm font-medium">Site <span className="font-normal text-muted">(leave on auto to read it from the note)</span></label>
            <select id="site" name="site" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm">
              <option value="">Auto-detect</option>
              {sites.map((x) => <option key={x.code} value={x.code}>{x.code} · {L(x, "name", l)}</option>)}
            </select>
          </div>
          <SubmitButton className="w-fit rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white" pending="Reading the note…">Read delivery note</SubmitButton>
        </form>
      </Card>
    </>
  );
}
