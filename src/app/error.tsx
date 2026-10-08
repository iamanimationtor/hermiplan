"use client";

import { useEffect } from "react";
import Link from "next/link";
import { LogoMark, CREATOR_CREDIT_FULL } from "@/components/Logo";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // surfaced in server logs / monitoring without leaking details to the user
    console.error("HERMIPLAN runtime error:", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-5 py-16 text-center">
      <div className="hp-card w-full max-w-lg p-8">
        <LogoMark size="lg" />
        <h1 className="mt-6 text-[19px] font-extrabold text-ink-900">خطای غیرمنتظره رخ داد</h1>
        <p className="mt-3 text-[13px] leading-7 text-slate-500">
          داده‌های پروژه شما به‌صورت خودکار در مرورگر ذخیره شده و از بین نرفته است. لطفاً دوباره تلاش کنید.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-2xl bg-brand-700 px-6 py-3.5 text-[13.5px] font-bold text-white transition hover:bg-brand-600"
          >
            تلاش مجدد
          </button>
          <Link
            href="/builder"
            className="rounded-2xl border border-slate-200 px-6 py-3.5 text-[13.5px] font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            بازگشت به پنل پروژه
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-5 font-mono text-[10.5px] text-slate-400">کد پیگیری: {error.digest}</p>
        ) : null}
      </div>
      <p className="mt-6 text-[11px] text-slate-400">{CREATOR_CREDIT_FULL}</p>
    </main>
  );
}
