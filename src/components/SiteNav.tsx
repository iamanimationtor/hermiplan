"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo, LogoMark, CREATOR_CREDIT_FULL } from "./Logo";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: string;
  description?: string;
}

const LANDING_ITEMS: NavItem[] = [
  { id: "how", label: "چگونه کار می‌کند", href: "#how", icon: "⚙️", description: "سه مرحله از ایده تا گزارش" },
  { id: "features", label: "امکانات", href: "#features", icon: "🧮", description: "موتور محاسباتی و تحلیل‌ها" },
  { id: "types", label: "انواع پروژه", href: "#types", icon: "🗂️", description: "۱۰ قالب آماده با فیلتر پیشرفته" },
  { id: "market", label: "بازار و قیمت‌گذاری", href: "#market", icon: "📈", description: "نرخ‌های به‌روز بازار ایران و تعدیل" },
  { id: "output", label: "خروجی گزارش", href: "#output", icon: "📄", description: "۷ فرمت حرفه‌ای قابل دریافت" },
  { id: "about", label: "درباره", href: "#about", icon: "💡", description: "معرفی پلتفرم و سازنده" },
];

const TAB_ITEMS: NavItem[] = [
  { id: "top", label: "خانه", href: "#top", icon: "🏠" },
  { id: "features", label: "امکانات", href: "#features", icon: "🧮" },
  { id: "market", label: "بازار", href: "#market", icon: "📈" },
  { id: "output", label: "خروجی", href: "#output", icon: "📄" },
];

/** Highlights the section currently in view (IntersectionObserver, no re-render storm). */
function useActiveSection(items: NavItem[]) {
  const [active, setActive] = useState("top");
  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-25% 0px -60% 0px", threshold: [0.05, 0.25, 0.5] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);
  return active;
}

export function SiteNav({ items = LANDING_ITEMS }: { items?: NavItem[] }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const active = useActiveSection(items);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = sheetOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sheetOpen]);

  return (
    <>
      {/* ------------------------------ top bar ------------------------------ */}
      <header
        className={`no-print fixed inset-x-0 top-0 z-40 transition-all duration-300 ${
          scrolled ? "glass border-b border-brand-900/10" : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="HERMIPLAN">
            <Logo tone="dark" tagline="Project Intelligence" />
          </Link>

          <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex">
            {items.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className={`rounded-xl px-3 py-2 text-[13px] font-semibold transition ${
                  active === item.id ? "bg-white/12 text-white" : "text-slate-300 hover:bg-white/8 hover:text-white"
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <Link
            href="/builder"
            className="ms-auto hidden rounded-xl bg-accent-500 px-4 py-2.5 text-[13px] font-bold text-ink-950 shadow-lg shadow-accent-600/20 transition hover:bg-accent-400 lg:ms-0 lg:inline-flex"
          >
            شروع بدون ثبت‌نام
          </Link>

          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label="منوی بیشتر"
            className="ms-auto flex size-11 items-center justify-center rounded-xl border border-white/15 bg-white/8 text-white transition active:scale-95 lg:hidden"
          >
            <span className="flex flex-col gap-[5px]">
              <span className="block h-[2px] w-5 rounded bg-current" />
              <span className="block h-[2px] w-5 rounded bg-current" />
              <span className="block h-[2px] w-3.5 rounded bg-current" />
            </span>
          </button>
        </div>
      </header>

      {/* --------------------------- mobile tab bar --------------------------- */}
      <nav className="hp-tabbar no-print fixed inset-x-0 bottom-0 z-40 flex lg:hidden" aria-label="ناوبری اصلی">
        {TAB_ITEMS.map((item) => (
          <a key={item.id} href={item.href} className="hp-tab-item" data-active={active === item.id}>
            <span className="hp-tab-icon">{item.icon}</span>
            {item.label}
          </a>
        ))}
        <button type="button" onClick={() => setSheetOpen(true)} className="hp-tab-item" data-active={false}>
          <span className="hp-tab-icon">☰</span>
          بیشتر
        </button>
      </nav>

      {/* ------------------------------ sheet ------------------------------ */}
      {sheetOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="بستن منو"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm"
          />
          <div className="hp-sheet animate-slide-up relative z-10 w-full max-w-md overflow-hidden sm:rounded-3xl">
            <div className="hp-grabber sm:hidden" />
            <div className="flex items-center justify-between px-5 pb-3 pt-3">
              <Logo tagline="Project Intelligence" />
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="بستن"
                className="flex size-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="thin-scroll max-h-[62vh] space-y-1.5 overflow-y-auto px-4 pb-2">
              {items.map((item, index) => (
                <a
                  key={item.id}
                  href={item.href}
                  onClick={() => setSheetOpen(false)}
                  className="animate-pop flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white px-4 py-3 transition active:scale-[0.99]"
                  style={{ animationDelay: `${index * 28}ms` }}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-[17px]">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-bold text-ink-900">{item.label}</span>
                    {item.description ? (
                      <span className="mt-0.5 block truncate text-[11.5px] text-slate-500">{item.description}</span>
                    ) : null}
                  </span>
                  <span className="text-slate-300">›</span>
                </a>
              ))}
            </div>

            <div className="mt-2 border-t border-slate-100 p-4">
              <Link
                href="/builder"
                onClick={() => setSheetOpen(false)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-500 px-4 py-3.5 text-[14px] font-bold text-ink-950 transition active:scale-[0.99]"
              >
                🚀 ساخت پروژه و دریافت گزارش
              </Link>
              <p className="mt-3 flex items-center justify-center gap-2 text-center text-[10.5px] text-slate-500">
                <LogoMark size="xs" /> {CREATOR_CREDIT_FULL}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
