// Content-Security-Policy berbasis nonce. Dibuat per permintaan di middleware (edge), sehingga tanpa 'unsafe-inline'
// pada script-src: hanya skrip bawaan Next.js (yang menerima nonce otomatis dari header permintaan) dan skrip dari
// sumber yang disebut di bawah yang boleh jalan. Sumber luar: Cloudflare Turnstile dan tile peta OpenStreetMap.

export function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    // 'unsafe-eval' hanya di mode dev (React Refresh).
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
    // Gaya inline masih dipakai React/Next (atribut style) dan widget Turnstile; skrip adalah vektor yang berbahaya.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
