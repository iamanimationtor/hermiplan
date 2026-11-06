import type { Metadata } from "next";
import { BuilderApp } from "@/components/builder/BuilderApp";
import { buildProjectFromTemplate } from "@/lib/templates";
import { ACCESS } from "@/lib/server/access-mode";

/** Rendered per request for the same CSP-nonce reason as the landing page. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ساخت و برنامه‌ریزی پروژه",
  description: "پروژه خود را در چند مرحله ساده تعریف کنید و گزارش حرفه‌ای مدیریت پروژه دریافت کنید.",
};

export default function BuilderPage() {
  // The access badge is decided on the server so the wording can never drift
  // from the switch in config/access.json.
  return <BuilderApp initial={buildProjectFromTemplate("general")} accessBadge={ACCESS.badge} />;
}
