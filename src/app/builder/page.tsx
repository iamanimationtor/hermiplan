import type { Metadata } from "next";
import { BuilderApp } from "@/components/builder/BuilderApp";
import { buildProjectFromTemplate } from "@/lib/templates";

export const metadata: Metadata = {
  title: "ساخت و برنامه‌ریزی پروژه",
  description: "پروژه خود را در چند مرحله ساده تعریف کنید و گزارش حرفه‌ای مدیریت پروژه دریافت کنید.",
};

export default function BuilderPage() {
  return <BuilderApp initial={buildProjectFromTemplate("general")} />;
}
