/**
 * HERMIPLAN — revision diff checks (pure, no server, no database).
 *
 *   npx tsx scripts/version-diff-check.ts
 *
 * Every assertion here is about behaviour a user depends on when deciding to
 * restore an old revision: *what exactly* changed, nothing silently dropped, and
 * the same answer every time.
 */
import { buildProjectFromTemplate } from "../src/lib/templates";
import type { ProjectInput } from "../src/lib/engine/types";
import { canonical, diffHeadline, diffRevisions, type ProjectDiff } from "../src/lib/report/version-diff";

let passed = 0;
const failures: string[] = [];

function check(condition: boolean, message: string, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failures.push(message);
    console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const base = (): ProjectInput => {
  const project = buildProjectFromTemplate("construction");
  project.activities = project.activities.slice(0, 5);
  project.meta.name = "پروژه آزمون تفاوت";
  return project;
};

const empty = (): ProjectDiff => diffRevisions({ project: base() }, { project: base() });

/** Flattens a diff into "group/entry:field" strings for order assertions. */
const shape = (diff: ProjectDiff): string[] => [
  ...diff.settings.map((field) => `settings:${field.key}`),
  ...diff.groups.flatMap((group) =>
    group.entries.map((entry) => `${group.key}/${entry.id}:${entry.fields.map((field) => field.key).join(",")}`),
  ),
];

function main(): void {
  console.log("▶ ۱. نسخه‌های یکسان");
  const identical = empty();
  check(identical.identical, "دو نسخه با محتوای یکسان، «بدون تفاوت» گزارش می‌شوند");
  check(identical.counts.total === 0, "شمارش تغییرات صفر است", String(identical.counts.total));
  check(identical.groups.length === 0 && identical.settings.length === 0, "هیچ گروه یا تنظیم تغییری گزارش نشده");
  check(diffHeadline(identical).includes("هیچ تفاوتی"), "سرخط فارسی «بدون تفاوت» درست است");

  // Key order must never look like a change: JSONB does not preserve it.
  const reordered = base();
  const rebuild = <T>(value: T): T =>
    Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse()) as T;
  reordered.meta = rebuild(reordered.meta);
  reordered.activities = reordered.activities.map((activity) => rebuild(activity));
  const reorderedDiff = diffRevisions({ project: base() }, { project: reordered });
  check(reorderedDiff.identical, "ترتیب کلیدهای JSON، تغییر محسوب نمی‌شود");
  check(canonical({ a: 1, b: [2, { c: 3 }] }) === canonical({ b: [2, { c: 3 }], a: 1 }), "canonical مستقل از ترتیب است");

  console.log("\n▶ ۲. تغییر فعالیت‌ها");
  const renamed = base();
  const targetName = renamed.activities[0];
  targetName.name = "نام تازه فعالیت";
  const nameDiff = diffRevisions({ project: base() }, { project: renamed });
  const nameEntry = nameDiff.groups.find((group) => group.key === "activities")?.entries[0];
  check(nameDiff.counts.changed === 1, "تغییر نام یک فعالیت، یک تغییر است", JSON.stringify(nameDiff.counts));
  check(nameEntry?.status === "changed", "وضعیت ردیف «changed» است", nameEntry?.status);
  check(
    Boolean(nameEntry?.fields.some((field) => field.key === "name" && field.label === "نام فعالیت")),
    "برچسب فارسی «نام فعالیت» درج شده",
    JSON.stringify(nameEntry?.fields.map((field) => field.label)),
  );
  check(Boolean(nameEntry?.title.includes("—")), "عنوان ردیف «کد — نام» است", nameEntry?.title);

  const longer = base();
  longer.activities[0].duration += 3;
  const durationField = diffRevisions({ project: base() }, { project: longer })
    .groups[0].entries[0].fields.find((field) => field.key === "duration");
  check(durationField?.label === "مدت (روز کاری)", "برچسب مدت کاری درست است", durationField?.label);
  check(
    durationField?.before === String(base().activities[0].duration) &&
      durationField?.after === String(base().activities[0].duration + 3),
    "مقدار قبل/بعد مدت دقیق است",
    `${durationField?.before}→${durationField?.after}`,
  );

  const added = base();
  added.activities.push({ ...added.activities[0], id: "act-extra", code: "X-99", name: "فعالیت افزوده" });
  const addedDiff = diffRevisions({ project: base() }, { project: added });
  check(addedDiff.counts.added === 1 && addedDiff.counts.changed === 0, "فعالیت تازه «افزوده» شمرده می‌شود");
  const addedEntry = addedDiff.groups[0].entries[0];
  check(addedEntry.status === "added" && addedEntry.title === "X-99 — فعالیت افزوده", "عنوان ردیف افزوده درست است", addedEntry.title);
  check(addedEntry.fields.every((field) => field.before === null), "در ردیف افزوده، ستون «قبل» خالی است");

  const removed = base();
  removed.activities = removed.activities.slice(1);
  const removedDiff = diffRevisions({ project: base() }, { project: removed });
  check(removedDiff.counts.removed === 1, "حذف فعالیت گزارش می‌شود");
  check(removedDiff.groups[0].entries[0].fields.every((field) => field.after === null), "در ردیف حذف‌شده، ستون «بعد» خالی است");

  const cleared = base();
  cleared.activities = [];
  const clearedDiff = diffRevisions({ project: base() }, { project: cleared });
  check(clearedDiff.counts.removed === base().activities.length, "پاک‌کردن همه فعالیت‌ها همه را گزارش می‌کند", String(clearedDiff.counts.removed));

  console.log("\n▶ ۳. وابستگی‌ها و منابع");
  const linked = base();
  const first = linked.activities[0];
  const second = linked.activities[1];
  second.predecessors = [{ predecessorId: first.id, type: "FS", lag: 2 }];
  const linkField = diffRevisions({ project: base() }, { project: linked }).groups[0].entries[0].fields.find(
    (field) => field.key === "predecessors",
  );
  check(linkField?.label === "وابستگی‌ها", "برچسب وابستگی‌ها درست است");
  check(Boolean(linkField?.after?.includes(first.code)), "وابستگی جدید با کد فعالیت نمایش داده می‌شود", String(linkField?.after));
  check(Boolean(linkField?.after?.includes("FS +2")), "نوع و تأخیر مثبت در متن آمده", String(linkField?.after));

  const lead = base();
  lead.activities[1].predecessors = [{ predecessorId: lead.activities[0].id, type: "SS", lag: -3 }];
  const leadField = diffRevisions({ project: base() }, { project: lead }).groups[0].entries[0].fields.find(
    (field) => field.key === "predecessors",
  );
  check(Boolean(leadField?.after?.includes("SS −3")), "تأخیر منفی با علامت درست نوشته می‌شود", String(leadField?.after));

  const unlinked = base();
  unlinked.activities[1].predecessors = [];
  const unlinkedField = diffRevisions({ project: base() }, { project: unlinked }).groups[0].entries[0].fields.find(
    (field) => field.key === "predecessors",
  );
  check(unlinkedField?.after === "بدون وابستگی", "حذف همه وابستگی‌ها صریح است", String(unlinkedField?.after));

  const resourced = base();
  const resource = resourced.resources[0];
  resourced.activities[0].resources = [{ resourceId: resource.id, units: 2 }];
  const resourceField = diffRevisions({ project: base() }, { project: resourced }).groups[0].entries[0].fields.find(
    (field) => field.key === "resources",
  );
  check(Boolean(resourceField?.after?.includes("× 2")), "تخصیص منبع با تعداد نمایش داده می‌شود", String(resourceField?.after));
  check(Boolean(resourceField?.after?.includes(resource.name)), "نام منبع در متن آمده", String(resourceField?.after));

  console.log("\n▶ ۴. تنظیمات پروژه");
  const priced = base();
  if (!priced.pricing) throw new Error("template has no pricing block");
  priced.pricing.overheadPercent += 5;
  const pricedDiff = diffRevisions({ project: base() }, { project: priced });
  check(pricedDiff.settings.some((field) => field.key === "overheadPercent"), "درصد بالاسری در تنظیمات گزارش می‌شود");
  check(pricedDiff.counts.changed === 1, "بلوک تنظیمات یک تغییر شمرده می‌شود (نه هر فیلد)", String(pricedDiff.counts.changed));

  const renamedProject = base();
  renamedProject.meta.name = "نام دیگر";
  const metaField = diffRevisions({ project: base() }, { project: renamedProject }).settings[0];
  check(metaField.label === "نام پروژه" && metaField.before === "پروژه آزمون تفاوت", "نام پروژه با برچسب فارسی گزارش می‌شود", JSON.stringify(metaField));

  const holiday = base();
  holiday.calendar.holidays = [...holiday.calendar.holidays, "2026-03-21"];
  const holidayField = diffRevisions({ project: base() }, { project: holiday }).settings.find(
    (field) => field.key === "holidays",
  );
  check(holidayField?.after === `${holiday.calendar.holidays.length} روز`, "تعداد تعطیلات نمایش داده می‌شود", String(holidayField?.after));

  const emptyManager = base();
  delete (emptyManager.meta as { manager?: string }).manager; // absent …
  const blankManager = base();
  blankManager.meta.manager = ""; // … versus an explicit empty string
  check(
    diffRevisions({ project: emptyManager }, { project: blankManager }).identical,
    "مقدار خالی در برابر مقدار ناموجود، تغییر نیست",
  );

  console.log("\n▶ ۵. پوشش کامل (هیچ تغییری پنهان نمی‌شود)");
  const custom = base();
  (custom.activities[0] as unknown as Record<string, unknown>).customField = 42;
  const customField = diffRevisions({ project: base() }, { project: custom }).groups[0].entries[0].fields.find(
    (field) => field.key === "customField",
  );
  check(customField !== undefined, "فیلد ناشناخته هم گزارش می‌شود", JSON.stringify(customField));
  check(customField?.label === "customField", "فیلد ناشناخته، برچسب ساختگی نمی‌گیرد", customField?.label);

  const risky = base();
  risky.risks = risky.risks.slice(0, 1);
  risky.risks[0].probability = 5;
  const riskGroups = diffRevisions({ project: base() }, { project: risky }).groups.map((group) => group.key);
  check(riskGroups.includes("risks"), "گروه ریسک‌ها وقتی تغییر کند ظاهر می‌شود", riskGroups.join(","));

  const baselined = base();
  baselined.baseline = { name: "مبنا", createdAt: "2026-01-01", activities: [] };
  const baselineGroup = diffRevisions({ project: base() }, { project: baselined }).groups.find(
    (group) => group.key === "baseline",
  );
  check(baselineGroup !== undefined && baselineGroup.entries[0].status === "changed", "افزودن خط مبنا گزارش می‌شود");

  const optionsDiff = diffRevisions(
    { project: base(), reportOptions: { showCharts: true } },
    { project: base(), reportOptions: { showCharts: false } },
  );
  check(
    optionsDiff.groups.some((group) => group.key === "reportOptions"),
    "تغییر تنظیمات گزارش گروه جدا دارد",
    optionsDiff.groups.map((group) => group.key).join(","),
  );

  const milestone = base();
  milestone.milestones = [...milestone.milestones, { id: "ms-extra", name: "تحویل فاز آزمون", date: "2026-06-01" }];
  const milestoneGroup = diffRevisions({ project: base() }, { project: milestone }).groups.find(
    (group) => group.key === "milestones",
  );
  check(milestoneGroup?.entries[0]?.status === "added", "نقطه عطف تازه گزارش می‌شود");

  console.log("\n▶ ۶. پایداری و ترتیب");
  const mixed = base();
  mixed.activities[1].progress = 55;
  mixed.activities[3].name = "نام سوم";
  mixed.activities.push({ ...mixed.activities[0], id: "zzz", code: "Z-1", name: "آخر" });
  const runA = diffRevisions({ project: base() }, { project: mixed });
  const runB = diffRevisions({ project: clone(base()) }, { project: clone(mixed) });
  check(canonical(shape(runA)) === canonical(shape(runB)), "اجرای دوباره، دقیقاً همان ساختار را می‌دهد");
  const order = shape(runA).filter((item) => item.startsWith("activities/"));
  check(
    order.every((item, index) => index === 0 || order[index - 1].split(":")[0] <= item.split(":")[0]),
    "ردیف‌ها بر اساس شناسه مرتب‌اند (بی‌توجه به ترتیب ذخیره)",
    order.join(" | "),
  );
  const totals = runA.counts.added + runA.counts.removed + runA.counts.changed;
  check(runA.counts.total === totals, "جمع شمارش‌ها با کل برابر است", `${runA.counts.total}/${totals}`);
  check(!runA.identical && diffHeadline(runA).includes("مورد"), "سرخط فارسی تعداد تغییرات را می‌گوید", diffHeadline(runA));

  const quantity = base();
  quantity.activities[0].quantity = { unit: "مترمکعب", planned: 100, actual: 40, approved: 30 };
  const quantityField = diffRevisions({ project: base() }, { project: quantity }).groups[0].entries[0].fields.find(
    (field) => field.key === "quantity",
  );
  check(quantityField?.after === "100/40/30 مترمکعب", "کارکرد متره با برنامه‌ای/واقعی/تأییدشده نمایش داده می‌شود", String(quantityField?.after));

  console.log(
    failures.length === 0 ? `\n✔ ${passed} بررسی تفاوت نسخه‌ها — همه موفق` : `\n✘ ${failures.length} خطا از ${passed + failures.length}`,
  );
  if (failures.length > 0) process.exit(1);
}

main();
