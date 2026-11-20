// Pembatas permintaan sederhana (jendela tetap, disimpan di memori proses).
// Cukup untuk satu server. Untuk beberapa server / produksi, ganti dengan penyimpanan bersama (mis. Redis).

const hits = new Map<string, { count: number; resetAt: number }>();

/** true = permintaan boleh lanjut; false = sudah melewati batas pada jendela waktu ini. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

/** true = kunci ini sudah melewati batas. Hanya membaca, tidak menambah hitungan. */
export function isRateLimited(key: string, max: number): boolean {
  const entry = hits.get(key);
  return !!entry && entry.resetAt > Date.now() && entry.count >= max;
}

/** Catat satu kegagalan pada kunci ini (jendela tetap, sama seperti rateLimit). */
export function recordFailure(key: string, windowMs: number): void {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
  else entry.count += 1;
}

/** Hapus hitungan (dipakai setelah login berhasil). */
export function clearRateLimit(key: string): void {
  hits.delete(key);
}

/**
 * Alamat klien untuk batas per-IP. Diambil dari entri TERAKHIR X-Forwarded-For, yaitu yang ditambahkan
 * proxy tepercaya (Tailscale Funnel); entri di depannya bisa diisi bebas oleh klien untuk mengakali batas.
 */
export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || "unknown";
}
