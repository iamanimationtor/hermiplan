"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Field, Input, Modal } from "@/components/ui";

/**
 * Sign-in panel.
 *
 * Username + password only. The SMS flow is intentionally absent from the UI:
 * it needs a paid provider and a working mobile line, while a password is
 * something every user already has. The API still answers the old OTP actions
 * for existing integrations, but nothing here depends on them.
 */
interface SessionUser {
  id: string;
  username: string | null;
  phone: string | null;
  displayName: string | null;
}

const label = (user: SessionUser) => user.displayName?.trim() || user.username || user.phone || "کاربر";

export function AuthMenu() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((data: { user: SessionUser | null }) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  function reset() {
    setUsername("");
    setPassword("");
    setConfirm("");
    setError(null);
    setMessage(null);
  }

  async function submit() {
    if (mode === "register" && password !== confirm) {
      setError("دو رمز عبور یکسان نیستند");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, username, password }),
      });
      const data = (await response.json()) as {
        error?: string;
        user?: SessionUser;
        claimedProjects?: number;
      };
      if (!response.ok) throw new Error(data.error ?? "ورود ناموفق بود");
      setUser(data.user ?? null);
      setMessage(
        mode === "register"
          ? "حساب ساخته شد و وارد شدید." +
            (data.claimedProjects ? ` ${data.claimedProjects} پروژهٔ این مرورگر به حساب منتقل شد.` : "")
          : "خوش آمدید." +
            (data.claimedProjects ? ` ${data.claimedProjects} پروژهٔ این مرورگر به حساب منتقل شد.` : ""),
      );
      reset();
      setOpen(false);
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

  const canSubmit =
    username.trim().length >= 3 &&
    password.length >= 8 &&
    (mode === "login" || password === confirm);

  return (
    <>
      {user ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-brand-700 transition hover:bg-brand-50"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-brand-100 text-[10px]">👤</span>
          <span dir="auto">{label(user)}</span>
        </button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          ورود / ثبت‌نام
        </Button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={user ? "حساب کاربری" : "ورود / ثبت‌نام"}>
        {user ? (
          <div className="space-y-4 text-[13px]">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="font-semibold text-ink-900">حساب فعال</p>
              <p className="mt-1 text-[13px] text-slate-700" dir="auto">
                {label(user)}
              </p>
              {user.username ? (
                <p className="mt-1 text-[11.5px] text-slate-500" dir="ltr">
                  @{user.username}
                </p>
              ) : null}
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
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-[12px] font-semibold">
              {(["login", "register"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setMode(value);
                    setError(null);
                  }}
                  className={`flex-1 rounded-lg px-3 py-1.5 transition ${
                    mode === value ? "bg-white text-brand-800 shadow-sm" : "text-slate-500"
                  }`}
                >
                  {value === "login" ? "ورود" : "ثبت‌نام"}
                </button>
              ))}
            </div>

            <p className="text-[12px] leading-6 text-slate-500">
              ورود با نام کاربری و رمز عبور است؛ پیامک لازم نیست. پروژه‌های ساخته‌شده در این مرورگر پس از
              ورود به حساب منتقل می‌شوند و از هر دستگاهی در دسترس خواهند بود.
            </p>

            <Field label="نام کاربری" hint="حروف انگلیسی، رقم، نقطه، خط تیره و زیرخط — ۳ تا ۳۲ نویسه">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                dir="ltr"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="ali.rezaei"
              />
            </Field>

            <Field
              label="رمز عبور"
              hint={mode === "register" ? "حداقل ۸ نویسه، شامل حرف و رقم" : undefined}
            >
              <div className="flex gap-2">
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={showPassword ? "text" : "password"}
                  dir="ltr"
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="shrink-0 rounded-lg border border-slate-200 px-2.5 text-[11px] text-slate-600 transition hover:bg-slate-50"
                  aria-label={showPassword ? "پنهان کردن رمز" : "نمایش رمز"}
                >
                  {showPassword ? "پنهان" : "نمایش"}
                </button>
              </div>
            </Field>

            {mode === "register" ? (
              <Field label="تکرار رمز عبور">
                <Input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
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
              <Button onClick={submit} disabled={busy || !canSubmit}>
                {busy ? "…" : mode === "login" ? "ورود" : "ساخت حساب"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
