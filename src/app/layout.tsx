import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

/**
 * Canonical site URL. Set NEXT_PUBLIC_SITE_URL to the production origin
 * (custom domain or https://<site>.netlify.app) so OpenGraph/Twitter images,
 * canonical URLs and the sitemap resolve to absolute URLs. The fallback keeps
 * local development and previews working without configuration.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hermiplan.netlify.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "HERMIPLAN — پلتفرم هوشمند مدیریت و برنامه‌ریزی پروژه",
    template: "%s | HERMIPLAN",
  },
  description:
    "HERMIPLAN اطلاعات ساده پروژه شما را به زمان‌بندی استاندارد، مسیر بحرانی، تحلیل منابع، هزینه و تعدیل قیمت و گزارش مهندسی قابل ارائه تبدیل می‌کند. Created by Mohammad Shirmardi.",
  keywords: [
    "مدیریت پروژه",
    "زمان‌بندی پروژه",
    "مسیر بحرانی",
    "گانت چارت",
    "WBS",
    "گزارش پروژه",
    "HERMIPLAN",
    "Mohammad Shirmardi",
  ],
  authors: [{ name: "Mohammad Shirmardi" }],
  creator: "Mohammad Shirmardi",
  publisher: "HERMIPLAN",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "1024x1024" }],
  },
  appleWebApp: {
    capable: true,
    title: "HERMIPLAN",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "HERMIPLAN — پلتفرم هوشمند مدیریت و برنامه‌ریزی پروژه",
    description: "ورودی ساده، پردازش هوشمند، خروجی حرفه‌ای مهندسی",
    url: "/",
    siteName: "HERMIPLAN",
    locale: "fa_IR",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1424,
        height: 752,
        alt: "HERMIPLAN — پلتفرم هوشمند مدیریت و برنامه‌ریزی پروژه",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "HERMIPLAN — پلتفرم هوشمند مدیریت و برنامه‌ریزی پروژه",
    description: "ورودی ساده، پردازش هوشمند، خروجی حرفه‌ای مهندسی",
    images: ["/og-image.png"],
  },
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a1c37",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen bg-[#f4f6fa] text-ink-900 antialiased">
        {/* React 19 hoists these into <head>: warm up the font CDN connection */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://cdn.jsdelivr.net" />
        {children}
      </body>
    </html>
  );
}
