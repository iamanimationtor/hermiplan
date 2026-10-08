import Link from "next/link";
import { Logo, LogoMark, CREATOR_CREDIT_FULL } from "@/components/Logo";

export default function NotFound() {
  return (
    <main className="hp-mesh flex min-h-screen flex-col items-center justify-center px-5 py-16 text-center text-white">
      <LogoMark size="xl" tone="dark" />
      <p className="mt-8 text-[64px] font-black leading-none text-gradient">۴۰۴</p>
      <h1 className="mt-3 text-[20px] font-extrabold sm:text-[24px]">این صفحه در HERMIPLAN یافت نشد</h1>
      <p className="mt-3 max-w-md text-[13px] leading-7 text-slate-300">
        ممکن است گزارش مورد نظر حذف شده یا آدرس اشتباه وارد شده باشد. می‌توانید پروژه جدیدی بسازید یا به صفحه اصلی بازگردید.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/builder"
          className="rounded-2xl bg-accent-500 px-6 py-3.5 text-[14px] font-bold text-ink-950 transition hover:bg-accent-400"
        >
          ساخت پروژه جدید
        </Link>
        <Link
          href="/"
          className="rounded-2xl border border-white/15 bg-white/8 px-6 py-3.5 text-[14px] font-semibold text-white transition hover:bg-white/14"
        >
          صفحه اصلی
        </Link>
      </div>
      <p className="mt-10 flex items-center gap-2 text-[11px] text-slate-500">
        <Logo size="xs" showWordmark={false} tone="dark" /> {CREATOR_CREDIT_FULL}
      </p>
    </main>
  );
}
