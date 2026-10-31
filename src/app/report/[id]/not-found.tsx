import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";

/**
 * 404 for `/report/<id>`.
 *
 * Three very different situations produce this page — a deleted project, a
 * mistyped id, and a real project opened from a browser that is not its owner —
 * and they must be indistinguishable, otherwise the URL becomes an oracle for
 * "does this project exist?". The *text* therefore explains all three without
 * telling the visitor which one they hit.
 *
 * The old generic 404 said "the project may have been deleted", which is
 * misleading: in the most common case nothing was deleted, the browser simply
 * lost its guest cookie (new device, cleared cookies, new preview origin).
 */
export const metadata: Metadata = {
  title: "گزارش در دسترس نیست",
  robots: { index: false, follow: false, nocache: true },
};

export default function ReportNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <div className="hp-card space-y-5 p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <LogoMark size="md" />
          <div>
            <p className="text-[11px] font-bold tracking-wide text-slate-500">کد ۴۰۴</p>
            <h1 className="text-[19px] font-extrabold text-ink-900 sm:text-[22px]">
              این گزارش برای این مرورگر یا حساب در دسترس نیست
            </h1>
          </div>
        </div>

        <p className="text-[13px] leading-7 text-slate-600">
          گزارش‌های هر پروژه فقط برای سازندهٔ آن باز می‌شوند. این صفحه برای سه حالت یکسان است و روی‌هم‌رفته
          نمی‌گوید کدام‌یک رخ داده است: پروژه حذف شده، نشانی اشتباه است، یا پروژه با مرورگر/حساب دیگری باز شده است.
        </p>

        <div className="space-y-3 rounded-xl bg-slate-50 p-4">
          <p className="text-[12.5px] font-bold text-ink-900">اگر خودتان سازندهٔ پروژه هستید</p>
          <ul className="list-inside list-disc space-y-1.5 text-[12px] leading-6 text-slate-600">
            <li>گزارش را با همان مرورگری باز کنید که پروژه را در آن ساخته‌اید؛ پروژه‌های مهمان به کوکی همین مرورگر وابسته‌اند.</li>
            <li>اگر مرورگر یا دستگاه عوض شده، از «پروژه‌های من ← فایل پشتیبان» استفاده کنید و فایل را در مرورگر جدید بازیابی کنید.</li>
            <li>با شماره موبایل وارد شوید: پروژه‌های همین مرورگر پس از ورود به حساب شما منتقل می‌شوند و از هر دستگاه دیگری در دسترس خواهند بود.</li>
          </ul>
        </div>

        <div className="space-y-3 rounded-xl bg-brand-50/60 p-4">
          <p className="text-[12.5px] font-bold text-ink-900">اگر لینک را از شخص دیگری گرفته‌اید</p>
          <p className="text-[12px] leading-6 text-slate-600">
            دانستن شناسهٔ گزارش به‌تنهایی اجازهٔ دسترسی نمی‌دهد. از مالک پروژه بخواهید در صفحهٔ گزارش،
            «لینک اشتراک» بسازد و همان لینک را برای شما بفرستد؛ لینک اشتراک قابل ابطال و دارای انقضاست.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link
            href="/builder"
            className="rounded-xl bg-brand-700 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-brand-800"
          >
            رفتن به ساخت پروژه
          </Link>
          <Link
            href="/"
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            صفحه اصلی
          </Link>
        </div>
      </div>
    </main>
  );
}
