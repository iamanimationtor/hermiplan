import type { ProjectType, StandardsBasis } from "@/lib/engine/types";

/**
 * مبنای استانداردها و متدهای حرفه‌ای HERMIPLAN.
 * استانداردهای داخلی: اسناد سازمان برنامه و بودجه، مبحث مقررات ملی ساختمان و
 * نظام‌فنی اجرایی. استانداردهای بین‌المللی: PMBOK، ISO و AACE.
 */

const NATIONAL: StandardsBasis[] = [
  {
    code: "فهرست‌بهای واحد پایه",
    title: "فهرست‌بهای واحد پایه سازمان برنامه و بودجه (۱۴۰۴/۱۴۰۵)",
    body: "مبنای تهیه برآورد اولیه هزینه و پایه انجام معاملات طرح‌های عمرانی؛ شامل رسته‌های ابنیه، تأسیسات مکانیکی و برقی، راه و ترابری، آب و فاضلاب و سدسازی.",
    scope: "national",
  },
  {
    code: "شرایط عمومی پیمان",
    title: "شرایط عمومی پیمان و نظام‌فنی اجرایی کارهای عمرانی",
    body: "چارچوب حقوقی و فنی قرارداد، تعهدات پیمانکار و کارفرما، تنظیم و تعدیل قیمت‌ها، تحویل موقت و قطعی و ضمانت‌های اجرایی.",
    scope: "national",
  },
  {
    code: "مبحث مقررات ملی ساختمان",
    title: "مبحث‌های مقررات ملی ساختمان",
    body: "الزامات فنی اجرای ساختمان شامل ایمنی، استحکام، تأسیسات و بهره‌وری انرژی؛ ملاک کنترل نقشه‌ها توسط دستگاه‌های نظارت.",
    scope: "national",
  },
  {
    code: "بخشنامه دستمزد",
    title: "مصوبه شورای عالی کار — جدول دستمزد سالانه",
    body: "مبنای محاسبه حداقل مزد، مزایا و حق بیمه کارگران ساختمانی؛ ضرایب ۱.۳، ۱.۶ و ۱.۹ برابر حداقل مزد بر پایه کارت مهارت فنی.",
    scope: "national",
  },
];

const INTERNATIONAL: StandardsBasis[] = [
  {
    code: "PMBOK 7",
    title: "PMBOK Guide — Seventh Edition (PMI)",
    body: "رویکرد ارزش‌محور و اصول‌محور مدیریت پروژه؛ شامل حوزه‌های عملکردی (stakeholders, team, development approach, planning, project work, delivery, measurement, uncertainty).",
    scope: "international",
  },
  {
    code: "ISO 21502:2020",
    title: "ISO 21502:2020 — Project, programme and portfolio management",
    body: "راهنمای عملی فرآیندهای مدیریت پروژه شامل برنامه‌ریزی، کنترل، تغییرات، ریسک و تحویل.",
    scope: "international",
  },
  {
    code: "ISO 21500:2021",
    title: "ISO 21500:2021 — Context and concepts",
    body: "چارچوب مفهومی و واژگان استاندارد مدیریت پروژه، برنامه و پرتفوی.",
    scope: "international",
  },
  {
    code: "AACE RP",
    title: "AACE International Recommended Practices",
    body: "روش‌های استاندارد برآورد هزینه، زمان‌بندی و تحلیل ارزش کسب‌شده (EVM) و طبقه‌بندی کلاس برآورد.",
    scope: "international",
  },
];

/** متدهای محاسباتی به‌کاررفته در موتور HERMIPLAN */
export const METHODS: { code: string; title: string; body: string }[] = [
  {
    code: "CPM/PDM",
    title: "روش مسیر بحرانی با شبکه پیش‌نیازی (PDM)",
    body: "محاسبه زودترین/دیرترین شروع و پایان، شناوری کل و آزاد با روابط FS، SS، FF و SF و تأخیر (Lag) روی تقویم کاری پروژه.",
  },
  {
    code: "EVM",
    title: "مدیریت ارزش کسب‌شده (Earned Value Management)",
    body: "محاسبه PV، EV، AC، شاخص‌های SPI و CPI، برآورد هزینه در پایان (EAC) و انحراف در پایان (VAC).",
  },
  {
    code: "Resource Allocation",
    title: "تخصیص و هموارسازی منابع",
    body: "محاسبه بار روزانه هر منبع، اوج تخصیص، بهره‌وری و شناسایی بیش‌تخصیص نسبت به ظرفیت مجاز.",
  },
  {
    code: "Escalation",
    title: "تعدیل قیمت بر پایه کارکرد ماهانه",
    body: "پخش هزینه برنامه‌ای میان ماه‌های اجرا و اعمال نرخ تعدیل ماهانه بر دوره‌های پس از تاریخ وضعیت.",
  },
  {
    code: "Risk Matrix",
    title: "ارزیابی ریسک به روش احتمال–اثر",
    body: "امتیاز ریسک از حاصل‌ضرب احتمال (۱–۵) در شدت اثر (۱–۵) و تعیین سطح بحرانی/بالا/متوسط/کم.",
  },
  {
    code: "WBS",
    title: "ساختار شکست کار",
    body: "شکست سلسله‌مراتبی پروژه به فاز و فعالیت با کدگذاری استاندارد و تجمیع زمان و هزینه در هر سطح.",
  },
];

const BY_TYPE: Record<ProjectType, { standards: StandardsBasis[]; note: string }> = {
  construction: {
    standards: [NATIONAL[0], NATIONAL[1], NATIONAL[2], NATIONAL[3]],
    note: "برآورد بر مبنای فهرست‌بهای رسته ابنیه و کنترل مطابق مبحث‌های مقررات ملی ساختمان.",
  },
  civil: {
    standards: [NATIONAL[0], NATIONAL[1], INTERNATIONAL[3]],
    note: "برآورد بر مبنای فهرست‌بهای رسته راه، راه‌آهن و باند فرودگاه و روش‌های AACE برای کلاس‌بندی برآورد.",
  },
  architecture: {
    standards: [NATIONAL[2], INTERNATIONAL[0]],
    note: "کنترل نقشه‌ها مطابق مبحث‌های مقررات ملی ساختمان و مدیریت طراحی بر پایه اصول PMBOK هفتم.",
  },
  infrastructure: {
    standards: [NATIONAL[0], NATIONAL[1], INTERNATIONAL[1]],
    note: "برآورد بر مبنای رسته‌های تأسیسات مکانیکی، برقی و شبکه‌های آب و فاضلاب.",
  },
  software: {
    standards: [INTERNATIONAL[0], INTERNATIONAL[1], INTERNATIONAL[2]],
    note: "مدیریت محصول و تحویل تدریجی بر پایه PMBOK 7 و ISO 21502.",
  },
  manufacturing: {
    standards: [INTERNATIONAL[1], INTERNATIONAL[3], NATIONAL[0]],
    note: "برآورد سرمایه‌ای و هزینه اجرا بر پایه روش‌های AACE و فهرست‌بهای ماشین‌آلات.",
  },
  research: {
    standards: [INTERNATIONAL[2], INTERNATIONAL[0]],
    note: "مدیریت پژوهش بر پایه چارچوب ISO 21500 و اصول ارزش‌محور PMBOK.",
  },
  event: {
    standards: [INTERNATIONAL[1], INTERNATIONAL[0]],
    note: "برنامه‌ریزی رویداد بر پایه فرآیندهای ISO 21502 و مدیریت ذی‌نفعان PMBOK.",
  },
  renovation: {
    standards: [NATIONAL[0], NATIONAL[2], NATIONAL[1]],
    note: "برآورد نوسازی بر مبنای فهرست‌بهای ابنیه و الزامات ایمنی و استحکام مقررات ملی ساختمان.",
  },
  general: {
    standards: [INTERNATIONAL[0], INTERNATIONAL[1], NATIONAL[0]],
    note: "چارچوب عملی PMBOK و ISO با امکان اعتبارسنجی هزینه بر مبنای فهرست‌بهای واحد پایه.",
  },
};

export function standardsFor(type: ProjectType): { standards: StandardsBasis[]; note: string } {
  return BY_TYPE[type] ?? BY_TYPE.general;
}

export function allStandards(): StandardsBasis[] {
  return [...NATIONAL, ...INTERNATIONAL];
}
