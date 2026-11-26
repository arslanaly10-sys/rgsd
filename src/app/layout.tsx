import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "RGS OneSite",
  description: "Agentic operations platform for Resa Gulf Scaffolding",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/brand/rgs-logo.png" },
};

export const viewport: Viewport = { themeColor: "#141922", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&family=Poppins:wght@500;600;700&display=swap"
        />
      </head>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
