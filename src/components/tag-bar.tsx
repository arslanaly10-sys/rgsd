/** Stacked bar of green / yellow / red counts, drawn to scale. */
export function TagBar({ green, yellow, red, labels }: { green: number; yellow: number; red: number; labels?: { green: string; yellow: string; red: string } }) {
  const total = green + yellow + red || 1;
  const seg = (n: number, cls: string, label?: string) =>
    n > 0 ? <span className={`${cls} h-full`} style={{ width: `${(n / total) * 100}%` }} title={label ? `${label}: ${n}` : String(n)} /> : null;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={`${green} / ${yellow} / ${red}`}>
      {seg(green, "bg-tag-green", labels?.green)}
      {seg(yellow, "bg-[#e0a300]", labels?.yellow)}
      {seg(red, "bg-tag-red", labels?.red)}
    </div>
  );
}
