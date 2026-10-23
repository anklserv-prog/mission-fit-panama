// Utilidades compartidas por la API (Cloudflare Pages Functions + D1).

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const ROLE_RANK = { user: 1, admin: 2, creator: 3 };
export const PAYMENT_METHODS = ['efectivo', 'tarjeta', 'yapi'];

// Iconos que el usuario puede asignar a un producto (se guarda el carácter).
export const PRODUCT_ICONS = [
  '💧', '🥤', '🧃', '☕', '🍵', '🧋', '🥛', '🍺', '🍷', '🍹',
  '🍫', '🍪', '🥜', '🍿', '🍟', '🥪', '🍌', '🍎', '🍊', '🥗',
  '🍗', '🍝', '🥤', '🧊', '🏋️', '🧴', '👕', '🧢', '🎽', '📦',
];

export function requireIcon(v) {
  if (v === undefined || v === null || v === '') return '📦';
  if (!PRODUCT_ICONS.includes(v)) throw new HttpError(400, 'Icono no válido');
  return v;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function fail(status, message, extra = {}) {
  return json({ error: message, ...extra }, status);
}

// Un cuerpo vacío se trata como {} (por ejemplo, el check-out no necesita datos).
export async function readBody(request) {
  const text = await request.text();
  if (!text.trim()) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'El cuerpo de la petición debe ser JSON válido');
  }
  return body && typeof body === 'object' ? body : {};
}

export const newId = () => crypto.randomUUID();

const enc = new TextEncoder();

export function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
}

// PBKDF2-SHA256. Cloudflare Workers limita a 100 000 iteraciones.
export async function hashPassword(password, saltHex) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

export async function verifyPassword(password, hash, saltHex) {
  const result = await hashPassword(password, saltHex);
  return result.hash === hash;
}

export async function sha256Hex(text) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

export function randomToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

// Panamá usa UTC-05:00 todo el año (sin horario de verano).
const PANAMA_OFFSET_MS = -5 * 60 * 60 * 1000;

export function todayPanama() {
  return new Date(Date.now() + PANAMA_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Días entre dos fechas YYYY-MM-DD: a - b.
export function daysBetween(a, b) {
  return Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000);
}

export function membershipStatus(endDate, today) {
  if (!endDate) return 'sin_membresia';
  const d = daysBetween(endDate, today);
  if (d < 0) return 'vencida';
  if (d <= 7) return 'por_vencer';
  return 'activa';
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function requireDay(v, name) {
  if (typeof v !== 'string' || !DAY_RE.test(v)) throw new HttpError(400, `${name} debe tener formato AAAA-MM-DD`);
  return v;
}

export function requireString(v, name, max = 200) {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${name} es obligatorio`);
  return v.trim().slice(0, max);
}

export function optString(v, max = 200) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  return String(v).trim().slice(0, max);
}

export function requireNumber(v, name, min = 0) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new HttpError(400, `${name} inválido`);
  return n;
}

export function requireInt(v, name, min = 0) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new HttpError(400, `${name} inválido`);
  return n;
}

export function requireMethod(v) {
  if (!PAYMENT_METHODS.includes(v)) throw new HttpError(400, 'Método de pago inválido');
  return v;
}

export function isUniqueError(err) {
  return String(err && err.message).includes('UNIQUE');
}
