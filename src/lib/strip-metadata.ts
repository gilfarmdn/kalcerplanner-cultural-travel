// Membuang metadata (EXIF/GPS, XMP, komentar, teks) dari gambar unggahan SEBELUM disimpan, tanpa decode ulang piksel:
// kontainer JPEG / PNG / WebP ditulis ulang tanpa segmen metadatanya, jadi kualitas gambar tidak berubah dan tidak
// butuh pustaka native. Satu-satunya data EXIF yang dipertahankan adalah orientasi (agar foto ponsel tidak terputar).
// Mengembalikan null bila struktur berkas rusak (unggahan ditolak).

import type { ImageMime } from "@/lib/images";

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

export function stripImageMetadata(data: Uint8Array, mime: ImageMime): Buffer | null {
  try {
    const out = mime === "image/jpeg" ? stripJpeg(data) : mime === "image/png" ? stripPng(data) : stripWebp(data);
    return out ? Buffer.from(out) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- JPEG

/** Orientasi EXIF (1..8) dari segmen APP1, atau null. */
function exifOrientation(seg: Uint8Array): number | null {
  // seg = isi APP1 setelah panjang: "Exif\0\0" + TIFF.
  if (seg.length < 14 || ascii(seg, 0, 4) !== "Exif") return null;
  const t = seg.subarray(6);
  const little = ascii(t, 0, 2) === "II";
  if (!little && ascii(t, 0, 2) !== "MM") return null;
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o: number) => dv.getUint16(o, little);
  const u32 = (o: number) => dv.getUint32(o, little);
  if (t.length < 8 || u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > t.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) return null;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** APP1 minimal yang hanya memuat tag orientasi. */
function orientationOnlyExif(orientation: number): Uint8Array {
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // header big-endian, IFD0 di offset 8
    0x00, 0x01, // 1 entri
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT, 1 nilai
    0x00, 0x00, 0x00, 0x00, // tidak ada IFD berikutnya
  ];
  const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const len = body.length + 2;
  return Uint8Array.from([0xff, 0xe1, len >> 8, len & 0xff, ...body]);
}

function stripJpeg(b: Uint8Array): Uint8Array | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let orientation: number | null = null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i] === 0xff && i < b.length) i++; // padding 0xFF
    const marker = b[i++];
    if (marker === undefined) return null;
    if (marker === 0xd9) { // EOI
      parts.push(Uint8Array.of(0xff, 0xd9));
      return concat(withOrientation(parts, orientation));
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { // marker tanpa panjang
      parts.push(Uint8Array.of(0xff, marker));
      continue;
    }
    if (i + 2 > b.length) return null;
    const len = (b[i] << 8) | b[i + 1];
    if (len < 2 || i + len > b.length) return null;
    const seg = b.subarray(i + 2, i + len);
    const whole = b.subarray(i - 2, i + len);
    if (marker === 0xda) { // SOS: sisanya data terkompresi, salin apa adanya
      parts.push(b.subarray(i - 2));
      return concat(withOrientation(parts, orientation));
    }
    if (marker === 0xe1 && orientation === null) orientation = exifOrientation(seg);
    // Pertahankan segmen yang dibutuhkan untuk menampilkan gambar; buang sisanya (EXIF/XMP/komentar/APPn).
    const keep =
      marker === 0xe0 || // JFIF
      marker === 0xee || // Adobe (transformasi warna)
      (marker === 0xe2 && ascii(seg, 0, 11) === "ICC_PROFILE") ||
      !(marker >= 0xe1 && marker <= 0xef) && marker !== 0xfe;
    if (keep) parts.push(whole);
    i += len;
  }
  return null;
}

/** Sisipkan APP1 orientasi tepat setelah SOI / JFIF. */
function withOrientation(parts: Uint8Array[], orientation: number | null): Uint8Array[] {
  if (!orientation || orientation === 1) return parts;
  const out = [...parts];
  const at = out.length > 1 && out[1][1] === 0xe0 ? 2 : 1;
  out.splice(at, 0, orientationOnlyExif(orientation));
  return out;
}

// ---------------------------------------------------------------- PNG

const PNG_KEEP = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "bKGD", "pHYs", "acTL", "fcTL", "fdAT"]);

function stripPng(b: Uint8Array): Uint8Array | null {
  if (b.length < 8 || ascii(b, 1, 3) !== "PNG") return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  let sawEnd = false;
  while (i + 12 <= b.length) {
    const len = dv.getUint32(i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (PNG_KEEP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") { sawEnd = true; break; }
  }
  return sawEnd ? concat(parts) : null;
}

// ---------------------------------------------------------------- WebP

function stripWebp(b: Uint8Array): Uint8Array | null {
  if (b.length < 12 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const size = dv.getUint32(i + 4, true);
    const end = i + 8 + size + (size & 1);
    if (i + 8 + size > b.length) return null;
    const chunk = b.slice(i, Math.min(end, b.length));
    if (type === "VP8X") chunk[8] &= ~0x0c; // matikan penanda EXIF (0x08) dan XMP (0x04)
    if (type !== "EXIF" && type !== "XMP ") chunks.push(chunk);
    i = end;
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 4), 0);
  new DataView(header.buffer).setUint32(4, 4 + body.length, true);
  header.set(b.subarray(8, 12), 8);
  return concat([header, body]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
