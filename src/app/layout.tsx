import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
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
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "HERMIPLAN — پلتفرم هوشمند مدیریت پروژه",
    description: "ورودی ساده، پردازش هوشمند، خروجی حرفه‌ای مهندسی",
    locale: "fa_IR",
    type: "website",
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
      <body className="min-h-screen bg-[#f4f6fa] text-ink-900 antialiased">{children}</body>
    </html>
  );
}
