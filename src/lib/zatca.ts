import "server-only";

/*
 * ZATCA (Fatoora) helpers.
 * - qrTlv: the Phase 1 QR payload (TLV: seller, VAT no., timestamp, total, VAT), base64. Required on every simplified invoice.
 * - ublXml: a UBL 2.1 invoice skeleton with the fields Phase 2 needs.
 * NOT done here: cryptographic stamping, the invoice hash chain and clearance/reporting through the ZATCA API.
 * Those need RGS's onboarded EGS unit and CSID, so invoices stay "not submitted" until that integration exists.
 */
export const SELLER = {
  name: "Resa Gulf Scaffolding Co. Ltd.",
  nameAr: "شركة ريسا الخليج للسقالات",
  vat: process.env.RGS_VAT_NUMBER || "399999999900003", // SAMPLE number in ZATCA's test format
  address: "Khobar Pavilion, King Faisal Ibn Abdulaziz St., Khobar 34421",
};

function tlv(tag: number, value: string) {
  const v = Buffer.from(value, "utf8");
  if (v.length > 255) throw new Error(`TLV value too long for tag ${tag}`);
  return Buffer.concat([Buffer.from([tag, v.length]), v]);
}

export function qrTlv(i: { issuedAt: Date; total: number; vat: number }) {
  return Buffer.concat([
    tlv(1, SELLER.name),
    tlv(2, SELLER.vat),
    tlv(3, i.issuedAt.toISOString().replace(/\.\d{3}Z$/, "Z")),
    tlv(4, i.total.toFixed(2)),
    tlv(5, i.vat.toFixed(2)),
  ]).toString("base64");
}

/** Decode a TLV payload (used by tests and the invoice page to show what the QR contains). */
export function decodeTlv(b64: string) {
  const b = Buffer.from(b64, "base64");
  const out: Record<number, string> = {};
  for (let i = 0; i < b.length; ) {
    const tag = b[i], len = b[i + 1];
    out[tag] = b.subarray(i + 2, i + 2 + len).toString("utf8");
    i += 2 + len;
  }
  return out;
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export function ublXml(inv: { uuid: string; ref: string; issuedAt: Date; buyer: { name: string; vat: string | null }; lines: { description: string; qty: number; unit: string; rate: number; amount: number }[]; subtotal: number; vat: number; total: number }) {
  const d = inv.issuedAt.toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${esc(inv.ref)}</cbc:ID>
  <cbc:UUID>${inv.uuid}</cbc:UUID>
  <cbc:IssueDate>${d.slice(0, 10)}</cbc:IssueDate>
  <cbc:IssueTime>${d.slice(11, 19)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>${SELLER.vat}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${esc(SELLER.name)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>${inv.buyer.vat ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(inv.buyer.vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ""}<cac:PartyLegalEntity><cbc:RegistrationName>${esc(inv.buyer.name)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${inv.vat.toFixed(2)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="SAR">${inv.subtotal.toFixed(2)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="SAR">${inv.vat.toFixed(2)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="SAR">${inv.subtotal.toFixed(2)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="SAR">${inv.subtotal.toFixed(2)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="SAR">${inv.total.toFixed(2)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="SAR">${inv.total.toFixed(2)}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${inv.lines.map((l, i) => `  <cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="${esc(l.unit)}">${l.qty}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="SAR">${l.amount.toFixed(2)}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${esc(l.description)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="SAR">${l.rate}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`).join("\n")}
</Invoice>
`;
}
