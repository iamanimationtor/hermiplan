"use client";

import { useState } from "react";
import { Modal } from "@/components/ui";
import { LogoMark, CREATOR_CREDIT_FULL } from "@/components/Logo";

interface GlossaryItem {
  term: string;
  english: string;
  body: string;
  group: "برنامه‌ریزی" | "پایش" | "هزینه" | "ریسک";
}

const GLOSSARY: GlossaryItem[] = [
  {
    term: "مسیر بحرانی",
    english: "Critical Path",
    body: "زنجیره‌ای از فعالیت‌های وابسته که هیچ وقت اضافه‌ای ندارند. اگر یکی از آن‌ها دیرتر تمام شود، کل پروژه دیرتر تمام می‌شود. سیستم این مسیر را خودکار پیدا می‌کند.",
    group: "برنامه‌ریزی",
  },
  {
    term: "شناوری کل",
    english: "Total Float",
    body: "حداکثر تأخیری که برای یک فعالیت مجاز است، بدون آن‌که تاریخ پایان پروژه عوض شود. صفر یعنی بحرانی.",
    group: "برنامه‌ریزی",
  },
  {
    term: "شناوری آزاد",
    english: "Free Float",
    body: "تأخیری که می‌توانید به یک فعالیت بدهید بدون آن‌که هیچ فعالیت بعدی عقب بیفتد.",
    group: "برنامه‌ریزی",
  },
  {
    term: "وابستگی",
    english: "Dependency",
    body: "رابطه بین دو فعالیت. رایج‌ترین حالت «پایان به شروع» است: فعالیت بعدی پس از پایان قبلی آغاز می‌شود. تأخیر (Lag) هم قابل تنظیم است.",
    group: "برنامه‌ریزی",
  },
  {
    term: "ساختار شکست کار",
    english: "WBS",
    body: "تقسیم پروژه به فاز و فعالیت به‌صورت درختی؛ مبنای محاسبه زمان، هزینه و مسئولیت‌ها.",
    group: "برنامه‌ریزی",
  },
  {
    term: "نقطه کنترل",
    english: "Milestone",
    body: "رویدادی با مدت صفر که پایان یک مرحله مهم را نشان می‌دهد؛ مثلاً «پایان فونداسیون».",
    group: "برنامه‌ریزی",
  },
  {
    term: "تقویم کاری",
    english: "Working Calendar",
    body: "روزها و ساعات کاری پروژه. پیش‌فرض شنبه تا چهارشنبه، ۸ ساعت در روز. تعطیلات هم قابل ثبت است.",
    group: "برنامه‌ریزی",
  },
  {
    term: "پیشرفت فیزیکی",
    english: "Percent Complete",
    body: "درصد واقعی انجام‌شده هر فعالیت. مجموع وزنی این مقادیر، پیشرفت کل پروژه را می‌سازد.",
    group: "پایش",
  },
  {
    term: "شاخص عملکرد زمان‌بندی",
    english: "SPI",
    body: "نسبت کار انجام‌شده به کار برنامه‌ریزی‌شده. کمتر از ۱ یعنی از برنامه عقب هستید.",
    group: "پایش",
  },
  {
    term: "شاخص عملکرد هزینه",
    english: "CPI",
    body: "نسبت ارزش کار انجام‌شده به هزینه واقعی پرداخت‌شده. کمتر از ۱ یعنی بیش از بودجه خرج کرده‌اید.",
    group: "هزینه",
  },
  {
    term: "برآورد هزینه در پایان",
    english: "EAC",
    body: "پیش‌بینی هزینه نهایی پروژه بر اساس عملکرد فعلی. اگر CPI کمتر از ۱ باشد، EAC بیشتر از بودجه می‌شود.",
    group: "هزینه",
  },
  {
    term: "تعدیل قیمت",
    english: "Escalation",
    body: "افزایش نرخ‌ها در طول اجرا. سیستم هزینه هر ماه را جداگانه حساب می‌کند و نرخ تعدیل را فقط روی ماه‌های آینده اعمال می‌کند.",
    group: "هزینه",
  },
  {
    term: "هزینه بالاسری",
    english: "Overhead",
    body: "هزینه‌های غیرمستقیم اجرا مثل سرپرستی، ایمنی، بیمه و تجهیزات عمومی؛ به‌صورت درصد روی هزینه مستقیم.",
    group: "هزینه",
  },
  {
    term: "ذخیره احتیاطی",
    english: "Contingency",
    body: "پولی که برای پیشامدهای پیش‌بینی‌نشده کنار گذاشته می‌شود؛ با سود پیمانکار تفاوت دارد.",
    group: "هزینه",
  },
  {
    term: "مبنای مقایسه",
    english: "Baseline",
    body: "نسخه تأییدشده برنامه اولیه. بعد از ثبت آن، هر تغییر زمان یا هزینه به‌صورت انحراف گزارش می‌شود.",
    group: "پایش",
  },
  {
    term: "بیش‌تخصیص منبع",
    english: "Over-allocation",
    body: "وقتی کار روزانه‌ای که به یک منبع می‌دهید از ظرفیت مجاز آن بیشتر باشد. سیستم این موارد را علامت‌گذاری می‌کند.",
    group: "ریسک",
  },
  {
    term: "امتیاز ریسک",
    english: "Risk Score",
    body: "حاصل‌ضرب احتمال (۱ تا ۵) در شدت اثر (۱ تا ۵). ۲۰ و بالاتر یعنی بحرانی.",
    group: "ریسک",
  },
  {
    term: "امتیاز سلامت پروژه",
    english: "Project Health",
    body: "جمع‌بندی زمان‌بندی، هزینه، منابع، ریسک و تأخیرها در یک عدد از ۱۰۰.",
    group: "پایش",
  },
];

const STEPS = [
  ["۱", "نوع پروژه را انتخاب کنید", "یک قالب آماده با فازها، فعالیت‌ها و نرخ‌های بازار ایران برای شما ساخته می‌شود."],
  ["۲", "فعالیت‌ها را ویرایش کنید", "افزودن سریع، درون‌ریزی از اکسل یا ویرایش جدول — بدون نیاز به دانستن مفاهیم تخصصی."],
  ["۳", "منابع و نرخ‌ها را ببینید", "نرخ‌ها به‌صورت خودکار از فهرست بازار ایران خوانده می‌شود؛ قابل تغییر است."],
  ["۴", "خروجی بگیرید", "گزارش A4 حرفه‌ای، اکسل، CSV، JSON و فایل Microsoft Project."],
];

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"how" | "glossary">("how");
  const groups = Array.from(new Set(GLOSSARY.map((item) => item.group)));

  return (
    <Modal open={open} onClose={onClose} title="راهنما و واژه‌نامه" wide>
      <div className="mb-4 flex gap-1.5">
        {(
          [
            ["how", "چطور کار کنم؟"],
            ["glossary", "واژه‌نامه مهندسی"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-xl px-3.5 py-2 text-[12.5px] font-semibold transition ${
              tab === id ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "how" ? (
        <div className="space-y-3">
          <p className="rounded-xl border border-brand-100 bg-brand-50/60 p-3 text-[12.5px] leading-7 text-slate-600">
            برای استفاده از HERMIPLAN لازم نیست دوره‌ای بگذرانید یا مفاهیم زمان‌بندی را یاد بگیرید.
            کافی است اطلاعات پروژه‌تان را وارد کنید؛ همه محاسبات تخصصی خودکار انجام می‌شود.
          </p>
          {STEPS.map(([step, title, body]) => (
            <div key={step} className="flex gap-3 rounded-2xl border border-slate-200 p-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-[13px] font-bold text-white">
                {step}
              </span>
              <div>
                <p className="text-[13px] font-bold text-ink-900">{title}</p>
                <p className="mt-1 text-[12px] leading-6 text-slate-500">{body}</p>
              </div>
            </div>
          ))}
          <div className="rounded-2xl bg-slate-50 p-3.5 text-[12px] leading-7 text-slate-600">
            <p className="font-bold text-ink-900">میان‌برهای مفید</p>
            <p>• در فیلد «افزودن سریع» با کلید Enter فعالیت بعدی را بدون کلیک اضافه کنید.</p>
            <p>• هر تغییری را می‌توانید با دکمه «واگردانی» در نوار بالا برگردانید.</p>
            <p>• پیش‌نویس شما به‌صورت خودکار در همین مرورگر ذخیره می‌شود.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group}>
              <p className="mb-2 text-[12px] font-bold text-brand-600">{group}</p>
              <div className="space-y-2">
                {GLOSSARY.filter((item) => item.group === group).map((item) => (
                  <div key={item.term} className="rounded-2xl border border-slate-200 p-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-bold text-ink-900">{item.term}</p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-500" dir="ltr">
                        {item.english}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-6 text-slate-500">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4 text-[10.5px] text-slate-500">
        <LogoMark size="xs" /> {CREATOR_CREDIT_FULL}
      </p>
    </Modal>
  );
}
