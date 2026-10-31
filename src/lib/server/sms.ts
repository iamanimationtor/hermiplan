/**
 * SMS delivery adapter for OTP codes.
 *
 * Design rules (security + honesty):
 *  • The provider is reachable only from the server; the API key never leaves
 *    this module and is never logged.
 *  • A delivery failure is reported as a failure. The API must never claim a
 *    code was sent when the provider rejected it.
 *  • Demo mode (returning the code in the HTTP response) is only available
 *    outside production and only with an explicit opt-in flag.
 */

export type SmsProviderId = "kavenegar" | "http";

export interface SmsResult {
  ok: boolean;
  /** Safe, user-facing failure reason (never contains the key or the URL). */
  reason?: string;
  provider?: SmsProviderId;
}

export type SmsConfig =
  | { configured: false; reason: string }
  | {
      configured: true;
      provider: SmsProviderId;
      apiKey: string;
      /** Kavenegar verify-lookup template name. */
      template?: string;
      /** Generic HTTP endpoint (provider = "http"). */
      url?: string;
      sender?: string;
    };

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Reads provider configuration from the environment.
 * `SMS_PROVIDER` selects the adapter; when it is absent the Kavenegar-style
 * verify-lookup API is assumed (the historical provider of this project).
 */
export function readSmsConfig(env: NodeJS.ProcessEnv = process.env): SmsConfig {
  const apiKey = env.SMS_PROVIDER_KEY?.trim();
  const provider = (env.SMS_PROVIDER?.trim() || "kavenegar") as SmsProviderId;

  if (!apiKey) {
    return { configured: false, reason: "SMS_PROVIDER_KEY is not set" };
  }
  if (provider === "http") {
    const url = env.SMS_PROVIDER_URL?.trim();
    if (!url) return { configured: false, reason: "SMS_PROVIDER_URL is not set for provider= http" };
    return { configured: true, provider, apiKey, url, sender: env.SMS_PROVIDER_SENDER?.trim() || undefined };
  }
  if (provider !== "kavenegar") {
    return { configured: false, reason: `unsupported SMS_PROVIDER "${provider}"` };
  }
  const template = env.SMS_OTP_TEMPLATE?.trim();
  if (!template) {
    return { configured: false, reason: "SMS_OTP_TEMPLATE is not set for provider= kavenegar" };
  }
  return { configured: true, provider, apiKey, template };
}

/** true only outside production and only with the explicit opt-in flag. */
export function demoOtpAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.HERMIPLAN_ALLOW_DEMO_OTP === "1";
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

async function deliver(
  config: Extract<SmsConfig, { configured: true }>,
  phone: string,
  code: string,
  fetchImpl: typeof fetch,
): Promise<SmsResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    if (config.provider === "http") {
      const response = await fetchImpl(config.url as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ phone, code, sender: config.sender }),
        signal: controller.signal,
      });
      if (!response.ok) return { ok: false, reason: `HTTP ${response.status}`, provider: "http" };
      return { ok: true, provider: "http" };
    }

    // Kavenegar verify/lookup: https://kavenegar.com/rest.html
    const url = new URL(
      `https://api.kavenegar.com/v1/${encodeURIComponent(config.apiKey)}/verify/lookup.json`,
    );
    url.searchParams.set("receptor", phone);
    url.searchParams.set("token", code);
    url.searchParams.set("template", config.template as string);
    const response = await fetchImpl(url, { method: "GET", signal: controller.signal });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}`, provider: "kavenegar" };
    const payload = (await response.json().catch(() => null)) as
      | { return?: { status?: number; message?: string } }
      | null;
    if (payload?.return && typeof payload.return.status === "number" && payload.return.status !== 200) {
      return {
        ok: false,
        reason: `provider status ${payload.return.status}`,
        provider: "kavenegar",
      };
    }
    return { ok: true, provider: "kavenegar" };
  } catch (error) {
    const name = (error as Error)?.name;
    return {
      ok: false,
      reason: name === "AbortError" ? "timeout" : "network error",
      provider: config.provider,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends an OTP code. Never throws: the caller decides how to present a failure.
 * No secret material is written to the logs — only the masked phone and the
 * provider's machine-readable status.
 */
export async function sendOtpSms(
  phone: string,
  code: string,
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<SmsResult> {
  const env = options.env ?? process.env;
  const config = readSmsConfig(env);
  if (!config.configured) {
    return { ok: false, reason: config.reason };
  }
  const result = await deliver(config, phone, code, options.fetchImpl ?? fetch);
  if (!result.ok) {
    console.error(`[sms] delivery failed for ${maskPhone(phone)} via ${config.provider}: ${result.reason}`);
  }
  return result;
}
