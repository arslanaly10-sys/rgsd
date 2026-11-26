"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** QR scan with the browser's BarcodeDetector (Android Chrome); everyone else types the tag number. */
export function Scanner() {
  const t = useTranslations("field");
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [tag, setTag] = useState("");

  useEffect(() => {
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!BD || !navigator.mediaDevices?.getUserMedia) { setSupported(false); return; }
    let stream: MediaStream | null = null;
    let stop = false;
    const detector = new BD({ formats: ["qr_code"] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(async (s) => {
      stream = s;
      setSupported(true);
      if (!video.current) return;
      video.current.srcObject = s;
      await video.current.play();
      const loop = async () => {
        if (stop || !video.current) return;
        const codes = await detector.detect(video.current).catch(() => []);
        const hit = codes.map((c) => c.rawValue.match(/[A-Z]{3}-\d{4}/)?.[0]).find(Boolean);
        if (hit) { router.push(`/field/inspect/${hit}`); return; }
        requestAnimationFrame(loop);
      };
      loop();
    }).catch(() => setSupported(false));
    return () => { stop = true; stream?.getTracks().forEach((tr) => tr.stop()); };
  }, [router]);

  return (
    <div className="grid gap-4 p-4">
      {supported !== false && <video ref={video} playsInline muted className="aspect-square w-full rounded-2xl bg-ink object-cover" />}
      {supported === false && <p className="rounded-xl bg-panel p-3 text-sm text-muted">{t("noCamera")}</p>}
      <form onSubmit={(e) => { e.preventDefault(); const v = tag.trim().toUpperCase(); if (/^[A-Z]{3}-\d{4}$/.test(v)) router.push(`/field/inspect/${v}`); }} className="grid gap-2">
        <label htmlFor="tag" className="eyebrow">{t("manual")}</label>
        <div className="flex gap-2">
          <input id="tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="SDR-0021" autoCapitalize="characters" className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-3 py-3 font-mono text-base uppercase" />
          <button className="rounded-xl bg-brand px-5 font-semibold text-white">{t("go")}</button>
        </div>
      </form>
    </div>
  );
}
