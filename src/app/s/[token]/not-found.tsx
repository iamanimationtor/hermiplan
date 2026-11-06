import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";

/**
 * 404 for `/s/<token>`.
 *
 * Unknown, revoked and expired tokens all land here — the same page, the same
 * status, no hint about which one it was. The message tells a legitimate reader
 * what to do next instead of leaving them to guess.
 */
export const metadata: Metadata = {
  title: "لینک اشتراک در دسترس نیست",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function SharedReportNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <div className="hp-card space-y-5 p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <LogoMark size="md" />
          <div>
            <p className="text-[11px] font-bold tracking-wide text-slate-500">کد ۴۰۴</p>
            <h1 className="text-[19px] font-extrabold text-ink-900 sm:text-[22px]">
              این لینک اشتراک معتبر نیست
            </h1>
          </div>
        </div>

        <p className="text-[13px] leading-7 text-slate-600">
          لینک اشتراک گزارش ممکن است باطل شده باشد، منقضی شده باشد، یا ناقص کپی شده باشد. وجود یا نبود پروژه از این
          پاسخ مشخص نمی‌شود.
        </p>

        <ul className="list-inside list-disc space-y-1.5 rounded-xl bg-slate-50 p-4 text-[12px] leading-6 text-slate-600">
          <li>از فرستندهٔ لینک بخواهید یک لینک تازه بسازد (هر پروژه می‌تواند چند لینک فعال داشته باشد).</li>
          <li>اگر لینک را از پیام‌رسان گرفته‌اید، مطمئن شوید کل نشانی کپی شده و در انتها چیزی جا نیفتاده است.</li>
          <li>لینک‌های دارای تاریخ انقضا پس از آن تاریخ بسته می‌شوند و باید لینک جدید ساخته شود.</li>
        </ul>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link
            href="/"
            className="rounded-xl bg-brand-700 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-brand-800"
          >
            صفحه اصلی
          </Link>
          <Link
            href="/builder"
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            ساخت گزارش جدید
          </Link>
        </div>
      </div>
    </main>
  );
}
