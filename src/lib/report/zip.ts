import { deflateRawSync } from "node:zlib";

/**
 * Small ZIP writer used for the Open XML workbook and delivery package.
 * Entries are CRC-checked, UTF-8 named, and may use standard DEFLATE.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  content: string | Uint8Array;
}

export interface ZipOptions {
  /** 0 stores entries unchanged; 1..9 use DEFLATE. */
  compressionLevel?: number;
}

function toBytes(content: string | Uint8Array): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return content;
}

function dosDateTime(date = new Date()): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

/** Builds a valid ZIP archive as a Uint8Array. */
export function createZip(entries: ZipEntry[], options: ZipOptions = {}): Uint8Array {
  if (entries.length > 0xffff) throw new RangeError("ZIP64 is not supported: too many entries");
  const level = Math.trunc(options.compressionLevel ?? 0);
  if (level < 0 || level > 9) throw new RangeError("ZIP compressionLevel must be between 0 and 9");

  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    if (nameBytes.length > 0xffff) throw new RangeError(`ZIP entry name is too long: ${entry.name}`);
    const raw = toBytes(entry.content);
    const compressed = level === 0 ? raw : deflateRawSync(raw, { level });
    const method = level === 0 ? 0 : 8;
    const crc = crc32(raw);
    if (raw.length > 0xffffffff || compressed.length > 0xffffffff || offset > 0xffffffff) {
      throw new RangeError("ZIP64 is not supported: entry/archive exceeds 4 GiB");
    }

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, 0x0800, true); // UTF-8 flag
    localView.setUint16(8, method, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, compressed.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localChunks.push(local, compressed);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true); // creator version
    centralView.setUint16(6, 20, true); // version needed
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, method, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true); // extra length
    centralView.setUint16(32, 0, true); // comment length
    centralView.setUint16(34, 0, true); // disk number
    centralView.setUint16(36, 0, true); // internal attributes
    centralView.setUint32(38, 0, true); // external attributes
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralChunks.push(central);

    offset += local.length + compressed.length;
  }

  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (centralSize > 0xffffffff || offset + centralSize > 0xffffffff) {
    throw new RangeError("ZIP64 is not supported: archive exceeds 4 GiB");
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true); // disk number
  endView.setUint16(6, 0, true); // central directory disk
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of [...localChunks, ...centralChunks, end]) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}
