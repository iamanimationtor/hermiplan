function wellFormedUnicode(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0xd800 && codePoint <= 0xdfff ? "\uFFFD" : character;
  }).join("");
}

/** Sanitizes filenames before assigning them to an <a download> attribute. */
export function safeDownloadFilename(value: string, fallback = "HERMIPLAN-export.bin"): string {
  const safe = Array.from(wellFormedUnicode(value).normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-]+|[.\-]+$/g, ""))
    .slice(0, 160)
    .join("");
  return safe || fallback;
}

/** Reads RFC 5987 filename* first, then the ASCII filename fallback. */
export function downloadFilenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return safeDownloadFilename(fallback);

  const extended = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]?.trim();
  if (extended) {
    try {
      return safeDownloadFilename(decodeURIComponent(extended.replace(/^"|"$/g, "")), fallback);
    } catch {
      // A malformed header must not block the download; try filename= next.
    }
  }

  const legacy = header.match(/filename\s*=\s*(?:"([^"]*)"|([^;\s]*))/i);
  return safeDownloadFilename(legacy?.[1] ?? legacy?.[2] ?? fallback, fallback);
}
