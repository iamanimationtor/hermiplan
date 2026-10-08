"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { buildActivitiesFromImport, parseActivityImport, IMPORT_SAMPLE } from "@/lib/import";
import { toPersianDigits } from "@/lib/date-fa";
import type { ProjectApi } from "./useProject";
import type { ProjectInput } from "@/lib/engine/types";

/* ------------------------- quick add activity ------------------------- */

export function QuickAdd({
  project,
  api,
  compact = false,
}: {
  project: ProjectInput;
  api: ProjectApi;
  compact?: boolean;
}) {
  const phases = useMemo(
    () => Array.from(new Set(project.activities.map((a) => a.phase))),
    [project.activities],
  );
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("5");
  const [phase, setPhase] = useState(phases[phases.length - 1] ?? "فاز ۱");

  const submit = () => {
    if (!name.trim()) return;
    api.addQuick(name, Number(duration) || 1, phase);
    setName("");
    setDuration("5");
  };

  return (
    <div
      className={`flex flex-wrap items-end gap-2 rounded-2xl border border-brand-100 bg-brand-50/50 p-3 ${
        compact ? "" : "sm:p-4"
      }`}
    >
      <div className="min-w-[180px] flex-1">
        <Field label="افزودن سریع فعالیت">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="مثلاً: اجرای دیوار برشی طبقه اول"
          />
        </Field>
      </div>
      <div className="w-[110px]">
        <Field label="مدت (روز)">
          <Input
            type="number"
            min={0}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </Field>
      </div>
      <div className="min-w-[150px]">
        <Field label="فاز">
          <Select
            value={phases.includes(phase) ? phase : (phases[phases.length - 1] ?? phase)}
            onChange={(e) => setPhase(e.target.value)}
          >
            {(phases.includes(phase) ? phases : [...phases, phase]).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button onClick={submit} disabled={!name.trim()} className="mb-[2px]">
        افزودن
      </Button>
    </div>
  );
}

/* --------------------------- bulk import --------------------------- */

export function ImportDialog({
  open,
  onClose,
  project,
  api,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectInput;
  api: ProjectApi;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"append" | "replace">("append");

  const parsed = useMemo(() => (text.trim() ? parseActivityImport(text) : null), [text]);
  const preview = useMemo(
    () => (parsed ? buildActivitiesFromImport(parsed) : null),
    [parsed],
  );
  // row lookup by name is O(1) instead of a scan per preview row
  const rowByName = useMemo(
    () => new Map(parsed?.rows.map((row) => [row.name, row])),
    [parsed],
  );

  const apply = () => {
    if (!preview) return;
    api.importActivities(preview.activities, mode);
    onClose();
    setText("");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="درون‌ریزی سریع فعالیت‌ها"
      wide
      footer={
        <>
          <span className="me-auto text-[11.5px] text-slate-500">
            {preview
              ? `${toPersianDigits(preview.activities.length)} فعالیت · ${toPersianDigits(preview.phaseCount)} فاز · ${toPersianDigits(preview.linkedPredecessors)} وابستگی`
              : "متن را وارد یا از اکسل Paste کنید"}
          </span>
          <Button variant="ghost" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={apply} disabled={!preview || !preview.activities.length}>
            {mode === "replace" ? "جایگزینی کل فعالیت‌ها" : "افزودن به پروژه"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-xl border border-brand-100 bg-brand-50/60 p-3 text-[12.5px] leading-7 text-slate-600">
          فهرست فعالیت‌ها را از <b>Excel</b>، Google Sheets یا هر فایل متنی کپی و در کادر زیر Paste کنید.
          ستون‌ها با <b>Tab</b>، ویرگول یا سمی‌کالن جدا می‌شوند و ترتیب پیش‌فرض عبارت است از:
          <span className="mx-1 font-mono text-[11.5px] text-brand-700">نام · مدت · فاز · پیشرفت · پیش‌نیاز · هزینه</span>
          . اگر سطر اول عنوان ستون‌ها باشد، به‌صورت خودکار شناسایی می‌شود.
        </p>

        <Field label="داده فعالیت‌ها">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            dir="auto"
            className="min-h-[190px] font-mono text-[12px]"
            placeholder={IMPORT_SAMPLE}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setText(IMPORT_SAMPLE)}>
            درج نمونه
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setText("")} disabled={!text}>
            پاک کردن
          </Button>
          <div className="flex-1" />
          <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="max-w-[240px]">
            <option value="append">افزودن به فعالیت‌های فعلی</option>
            <option value="replace">جایگزینی کامل فعالیت‌ها</option>
          </Select>
        </div>

        {preview ? (
          <div className="rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <span className="text-[12.5px] font-bold text-ink-900">پیش‌نمایش</span>
              <div className="flex gap-1.5">
                <Badge tone="info">{toPersianDigits(preview.activities.length)} فعالیت</Badge>
                <Badge tone="accent">{toPersianDigits(preview.phaseCount)} فاز</Badge>
                <Badge tone={preview.linkedPredecessors ? "ok" : "neutral"}>
                  {toPersianDigits(preview.linkedPredecessors)} وابستگی
                </Badge>
              </div>
            </div>
            <div className="thin-scroll max-h-[220px] overflow-y-auto p-3">
              <table className="w-full text-[11.5px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {["کد", "عنوان", "فاز", "مدت", "پیش‌نیاز", "هزینه"].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-right font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.activities.map((activity) => {
                    const source = rowByName.get(activity.name);
                    return (
                      <tr key={activity.id} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-mono text-[10.5px] text-slate-500">{activity.code}</td>
                        <td className="px-2 py-1.5 font-semibold text-ink-900">{activity.name}</td>
                        <td className="px-2 py-1.5 text-slate-500">{activity.phase}</td>
                        <td className="px-2 py-1.5">{toPersianDigits(activity.duration)}</td>
                        <td className="px-2 py-1.5 text-slate-500">{source?.predecessors.join("، ") || "—"}</td>
                        <td className="px-2 py-1.5 text-slate-500">
                          {activity.fixedCost ? toPersianDigits(activity.fixedCost) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {preview?.warnings.length ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11.5px] leading-6 text-amber-800">
            {preview.warnings.slice(0, 6).map((warning) => (
              <p key={warning}>⚠️ {warning}</p>
            ))}
            {preview.warnings.length > 6 ? (
              <p>و {toPersianDigits(preview.warnings.length - 6)} هشدار دیگر…</p>
            ) : null}
          </div>
        ) : null}

        {mode === "replace" ? (
          <p className="text-[11.5px] text-red-600">
            توجه: با جایگزینی کامل، {toPersianDigits(project.activities.length)} فعالیت فعلی حذف می‌شوند.
            با دکمه «واگردانی» در نوار بالا می‌توانید این عمل را برگردانید.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
