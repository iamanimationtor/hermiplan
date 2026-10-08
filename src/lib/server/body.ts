import { NextResponse } from "next/server";

export const MAX_BODY_BYTES = 3_000_000;

export type ReadJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; response: NextResponse };

/**
 * Reads and parses a JSON request body under a hard size cap.
 *
 * The body is streamed and aborted the moment the cap is exceeded, so an
 * oversized payload never fully lands in memory. The Content-Length header is
 * only a fast-path pre-check: it can be absent (chunked encoding) or spoofed,
 * so the authoritative limit is enforced while streaming.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<ReadJsonResult> {
  const tooLarge = () =>
    NextResponse.json({ error: "حجم داده پروژه بیش از حد مجاز است" }, { status: 413 });
  const invalid = () =>
    NextResponse.json({ error: "بدنه درخواست معتبر نیست" }, { status: 400 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, response: tooLarge() };
  }

  const reader = request.body?.getReader();
  if (!reader) {
    try {
      return { ok: true, body: await request.json() };
    } catch {
      return { ok: false, response: invalid() };
    }
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, response: tooLarge() };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false, response: invalid() };
  }

  const text = new TextDecoder().decode(
    chunks.length === 1 ? chunks[0] : Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
  );
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: invalid() };
  }
}
