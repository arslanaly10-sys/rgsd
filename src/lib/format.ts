export type Loc = "en" | "ar";

const nf = (l: Loc, opts: Intl.NumberFormatOptions = {}) => new Intl.NumberFormat(l === "ar" ? "ar-SA-u-nu-latn" : "en-SA", opts);

export const fmtNum = (n: number | string | null | undefined, l: Loc, digits = 0) =>
  n == null ? "—" : nf(l, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(n));

export const fmtSAR = (n: number | string | null | undefined, l: Loc, digits = 0) =>
  n == null ? "—" : `${l === "ar" ? "ر.س" : "SAR"} ${fmtNum(n, l, digits)}`;

export const fmtDate = (d: string | Date | null | undefined, l: Loc) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  return new Intl.DateTimeFormat(l === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Riyadh" }).format(date);
};

/** Days from today (Riyadh) to a date; negative means in the past. */
export const daysUntil = (d: string | Date | null | undefined) => {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - today) / 86400000);
};

/** Pick the Arabic column when the UI is Arabic and a translation exists. */
export function L<T extends Record<string, unknown>>(row: T, field: string, l: Loc): string {
  const ar = row[`${field}_ar`];
  return String((l === "ar" && ar ? ar : row[field]) ?? "");
}
