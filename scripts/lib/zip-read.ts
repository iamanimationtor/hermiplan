/**
 * Minimal ZIP reader (central directory + inflate) shared by the verification
 * scripts. It exists only in `scripts/`: the application writes archives and
 * never has to read one back, so no runtime dependency is added.
 *
 * `crcOk` compares the stored CRC-32 with the CRC computed over the inflated
 * bytes, so a subtly truncated or corrupted entry cannot pass as "present".
 */
import { inflateRawSync } from "node:zlib";

export interface ReadZipEntry {
  name: string;
  data: Buffer;
  crcOk: boolean;
}

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc ^= data[index];
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function readZip(buffer: Buffer): ReadZipEntry[] {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("ZIP end-of-central-directory not found");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ReadZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("bad central directory header");
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    entries.push({ name, data, crcOk: crc32(data) === crc });
  }
  return entries;
}
