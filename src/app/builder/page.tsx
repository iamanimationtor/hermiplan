import type { Metadata } from "next";
import { BuilderApp } from "@/components/builder/BuilderApp";
import { buildProjectFromTemplate } from "@/lib/templates";

/** Rendered per request for the same CSP-nonce reason as the landing page. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ساخت و برنامه‌ریزی پروژه",
  description: "پروژه خود را در چند مرحله ساده تعریف کنید و گزارش حرفه‌ای مدیریت پروژه دریافت کنید.",
};

export default function BuilderPage() {
  return <BuilderApp initial={buildProjectFromTemplate("general")} />;
}
