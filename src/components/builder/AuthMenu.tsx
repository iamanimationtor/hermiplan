"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Field, Input, Modal } from "@/components/ui";
import { toPersianDigits } from "@/lib/date-fa";

interface SessionUser {
  id: string;
  phone: string;
  displayName: string | null;
}

export function AuthMenu() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((data: { user: SessionUser | null }) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", phone }),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        code?: string;
        demoMode?: boolean;
        loginUnavailable?: boolean;
      };
      if (!response.ok) throw new Error(data.error ?? "خطا در ارسال کد");
      if (data.loginUnavailable) {
        setError(data.message ?? data.error ?? "ورود با موبایل در این نصب فعال نیست.");
        return;
      }
      setMessage(
        data.demoMode && data.code
          ? `${data.message ?? ""} کد نمایشی: ${toPersianDigits(data.code)}`
          : (data.message ?? "کد تأیید ارسال شد."),
      );
      setStage("code");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", phone, code }),
      });
      const data = (await response.json()) as { error?: string; user?: SessionUser };
      if (!response.ok) throw new Error(data.error ?? "کد نامعتبر است");
      setUser(data.user ?? null);
      setMessage("ورود با موفقیت انجام شد.");
      setStage("phone");
      setCode("");
      setTimeout(() => setOpen(false), 700);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    setUser(null);
    setOpen(false);
  }

  return (
    <>
      {user ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-brand-700 transition hover:bg-brand-50"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-brand-100 text-[10px]">👤</span>
          <span dir="ltr">{user.phone}</span>
        </button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          ورود با موبایل
        </Button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={user ? "حساب کاربری" : "ورود / ثبت‌نام"}>
        {user ? (
          <div className="space-y-4 text-[13px]">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="font-semibold text-ink-900">حساب فعال</p>
              <p className="mt-1 text-[12px] text-slate-500" dir="ltr">
                {user.phone}
              </p>
              <p className="mt-2 text-[11.5px] text-slate-500">
                پروژه‌های ساخته‌شده در این مرورگر به این حساب متصل شدند.
              </p>
            </div>
            <Badge tone="ok">پروژه‌های این دستگاه به حساب شما متصل می‌شوند</Badge>
            <div className="flex justify-end">
              <Button variant="danger" onClick={logout}>
                خروج از حساب
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[12.5px] leading-7 text-slate-500">
              استفاده از HERMIPLAN نیازمند ثبت‌نام نیست. با ورود با شماره موبایل، پروژه‌های شما برای دسترسی از
              دستگاه‌های مختلف و ساخت Workspace ذخیره می‌شود.
            </p>
            <Field label="شماره موبایل" hint="نمونه: ۰۹۱۲۳۴۵۶۷۸۹">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
                inputMode="tel"
                placeholder="09123456789"
              />
            </Field>
            {stage === "code" ? (
              <Field label="کد تأیید ۵ رقمی">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={5}
                />
              </Field>
            ) : null}
            {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
            {message ? (
              <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] font-semibold text-brand-800">
                {message}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              {stage === "code" ? (
                <Button variant="secondary" onClick={() => setStage("phone")}>
                  تغییر شماره
                </Button>
              ) : null}
              <Button onClick={stage === "code" ? verify : requestCode} disabled={busy || phone.length < 10}>
                {busy ? "…" : stage === "code" ? "تأیید و ورود" : "دریافت کد تأیید"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
