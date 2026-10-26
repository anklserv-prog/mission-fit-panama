// API de Mission Fit. Todas las rutas viven bajo /api/*.
import { ensureDb } from '../../lib/schema.js';
import {
  HttpError, json, fail, readBody, newId, hashPassword, verifyPassword, sha256Hex, randomToken,
  todayPanama, addDays, daysBetween, membershipStatus, ROLE_RANK,
  requireString, optString, requireNumber, requireInt, requireMethod, requireDay, isUniqueError, requireIcon,
  requireYappyRef, normalizePhonePA, newClientCode,
} from '../../lib/util.js';

const SESSION_DAYS = 30;
const ROUTES = [];

// minRole: 'public' | 'user' | 'admin' | 'creator'
function route(method, pattern, minRole, handler) {
  ROUTES.push({ method, pattern, minRole, handler });
}

export async function onRequest({ request, env, params }) {
  if (!env.DB) return fail(500, 'Base de datos no configurada (falta el binding DB)');
  try {
    await ensureDb(env.DB);

    const method = request.method.toUpperCase();
    const path = (Array.isArray(params.path) ? params.path : [params.path]).filter(Boolean).join('/');

    let matched = null;
    let pathExists = false;
    for (const r of ROUTES) {
      const m = path.match(r.pattern);
      if (!m) continue;
      pathExists = true;
      if (r.method === method) {
        matched = { route: r, args: m.slice(1) };
        break;
      }
    }
    if (!matched) return pathExists ? fail(405, 'Método no permitido') : fail(404, 'Ruta no encontrada');

    const { route: r, args } = matched;
    const ctx = {
      db: env.DB,
      env,
      request,
      url: new URL(request.url),
      args,
      user: null,
      body: null,
    };

    if (r.minRole !== 'public') ctx.user = await authenticate(env.DB, request, r.minRole);
    if (['POST', 'PUT', 'PATCH'].includes(method)) ctx.body = await readBody(request);

    return await r.handler(ctx);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error(err);
    return fail(500, 'Error interno del servidor');
  }
}

// ---------------------------------------------------------------------------
// Autenticación y roles
// ---------------------------------------------------------------------------

async function authenticate(db, request, minRole) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Sesión requerida');

  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.active, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  ).bind(tokenHash).first();

  if (!row || !row.active || row.expires_at < Date.now()) {
    throw new HttpError(401, 'Sesión expirada, vuelve a ingresar');
  }
  if (ROLE_RANK[row.role] < ROLE_RANK[minRole]) {
    throw new HttpError(403, 'No tienes permiso para esta acción');
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role, tokenHash };
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active };
}

async function createUser(db, { email, name, password, role }) {
  const e = requireString(email, 'Email', 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'Email inválido');
  const n = requireString(name, 'Nombre', 120);
  const p = typeof password === 'string' ? password : '';
  if (p.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');

  const { hash, salt } = await hashPassword(p);
  const id = newId();
  try {
    await db.prepare(
      'INSERT INTO users (id, email, name, role, password_hash, salt) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, e, n, role, hash, salt).run();
  } catch (err) {
    if (isUniqueError(err)) throw new HttpError(409, 'Ese email ya está registrado');
    throw err;
  }
  return { id, email: e, name: n, role, active: 1 };
}

route('GET', /^status$/, 'public', async ({ db }) => {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'creator'").first();
  return json({ configured: row.n > 0 });
});

// Primer arranque: crea el usuario creador. Solo funciona si aún no existe ningún creador.
route('POST', /^setup$/, 'public', async ({ db, body }) => {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'creator'").first();
  if (row.n > 0) throw new HttpError(403, 'El sistema ya está configurado');
  const user = await createUser(db, { ...body, role: 'creator' });
  return json({ user }, 201);
});

route('POST', /^login$/, 'public', async ({ db, body }) => {
  const email = requireString(body.email, 'Email', 120).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const row = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  const ok = row && row.active && await verifyPassword(password, row.password_hash, row.salt);
  if (!ok) throw new HttpError(401, 'Email o contraseña incorrectos');

  const token = randomToken();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), row.id, Date.now() + SESSION_DAYS * 86400000).run();
  return json({ token, user: publicUser(row) });
});

route('POST', /^logout$/, 'user', async ({ db, user }) => {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.tokenHash).run();
  return json({ ok: true });
});

route('GET', /^me$/, 'user', async ({ user }) => json({ user: publicUser(user) }));

route('GET', /^users$/, 'admin', async ({ db, user }) => {
  const { results } = await db.prepare(
    `SELECT id, email, name, role, active FROM users
      WHERE active = 1 ${user.role === 'creator' ? '' : "AND role != 'creator'"}
      ORDER BY created_at`,
  ).all();
  return json({ users: results });
});

route('POST', /^users$/, 'admin', async ({ db, user, body }) => {
  const allowed = user.role === 'creator' ? ['creator', 'admin', 'user'] : ['admin', 'user'];
  if (!allowed.includes(body.role)) throw new HttpError(403, 'No puedes asignar ese rol');
  return json({ user: await createUser(db, body) }, 201);
});

// Editar usuario: el creador puede editar a cualquiera; el administrador solo a recepción.
route('PUT', /^users\/([^/]+)$/, 'admin', async ({ db, user, args, body }) => {
  const id = args[0];
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) throw new HttpError(404, 'Usuario no encontrado');
  if (user.role !== 'creator' && target.role !== 'user') {
    throw new HttpError(403, 'Solo el creador puede editar a administradores');
  }

  const allowed = user.role === 'creator' ? ['creator', 'admin', 'user'] : ['admin', 'user'];
  const role = body.role !== undefined ? body.role : target.role;
  if (!allowed.includes(role)) throw new HttpError(403, 'No puedes asignar ese rol');

  const active = body.active !== undefined ? (body.active ? 1 : 0) : target.active;
  if (id === user.id && active === 0) throw new HttpError(400, 'No puedes desactivar tu propio usuario');

  const name = body.name !== undefined ? requireString(body.name, 'Nombre', 120) : target.name;
  let hash = target.password_hash;
  let salt = target.salt;
  if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
    ({ hash, salt } = await hashPassword(body.password));
  }

  const stmts = [
    db.prepare('UPDATE users SET name = ?, role = ?, active = ?, password_hash = ?, salt = ? WHERE id = ?')
      .bind(name, role, active, hash, salt, id),
  ];
  // Si se cambia la contraseña o se desactiva, se cierran las sesiones abiertas de ese usuario.
  if (active === 0 || hash !== target.password_hash) {
    stmts.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  }
  await db.batch(stmts);
  return json({ user: { id, name, role, active } });
});

route('DELETE', /^users\/([^/]+)$/, 'creator', async ({ db, user, args }) => {
  const id = args[0];
  if (id === user.id) throw new HttpError(400, 'No puedes eliminar tu propio usuario');
  // Baja lógica: los pagos y ventas conservan la referencia al usuario que los registró.
  await db.batch([
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').bind(id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
  ]);
  return json({ ok: true });
});

// ---------------------------------------------------------------------------
// Clientes y membresías
// ---------------------------------------------------------------------------

// Última membresía de cada cliente (o de uno solo si se pasa clientId).
async function latestMemberships(db, clientId) {
  const where = clientId ? 'WHERE m.client_id = ?' : '';
  const stmt = db.prepare(
    `SELECT m.client_id, m.plan_id, m.start_date, m.end_date, p.name AS plan_name
       FROM memberships m JOIN plans p ON p.id = m.plan_id
       ${where}
      ORDER BY m.end_date DESC, m.created_at DESC`,
  );
  const { results } = clientId ? await stmt.bind(clientId).all() : await stmt.all();
  const map = new Map();
  for (const r of results) if (!map.has(r.client_id)) map.set(r.client_id, r);
  return map;
}

function withStatus(client, membership, today) {
  return {
    ...client,
    active: undefined,
    membership_status: membershipStatus(membership?.end_date, today),
    membership_end: membership?.end_date ?? null,
    membership_plan: membership?.plan_name ?? null,
  };
}

route('GET', /^clients$/, 'user', async ({ db, user, url }) => {
  const q = (url.searchParams.get('q') || '').trim();
  const like = `%${q}%`;
  const { results } = await db.prepare(
    `SELECT * FROM clients
      WHERE active = 1 AND (? = '' OR full_name LIKE ? OR cedula LIKE ? OR phone LIKE ? OR code LIKE ?)
      ORDER BY full_name LIMIT 300`,
  ).bind(q, like, like, like, like).all();
  const latest = await latestMemberships(db);
  const today = todayPanama();
  return json({ clients: results.map((c) => withStatus(maskCard(user, c), latest.get(c.id), today)) });
});

function clientFields(body) {
  if (!String(body.phone ?? '').trim()) throw new HttpError(400, 'El teléfono es obligatorio (para WhatsApp)');
  return {
    full_name: requireString(body.full_name, 'Nombre completo', 120),
    cedula: optString(body.cedula, 30),
    phone: normalizePhonePA(body.phone),
    email: optString(body.email, 120),
    birth_date: body.birth_date ? requireDay(body.birth_date, 'Fecha de nacimiento') : null,
    notes: optString(body.notes, 500),
  };
}

route('POST', /^clients$/, 'user', async ({ db, body }) => {
  const f = clientFields(body);
  const id = newId();
  const code = newClientCode();
  try {
    await db.prepare(
      'INSERT INTO clients (id, full_name, cedula, phone, email, birth_date, notes, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, f.full_name, f.cedula, f.phone, f.email, f.birth_date, f.notes, code).run();
  } catch (err) {
    if (isUniqueError(err)) throw new HttpError(409, 'Ya existe un cliente con esa cédula');
    throw err;
  }
  return json({ client: { id, code, ...f } }, 201);
});

// Ficha completa del cliente: datos, estado, membresías, pagos, entradas y saldo.
async function clientPayload(db, id) {
  const client = await db.prepare('SELECT * FROM clients WHERE id = ? AND active = 1').bind(id).first();
  if (!client) throw new HttpError(404, 'Cliente no encontrado');

  const today = todayPanama();
  const latest = (await latestMemberships(db, id)).get(id);
  const [memberships, payments, entries] = await db.batch([
    db.prepare(
      `SELECT m.id, m.start_date, m.end_date, m.amount, p.name AS plan_name
         FROM memberships m JOIN plans p ON p.id = m.plan_id
        WHERE m.client_id = ? ORDER BY m.end_date DESC LIMIT 20`,
    ).bind(id),
    db.prepare(
      'SELECT id, amount, method, day FROM payments WHERE client_id = ? ORDER BY created_at DESC LIMIT 20',
    ).bind(id),
    db.prepare(
      'SELECT id, day, check_in_at, check_out_at FROM entries WHERE client_id = ? ORDER BY check_in_at DESC LIMIT 20',
    ).bind(id),
  ]);

  return {
    client: { ...withStatus(client, latest, today), balance: await clientBalance(db, id) },
    memberships: memberships.results,
    payments: payments.results,
    entries: entries.results,
  };
}

// La tarjeta (QR y código) solo la ve la recepción cuando está abierta. Administrador y creador siempre la ven.
const cardVisibleTo = (user, client) => ROLE_RANK[user.role] >= ROLE_RANK.admin || client.card_open === 1;
function maskCard(user, client) {
  const visible = cardVisibleTo(user, client);
  return { ...client, code: visible ? client.code : null, card_visible: visible ? 1 : 0 };
}

route('GET', /^clients\/code\/([^/]+)$/, 'user', async ({ db, user, args }) => {
  const code = decodeURIComponent(args[0]).trim().toUpperCase();
  const row = await db.prepare('SELECT id FROM clients WHERE code = ? AND active = 1').bind(code).first();
  if (!row) throw new HttpError(404, 'Código de cliente no encontrado');
  const p = await clientPayload(db, row.id);
  return json({ ...p, client: maskCard(user, p.client) });
});

// Escáner de entrada: acepta el QR rotativo del portal (y la tarjeta fija, según la configuración).
route('GET', /^scan\/([^/]+)$/, 'user', async ({ db, user, args }) => {
  const code = await resolveScan(db, decodeURIComponent(args[0]));
  const row = await db.prepare('SELECT id FROM clients WHERE code = ? AND active = 1').bind(code).first();
  if (!row) throw new HttpError(404, 'Código de cliente no encontrado');
  const p = await clientPayload(db, row.id);
  return json({ ...p, client: maskCard(user, p.client) });
});

route('GET', /^clients\/([^/]+)$/, 'user', async ({ db, user, args }) => {
  const p = await clientPayload(db, args[0]);
  return json({ ...p, client: maskCard(user, p.client) });
});

route('PUT', /^clients\/([^/]+)$/, 'admin', async ({ db, args, body }) => {
  const id = args[0];
  const existing = await db.prepare('SELECT id FROM clients WHERE id = ? AND active = 1').bind(id).first();
  if (!existing) throw new HttpError(404, 'Cliente no encontrado');
  const f = clientFields(body);
  try {
    await db.prepare(
      `UPDATE clients SET full_name = ?, cedula = ?, phone = ?, email = ?, birth_date = ?, notes = ?
        WHERE id = ?`,
    ).bind(f.full_name, f.cedula, f.phone, f.email, f.birth_date, f.notes, id).run();
  } catch (err) {
    if (isUniqueError(err)) throw new HttpError(409, 'Ya existe un cliente con esa cédula');
    throw err;
  }
  return json({ client: { id, ...f } });
});

// Baja lógica: el cliente deja de aparecer, pero su historial se conserva.
route('DELETE', /^clients\/([^/]+)$/, 'admin', async ({ db, args }) => {
  await db.prepare('UPDATE clients SET active = 0 WHERE id = ?').bind(args[0]).run();
  return json({ ok: true });
});

route('GET', /^plans$/, 'user', async ({ db }) => {
  const { results } = await db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY price').all();
  return json({ plans: results });
});

route('PUT', /^plans\/([^/]+)$/, 'admin', async ({ db, args, body }) => {
  const id = args[0];
  const plan = await db.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first();
  if (!plan) throw new HttpError(404, 'Plan no encontrado');
  const name = body.name !== undefined ? requireString(body.name, 'Nombre del plan', 80) : plan.name;
  const price = body.price !== undefined ? requireNumber(body.price, 'Precio') : plan.price;
  const days = body.duration_days !== undefined ? requireInt(body.duration_days, 'Duración', 1) : plan.duration_days;
  await db.prepare('UPDATE plans SET name = ?, price = ?, duration_days = ? WHERE id = ?')
    .bind(name, price, days, id).run();
  return json({ plan: { id, name, price, duration_days: days } });
});

// Cobro de membresía. Si el cliente aún tiene días vigentes, la nueva membresía empieza al día siguiente
// del vencimiento; si no, empieza hoy.
route('POST', /^memberships$/, 'user', async ({ db, user, body }) => {
  const clientId = requireString(body.client_id, 'Cliente');
  const planId = requireString(body.plan_id, 'Plan');
  const method = requireMethod(body.method);
  const reference = method === 'yapi' ? requireYappyRef(body.reference) : null;

  const client = await db.prepare('SELECT id FROM clients WHERE id = ? AND active = 1').bind(clientId).first();
  if (!client) throw new HttpError(404, 'Cliente no encontrado');
  const plan = await db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').bind(planId).first();
  if (!plan) throw new HttpError(404, 'Plan no encontrado');
  if (reference) await assertYappyRefFree(db, reference);

  const today = todayPanama();
  const latest = (await latestMemberships(db, clientId)).get(clientId);
  // El uso diario es para quien no tiene membresía: un miembro activo no lo paga, y no se cobra dos veces el mismo día.
  if (plan.duration_days === 1 && latest && latest.end_date >= today) {
    throw new HttpError(409, latest.plan_id === plan.id
      ? 'Ya pagó el uso diario de hoy'
      : 'Tiene membresía activa: no puede pagar uso diario');
  }
  const start = latest && latest.end_date >= today ? addDays(latest.end_date, 1) : today;
  const end = addDays(start, plan.duration_days - 1);
  const membershipId = newId();
  const paymentId = newId();

  const hadMembership = await db.prepare('SELECT 1 AS x FROM memberships WHERE client_id = ? LIMIT 1').bind(clientId).first();
  const enrollStmts = [
    db.prepare(
      'INSERT INTO memberships (id, client_id, plan_id, start_date, end_date, amount) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(membershipId, clientId, plan.id, start, end, plan.price),
    db.prepare(
      'INSERT INTO payments (id, client_id, membership_id, amount, method, day, created_by, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(paymentId, clientId, membershipId, plan.price, method, today, user.id, reference),
  ];
  // Primera inscripción: la tarjeta queda abierta para la recepción (un solo uso).
  if (!hadMembership) enrollStmts.push(db.prepare('UPDATE clients SET card_open = 1 WHERE id = ?').bind(clientId));
  await db.batch(enrollStmts);

  return json({
    membership: { id: membershipId, plan_name: plan.name, start_date: start, end_date: end },
    payment: { id: paymentId, amount: plan.price, method, reference },
  }, 201);
});

// ---------------------------------------------------------------------------
// Entradas (check-in / check-out)
// ---------------------------------------------------------------------------

route('POST', /^entries\/check-in$/, 'user', async ({ db, body }) => {
  const clientId = requireString(body.client_id, 'Cliente');
  const client = await db.prepare('SELECT * FROM clients WHERE id = ? AND active = 1').bind(clientId).first();
  if (!client) throw new HttpError(404, 'Cliente no encontrado');

  const today = todayPanama();
  const latest = (await latestMemberships(db, clientId)).get(clientId);
  const status = membershipStatus(latest?.end_date, today);
  if (status === 'vencida') throw new HttpError(402, 'Membresía vencida: debe renovar', { status });
  if (status === 'sin_membresia') throw new HttpError(402, 'El cliente no tiene membresía', { status });

  const open = await db.prepare('SELECT id FROM entries WHERE client_id = ? AND check_out_at IS NULL')
    .bind(clientId).first();
  if (open) throw new HttpError(409, 'El cliente ya está dentro del gimnasio', { entry_id: open.id });

  const id = newId();
  const now = Date.now();
  await db.prepare('INSERT INTO entries (id, client_id, day, check_in_at) VALUES (?, ?, ?, ?)')
    .bind(id, clientId, today, now).run();
  return json({
    entry: { id, client_id: clientId, client_name: client.full_name, check_in_at: now },
    status,
  }, 201);
});

route('POST', /^entries\/([^/]+)\/check-out$/, 'user', async ({ db, args }) => {
  const entry = await db.prepare('SELECT * FROM entries WHERE id = ?').bind(args[0]).first();
  if (!entry) throw new HttpError(404, 'Entrada no encontrada');
  if (entry.check_out_at) throw new HttpError(409, 'Esta entrada ya tiene salida registrada');
  const out = Date.now();
  await db.prepare('UPDATE entries SET check_out_at = ? WHERE id = ?').bind(out, entry.id).run();
  return json({ entry: { ...entry, check_out_at: out, minutes: Math.round((out - entry.check_in_at) / 60000) } });
});

route('GET', /^entries\/open$/, 'user', async ({ db }) => {
  const { results } = await db.prepare(
    `SELECT e.id, e.client_id, e.check_in_at, c.full_name
       FROM entries e JOIN clients c ON c.id = e.client_id
      WHERE e.check_out_at IS NULL ORDER BY e.check_in_at`,
  ).all();
  return json({ entries: results });
});

route('GET', /^entries$/, 'user', async ({ db, url }) => {
  const day = requireDay(url.searchParams.get('day') || todayPanama(), 'Día');
  const { results } = await db.prepare(
    `SELECT e.id, e.client_id, e.check_in_at, e.check_out_at, c.full_name
       FROM entries e JOIN clients c ON c.id = e.client_id
      WHERE e.day = ? ORDER BY e.check_in_at DESC`,
  ).bind(day).all();
  return json({
    entries: results.map((e) => ({
      ...e,
      minutes: e.check_out_at ? Math.round((e.check_out_at - e.check_in_at) / 60000) : null,
    })),
  });
});

// ---------------------------------------------------------------------------
// Inventario y ventas
// ---------------------------------------------------------------------------

route('GET', /^products$/, 'user', async ({ db }) => {
  const { results } = await db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name').all();
  return json({ products: results });
});

function productFields(body) {
  return {
    name: requireString(body.name, 'Nombre del producto', 80),
    price: requireNumber(body.price, 'Precio'),
    stock: requireInt(body.stock ?? 0, 'Stock'),
    min_stock: requireInt(body.min_stock ?? 5, 'Stock mínimo'),
    icon: requireIcon(body.icon),
    category: optString(body.category, 40),
  };
}

route('POST', /^products$/, 'admin', async ({ db, body }) => {
  const f = productFields(body);
  const id = newId();
  await db.prepare(
    'INSERT INTO products (id, name, price, stock, min_stock, icon, category) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, f.name, f.price, f.stock, f.min_stock, f.icon, f.category).run();
  return json({ product: { id, ...f } }, 201);
});

route('PUT', /^products\/([^/]+)$/, 'admin', async ({ db, args, body }) => {
  const id = args[0];
  const existing = await db.prepare('SELECT id FROM products WHERE id = ? AND active = 1').bind(id).first();
  if (!existing) throw new HttpError(404, 'Producto no encontrado');
  const f = productFields(body);
  // El stock se modifica con reabastecimiento o ventas, no desde la edición del producto.
  await db.prepare('UPDATE products SET name = ?, price = ?, min_stock = ?, icon = ?, category = ? WHERE id = ?')
    .bind(f.name, f.price, f.min_stock, f.icon, f.category, id).run();
  return json({ product: { id, name: f.name, price: f.price, min_stock: f.min_stock, icon: f.icon, category: f.category } });
});

route('POST', /^products\/([^/]+)\/restock$/, 'admin', async ({ db, user, args, body }) => {
  const id = args[0];
  const qty = requireInt(body.qty, 'Cantidad', 1);
  const product = await db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').bind(id).first();
  if (!product) throw new HttpError(404, 'Producto no encontrado');
  await db.batch([
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').bind(qty, id),
    db.prepare(
      "INSERT INTO stock_movements (id, product_id, qty, reason, day, created_by) VALUES (?, ?, ?, 'compra', ?, ?)",
    ).bind(newId(), id, qty, todayPanama(), user.id),
  ]);
  return json({ stock: product.stock + qty });
});

route('POST', /^sales$/, 'user', async ({ db, user, body }) => {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw new HttpError(400, 'Agrega al menos un producto');
  // "cuenta" no es un medio de pago: la venta queda cargada al saldo del cliente.
  const onAccount = body.method === 'cuenta';
  const method = onAccount ? 'efectivo' : requireMethod(body.method);
  const reference = !onAccount && method === 'yapi' ? requireYappyRef(body.reference) : null;
  const clientId = optString(body.client_id, 80);
  if (onAccount && !clientId) throw new HttpError(400, 'Para cargar a cuenta debes seleccionar un cliente');
  if (clientId) {
    const c = await db.prepare('SELECT id FROM clients WHERE id = ? AND active = 1').bind(clientId).first();
    if (!c) throw new HttpError(404, 'Cliente no encontrado');
  }

  if (reference) await assertYappyRefFree(db, reference);

  // Agrupa líneas repetidas y valida stock antes de escribir.
  const wanted = new Map();
  for (const it of items) {
    const pid = requireString(it.product_id, 'Producto', 80);
    const qty = requireInt(it.qty, 'Cantidad', 1);
    wanted.set(pid, (wanted.get(pid) || 0) + qty);
  }

  const lines = [];
  let total = 0;
  for (const [pid, qty] of wanted) {
    const p = await db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').bind(pid).first();
    if (!p) throw new HttpError(404, 'Producto no encontrado');
    if (p.stock < qty) throw new HttpError(409, `Stock insuficiente de ${p.name} (disponible: ${p.stock})`);
    lines.push({ product: p, qty, subtotal: p.price * qty });
    total += p.price * qty;
  }

  const today = todayPanama();
  const saleId = newId();
  const stmts = [
    db.prepare(
      'INSERT INTO sales (id, client_id, total, method, day, created_by, on_account, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(saleId, clientId, total, method, today, user.id, onAccount ? 1 : 0, reference),
  ];
  if (onAccount) {
    stmts.push(
      db.prepare(
        "INSERT INTO client_ledger (id, client_id, kind, amount, sale_id, note, day, created_by) VALUES (?, ?, 'cargo', ?, ?, 'Venta de Market', ?, ?)",
      ).bind(newId(), clientId, total, saleId, today, user.id),
    );
  }
  for (const { product: p, qty } of lines) {
    stmts.push(
      db.prepare('INSERT INTO sale_items (id, sale_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?, ?)')
        .bind(newId(), saleId, p.id, qty, p.price),
      // La condición stock >= qty evita dejar stock negativo si hubo otra venta en paralelo.
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').bind(qty, p.id, qty),
      db.prepare(
        "INSERT INTO stock_movements (id, product_id, qty, reason, day, created_by) VALUES (?, ?, ?, 'venta', ?, ?)",
      ).bind(newId(), p.id, -qty, today, user.id),
    );
  }
  await db.batch(stmts);

  return json({
    sale: {
      id: saleId,
      total,
      method: onAccount ? 'cuenta' : method,
      on_account: onAccount,
      day: today,
      lines: lines.map((l) => ({ name: l.product.name, qty: l.qty, subtotal: l.subtotal })),
    },
  }, 201);
});

// ---------------------------------------------------------------------------
// Cuenta del cliente (cargos por ventas y abonos)
// ---------------------------------------------------------------------------

// Un código de Yappy no puede usarse dos veces, ni en cobros de membresía ni en ventas.
async function assertYappyRefFree(db, reference) {
  const dup = await db.prepare(
    `SELECT 1 FROM payments WHERE reference = ? UNION ALL SELECT 1 FROM sales WHERE reference = ? LIMIT 1`,
  ).bind(reference, reference).first();
  if (dup) throw new HttpError(409, `El código de Yappy ${reference} ya fue registrado`);
}

async function clientBalance(db, clientId) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'cargo' THEN amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN kind = 'abono' THEN amount ELSE 0 END), 0) AS balance
       FROM client_ledger WHERE client_id = ?`,
  ).bind(clientId).first();
  return Math.round((row?.balance ?? 0) * 100) / 100;
}

route('GET', /^clients\/([^/]+)\/ledger$/, 'user', async ({ db, args }) => {
  const id = args[0];
  const client = await db.prepare('SELECT id FROM clients WHERE id = ? AND active = 1').bind(id).first();
  if (!client) throw new HttpError(404, 'Cliente no encontrado');
  const { results } = await db.prepare(
    `SELECT id, kind, amount, method, note, day, created_at FROM client_ledger
      WHERE client_id = ? ORDER BY created_at DESC LIMIT 100`,
  ).bind(id).all();
  return json({ balance: await clientBalance(db, id), movements: results });
});

route('POST', /^clients\/([^/]+)\/abonos$/, 'user', async ({ db, user, args, body }) => {
  const id = args[0];
  const client = await db.prepare('SELECT id FROM clients WHERE id = ? AND active = 1').bind(id).first();
  if (!client) throw new HttpError(404, 'Cliente no encontrado');
  const amount = requireNumber(body.amount, 'Monto', 0.01);
  const method = requireMethod(body.method);
  const balance = await clientBalance(db, id);
  if (amount > balance + 0.001) throw new HttpError(400, `El abono supera el saldo pendiente ($${balance.toFixed(2)})`);
  await db.prepare(
    "INSERT INTO client_ledger (id, client_id, kind, amount, method, note, day, created_by) VALUES (?, ?, 'abono', ?, ?, 'Abono a cuenta', ?, ?)",
  ).bind(newId(), id, amount, method, todayPanama(), user.id).run();
  return json({ balance: await clientBalance(db, id) }, 201);
});

// ---------------------------------------------------------------------------
// Dashboard y reportes
// ---------------------------------------------------------------------------

route('GET', /^dashboard$/, 'user', async ({ db }) => {
  const today = todayPanama();
  const weekStart = addDays(today, -6);

  const [clients, payDays, saleDays, entryDays, abonoDays] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM clients WHERE active = 1'),
    db.prepare('SELECT day, SUM(amount) AS total FROM payments WHERE day BETWEEN ? AND ? GROUP BY day')
      .bind(weekStart, today),
    db.prepare('SELECT day, SUM(total) AS total FROM sales WHERE day BETWEEN ? AND ? AND on_account = 0 GROUP BY day')
      .bind(weekStart, today),
    db.prepare('SELECT day, COUNT(*) AS n FROM entries WHERE day BETWEEN ? AND ? GROUP BY day')
      .bind(weekStart, today),
    db.prepare("SELECT day, SUM(amount) AS total FROM client_ledger WHERE kind = 'abono' AND day BETWEEN ? AND ? GROUP BY day")
      .bind(weekStart, today),
  ]);

  const sumBy = (res) => new Map(res.results.map((r) => [r.day, r.total ?? r.n]));
  const pay = sumBy(payDays);
  const sale = sumBy(saleDays);
  const abonos = sumBy(abonoDays);
  const entries = new Map(entryDays.results.map((r) => [r.day, r.n]));

  const week = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    week.push({
      day,
      entries: entries.get(day) || 0,
      income: (pay.get(day) || 0) + (sale.get(day) || 0) + (abonos.get(day) || 0),
    });
  }

  const latest = await latestMemberships(db);
  const expiring = [];
  for (const [clientId, m] of latest) {
    const d = daysBetween(m.end_date, today);
    if (d >= 0 && d <= 7) expiring.push({ client_id: clientId, membership_end: m.end_date, plan_name: m.plan_name });
  }
  expiring.sort((a, b) => a.membership_end.localeCompare(b.membership_end));

  const names = expiring.length
    ? await db.prepare(
      `SELECT id, full_name, phone FROM clients WHERE id IN (${expiring.map(() => '?').join(',')})`,
    ).bind(...expiring.map((e) => e.client_id)).all()
    : { results: [] };
  const byId = new Map(names.results.map((c) => [c.id, c]));

  return json({
    clients_total: clients.results[0].n,
    income_today: week[6].income,
    entries_today: week[6].entries,
    expiring_count: expiring.length,
    expiring: expiring.slice(0, 20).map((e) => ({ ...e, ...byId.get(e.client_id) })),
    week,
  });
});

function checkDay(v, fallback) {
  return requireDay(v || fallback, 'Fecha');
}

route('GET', /^reports\/summary$/, 'admin', async ({ db, url }) => {
  const today = todayPanama();
  const from = checkDay(url.searchParams.get('from'), today);
  const to = checkDay(url.searchParams.get('to'), today);
  if (from > to) throw new HttpError(400, 'La fecha inicial es posterior a la final');

  const [payRows, saleRows, entryRows, newClients, productRows, membershipCount, abonoRows, onAccountRow, pendingRow] = await db.batch([
    db.prepare(
      `SELECT day, method, SUM(amount) AS total, COUNT(*) AS n FROM payments
        WHERE day BETWEEN ? AND ? GROUP BY day, method`,
    ).bind(from, to),
    // Las ventas a cuenta no son ingreso todavía: se cuentan cuando el cliente abona.
    db.prepare(
      `SELECT day, method, SUM(total) AS total, COUNT(*) AS n FROM sales
        WHERE day BETWEEN ? AND ? AND on_account = 0 GROUP BY day, method`,
    ).bind(from, to),
    db.prepare(
      `SELECT day, COUNT(*) AS n, COUNT(DISTINCT client_id) AS unique_clients FROM entries
        WHERE day BETWEEN ? AND ? GROUP BY day`,
    ).bind(from, to),
    db.prepare(
      "SELECT COUNT(*) AS n FROM clients WHERE date(created_at, '-5 hours') BETWEEN ? AND ?",
    ).bind(from, to),
    db.prepare(
      `SELECT p.name, SUM(si.qty) AS qty, SUM(si.qty * si.unit_price) AS total
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
        WHERE s.day BETWEEN ? AND ?
        GROUP BY p.id ORDER BY total DESC`,
    ).bind(from, to),
    db.prepare('SELECT COUNT(*) AS n FROM payments WHERE membership_id IS NOT NULL AND day BETWEEN ? AND ?')
      .bind(from, to),
    db.prepare(
      `SELECT day, method, SUM(amount) AS total, COUNT(*) AS n FROM client_ledger
        WHERE kind = 'abono' AND day BETWEEN ? AND ? GROUP BY day, method`,
    ).bind(from, to),
    db.prepare(
      'SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS n FROM sales WHERE on_account = 1 AND day BETWEEN ? AND ?',
    ).bind(from, to),
    db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'cargo' THEN amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN kind = 'abono' THEN amount ELSE 0 END), 0) AS total
         FROM client_ledger`,
    ),
  ]);

  const byDay = new Map();
  const dayRow = (day) => {
    if (!byDay.has(day)) byDay.set(day, { day, income: 0, entries: 0, unique_clients: 0 });
    return byDay.get(day);
  };
  const byMethod = { efectivo: 0, tarjeta: 0, yapi: 0 };
  let membershipIncome = 0;
  let salesIncome = 0;

  for (const r of payRows.results) {
    dayRow(r.day).income += r.total;
    byMethod[r.method] += r.total;
    membershipIncome += r.total;
  }
  for (const r of saleRows.results) {
    dayRow(r.day).income += r.total;
    byMethod[r.method] += r.total;
    salesIncome += r.total;
  }
  let abonosIncome = 0;
  for (const r of abonoRows.results) {
    dayRow(r.day).income += r.total;
    byMethod[r.method] += r.total;
    abonosIncome += r.total;
  }
  let entriesTotal = 0;
  for (const r of entryRows.results) {
    const d = dayRow(r.day);
    d.entries = r.n;
    d.unique_clients = r.unique_clients;
    entriesTotal += r.n;
  }

  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const uniqueRows = await db.prepare(
    'SELECT COUNT(DISTINCT client_id) AS n FROM entries WHERE day BETWEEN ? AND ?',
  ).bind(from, to).first();

  return json({
    from,
    to,
    income_total: membershipIncome + salesIncome + abonosIncome,
    income_memberships: membershipIncome,
    income_sales: salesIncome,
    income_abonos: abonosIncome,
    charged_to_accounts: Math.round(Number(onAccountRow.results[0].total || 0) * 100) / 100,
    accounts_pending: Math.round(Number(pendingRow.results[0].total || 0) * 100) / 100,
    by_method: byMethod,
    entries_total: entriesTotal,
    unique_clients: uniqueRows.n,
    new_clients: newClients.results[0].n,
    memberships_sold: membershipCount.results[0].n,
    days,
    products: productRows.results,
  });
});

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Búsqueda de pagos por código de Yappy (admin) y detalle de reportes
// ---------------------------------------------------------------------------

route('GET', /^payments\/search$/, 'admin', async ({ db, url }) => {
  const ref = (url.searchParams.get('ref') || '').trim().toUpperCase().replace(/\s/g, '');
  if (ref.length < 3) throw new HttpError(400, 'Escribe al menos 3 caracteres del código de Yappy');
  if (!/^[A-Z0-9-]{3,40}$/.test(ref)) throw new HttpError(400, 'El código solo puede tener letras, números y guiones');
  const like = `%${ref}%`;
  const [pay, sales] = await db.batch([
    db.prepare(
      `SELECT p.id, p.reference, p.amount, p.method, p.day, p.created_at, 'Membresía' AS kind,
              c.full_name AS client_name, c.phone AS client_phone
         FROM payments p LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.reference LIKE ? ORDER BY p.created_at DESC LIMIT 50`,
    ).bind(like),
    db.prepare(
      `SELECT s.id, s.reference, s.total AS amount, s.method, s.day, s.created_at, 'Venta Market' AS kind,
              c.full_name AS client_name, c.phone AS client_phone
         FROM sales s LEFT JOIN clients c ON c.id = s.client_id
        WHERE s.reference LIKE ? ORDER BY s.created_at DESC LIMIT 50`,
    ).bind(like),
  ]);
  const results = [...pay.results, ...sales.results]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return json({ results });
});

// Ventas de un día (Market). Por defecto, hoy.
route('GET', /^sales$/, 'user', async ({ db, url }) => {
  const day = requireDay(url.searchParams.get('day') || todayPanama(), 'Día');
  const { results } = await db.prepare(
    `SELECT s.id, s.total, s.method, s.on_account, s.reference, s.day, s.created_at,
            c.full_name AS client_name,
            (SELECT GROUP_CONCAT(p.name || ' x' || si.qty, ', ')
               FROM sale_items si JOIN products p ON p.id = si.product_id
              WHERE si.sale_id = s.id) AS items
       FROM sales s LEFT JOIN clients c ON c.id = s.client_id
      WHERE s.day = ? ORDER BY s.created_at DESC`,
  ).bind(day).all();
  return json({ sales: results });
});

route('GET', /^sales\/([^/]+)$/, 'user', async ({ db, args }) => {
  const sale = await db.prepare(
    `SELECT s.*, c.full_name AS client_name, c.phone AS client_phone
       FROM sales s LEFT JOIN clients c ON c.id = s.client_id WHERE s.id = ?`,
  ).bind(args[0]).first();
  if (!sale) throw new HttpError(404, 'Venta no encontrada');
  const { results } = await db.prepare(
    `SELECT p.name, p.icon, si.qty, si.unit_price, si.qty * si.unit_price AS subtotal
       FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?`,
  ).bind(sale.id).all();
  return json({ sale, lines: results });
});

const PANAMA_TIME = { hour: '2-digit', minute: '2-digit', timeZone: 'America/Panama' };
const panamaTime = (ms) => (ms ? new Date(ms).toLocaleTimeString('es-PA', PANAMA_TIME) : '');

// Detalle de cada tarjeta del reporte. Devuelve columnas y filas listas para la tabla y para Excel.
route('GET', /^reports\/detail$/, 'admin', async ({ db, url }) => {
  const today = todayPanama();
  const kind = url.searchParams.get('kind') || '';
  const from = checkDay(url.searchParams.get('from'), today);
  const to = checkDay(url.searchParams.get('to'), today);
  if (from > to) throw new HttpError(400, 'La fecha inicial es posterior a la final');
  const range = [from, to];
  const itemsOf = `(SELECT GROUP_CONCAT(p.name || ' x' || si.qty, ', ') FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = s.id)`;

  if (kind === 'income') {
    const { results } = await db.prepare(
      `SELECT p.day AS day, 'Membresía' AS tipo, c.full_name AS cliente, pl.name AS detalle,
              p.method AS metodo, p.amount AS monto, p.reference AS ref
         FROM payments p
         LEFT JOIN clients c ON c.id = p.client_id
         LEFT JOIN memberships m ON m.id = p.membership_id
         LEFT JOIN plans pl ON pl.id = m.plan_id
        WHERE p.day BETWEEN ? AND ?
       UNION ALL
       SELECT s.day, 'Venta Market', c.full_name, ${itemsOf}, s.method, s.total, s.reference
         FROM sales s LEFT JOIN clients c ON c.id = s.client_id
        WHERE s.on_account = 0 AND s.day BETWEEN ? AND ?
       UNION ALL
       SELECT l.day, 'Abono de cuenta', c.full_name, l.note, l.method, l.amount, NULL
         FROM client_ledger l LEFT JOIN clients c ON c.id = l.client_id
        WHERE l.kind = 'abono' AND l.day BETWEEN ? AND ?
       ORDER BY day, tipo`,
    ).bind(...range, ...range, ...range).all();
    return json({
      title: 'Ingresos totales', columns: ['Fecha', 'Tipo', 'Cliente', 'Detalle', 'Método', 'Monto', 'Código Yappy'],
      rows: results.map((r) => [r.day, r.tipo, r.cliente || '', r.detalle || '', r.metodo || '', r.monto, r.ref || '']),
    });
  }

  if (kind === 'memberships') {
    const { results } = await db.prepare(
      `SELECT p.day, c.full_name, c.phone, pl.name AS plan, m.start_date, m.end_date, p.method, p.amount, p.reference
         FROM payments p
         LEFT JOIN clients c ON c.id = p.client_id
         LEFT JOIN memberships m ON m.id = p.membership_id
         LEFT JOIN plans pl ON pl.id = m.plan_id
        WHERE p.membership_id IS NOT NULL AND p.day BETWEEN ? AND ? ORDER BY p.day, c.full_name`,
    ).bind(...range).all();
    return json({
      title: 'Membresías vendidas',
      columns: ['Fecha', 'Cliente', 'Plan', 'Vence', 'Método', 'Monto', 'Código Yappy'],
      rows: results.map((r) => [r.day, r.full_name || '', r.plan || '', r.end_date || '', r.method, r.amount, r.reference || '']),
    });
  }

  if (kind === 'sales') {
    const { results } = await db.prepare(
      `SELECT s.day, c.full_name, ${itemsOf} AS items, s.method, s.total, s.reference
         FROM sales s LEFT JOIN clients c ON c.id = s.client_id
        WHERE s.on_account = 0 AND s.day BETWEEN ? AND ? ORDER BY s.day, s.created_at`,
    ).bind(...range).all();
    return json({
      title: 'Ventas de Market',
      columns: ['Fecha', 'Cliente', 'Productos', 'Método', 'Total', 'Código Yappy'],
      rows: results.map((r) => [r.day, r.full_name || 'Mostrador', r.items || '', r.method, r.total, r.reference || '']),
    });
  }

  if (kind === 'abonos') {
    const { results } = await db.prepare(
      `SELECT l.day, c.full_name, l.method, l.amount, l.note
         FROM client_ledger l LEFT JOIN clients c ON c.id = l.client_id
        WHERE l.kind = 'abono' AND l.day BETWEEN ? AND ? ORDER BY l.day, l.created_at`,
    ).bind(...range).all();
    return json({
      title: 'Abonos cobrados',
      columns: ['Fecha', 'Cliente', 'Método', 'Monto', 'Nota'],
      rows: results.map((r) => [r.day, r.full_name || '', r.method || '', r.amount, r.note || '']),
    });
  }

  if (kind === 'on_account') {
    const { results } = await db.prepare(
      `SELECT s.day, c.full_name, ${itemsOf} AS items, s.total
         FROM sales s LEFT JOIN clients c ON c.id = s.client_id
        WHERE s.on_account = 1 AND s.day BETWEEN ? AND ? ORDER BY s.day, s.created_at`,
    ).bind(...range).all();
    return json({
      title: 'Cargado a cuentas',
      columns: ['Fecha', 'Cliente', 'Productos', 'Total'],
      rows: results.map((r) => [r.day, r.full_name || '', r.items || '', r.total]),
    });
  }

  if (kind === 'pending') {
    const { results } = await db.prepare(
      `SELECT c.full_name, c.phone, c.code,
              SUM(CASE WHEN l.kind = 'cargo' THEN l.amount ELSE -l.amount END) AS saldo
         FROM clients c JOIN client_ledger l ON l.client_id = c.id
        WHERE c.active = 1 GROUP BY c.id HAVING saldo > 0.005 ORDER BY saldo DESC`,
    ).all();
    return json({
      title: 'Saldo pendiente de clientes (actual)',
      columns: ['Cliente', 'Teléfono', 'Código', 'Saldo'],
      rows: results.map((r) => [r.full_name, r.phone || '', r.code || '', Math.round(r.saldo * 100) / 100]),
    });
  }

  if (kind === 'entries') {
    const { results } = await db.prepare(
      `SELECT e.day, c.full_name, c.code, e.check_in_at, e.check_out_at
         FROM entries e JOIN clients c ON c.id = e.client_id
        WHERE e.day BETWEEN ? AND ? ORDER BY e.check_in_at`,
    ).bind(...range).all();
    return json({
      title: 'Entradas',
      columns: ['Fecha', 'Cliente', 'Código', 'Entrada', 'Salida', 'Minutos'],
      rows: results.map((r) => [
        r.day, r.full_name, r.code || '', panamaTime(r.check_in_at), panamaTime(r.check_out_at),
        r.check_out_at ? Math.round((r.check_out_at - r.check_in_at) / 60000) : '',
      ]),
    });
  }

  if (kind === 'new_clients') {
    const { results } = await db.prepare(
      `SELECT date(created_at, '-5 hours') AS alta, full_name, cedula, phone, code FROM clients
        WHERE active = 1 AND date(created_at, '-5 hours') BETWEEN ? AND ? ORDER BY created_at`,
    ).bind(...range).all();
    return json({
      title: 'Clientes nuevos',
      columns: ['Fecha de alta', 'Cliente', 'Cédula', 'Teléfono', 'Código'],
      rows: results.map((r) => [r.alta, r.full_name, r.cedula || '', r.phone || '', r.code || '']),
    });
  }

  if (kind === 'clients') {
    const { results } = await db.prepare('SELECT * FROM clients WHERE active = 1 ORDER BY full_name').all();
    const latest = await latestMemberships(db);
    const rows = results.map((c) => withStatus(c, latest.get(c.id), today));
    return json({
      title: 'Clientes activos',
      columns: ['Cliente', 'Cédula', 'Teléfono', 'Código', 'Plan', 'Vence', 'Estado'],
      rows: rows.map((c) => [c.full_name, c.cedula || '', c.phone || '', c.code || '', c.membership_plan || '', c.membership_end || '', c.membership_status]),
    });
  }

  if (kind === 'expiring') {
    const latest = await latestMemberships(db);
    const rows = [];
    for (const [clientId, m] of latest) {
      const d = daysBetween(m.end_date, today);
      if (d >= 0 && d <= 7) rows.push({ clientId, m });
    }
    rows.sort((a, b) => a.m.end_date.localeCompare(b.m.end_date));
    const ids = rows.map((r) => r.clientId);
    const names = ids.length
      ? await db.prepare(`SELECT id, full_name, phone, code FROM clients WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()
      : { results: [] };
    const byId = new Map(names.results.map((c) => [c.id, c]));
    return json({
      title: 'Membresías por vencer (7 días)',
      columns: ['Cliente', 'Teléfono', 'Código', 'Plan', 'Vence'],
      rows: rows.map(({ clientId, m }) => {
        const c = byId.get(clientId) || {};
        return [c.full_name || '', c.phone || '', c.code || '', m.plan_name, m.end_date];
      }),
    });
  }

  throw new HttpError(400, 'Tipo de reporte desconocido');
});

const SETTING_KEYS = ['gym_name', 'contact_email', 'phone', 'whatsapp', 'currency', 'schedule', 'rotating_qr'];

route('GET', /^settings$/, 'user', async ({ db }) => {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return json({ settings });
});

// Reinicio de datos (solo creador), pensado para cuando termina la prueba Beta.
// Borra clientes, membresías, pagos, entradas, ventas, cuentas e inventario.
// Conserva usuarios, sesiones, planes y la configuración del gimnasio.
// Uso de la tarjeta (enviar por WhatsApp o descargar). La recepción solo la usa mientras esté abierta;
// al usarla se cierra y el administrador debe autorizar otro uso. Administrador y creador siempre pueden.
route('POST', /^clients\/([^/]+)\/card-use$/, 'user', async ({ db, user, args }) => {
  const client = await db.prepare('SELECT id, card_open, card_shares FROM clients WHERE id = ? AND active = 1').bind(args[0]).first();
  if (!client) throw new HttpError(404, 'Cliente no encontrado');
  const isAdmin = ROLE_RANK[user.role] >= ROLE_RANK.admin;
  if (!isAdmin && client.card_open !== 1) {
    throw new HttpError(403, 'Tarjeta protegida. Solicita autorización a la administración.');
  }
  await db.prepare(`UPDATE clients SET card_shares = card_shares + 1${isAdmin ? '' : ', card_open = 0'} WHERE id = ?`).bind(client.id).run();
  return json({ card_shares: client.card_shares + 1, card_open: isAdmin ? client.card_open : 0 });
});

// Autorización del administrador: abre la tarjeta para un uso de la recepción.
route('POST', /^clients\/([^/]+)\/card-open$/, 'admin', async ({ db, args }) => {
  const client = await db.prepare('SELECT id FROM clients WHERE id = ? AND active = 1').bind(args[0]).first();
  if (!client) throw new HttpError(404, 'Cliente no encontrado');
  await db.prepare('UPDATE clients SET card_open = 1 WHERE id = ?').bind(client.id).run();
  return json({ ok: true, card_open: 1 });
});

// ---------------------------------------------------------------------------
// Portal del socio: cada cliente entra con su cédula y su contraseña.
// Usa tablas propias (client_accounts / client_sessions): una sesión del personal no sirve aquí
// y una sesión del portal no sirve en las rutas del personal.
// ---------------------------------------------------------------------------

const PORTAL_SESSION_DAYS = 30;
const normalizeCedula = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');

// QR rotativo: cada minuto la tarjeta del socio cambia. El código lleva una firma HMAC con una clave del servidor,
// así que una captura de pantalla vale como mucho dos minutos (el minuto actual y el anterior).
const ROTATION_MS = 60000;
const enc = new TextEncoder();

async function qrSecret(db) {
  await db.prepare("INSERT OR IGNORE INTO app_keys (name, value) VALUES ('qr_secret', ?)").bind(randomToken()).run();
  return (await db.prepare("SELECT value FROM app_keys WHERE name = 'qr_secret'").first()).value;
}

async function qrSignature(db, code, slot) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(await qrSecret(db)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${code}.${slot}`)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// Tarjeta rotativa del socio: el texto del QR y los milisegundos que faltan para el siguiente cambio.
async function rotatingCard(db, code) {
  const now = Date.now();
  const slot = Math.floor(now / ROTATION_MS);
  return {
    token: `MF1.${code}.${slot}.${await qrSignature(db, code, slot)}`,
    next_ms: (slot + 1) * ROTATION_MS - now,
  };
}

// Traduce lo que lee el escáner a un código de cliente.
// Con rotating_qr = '1' la tarjeta fija deja de servir: solo vale el QR rotativo del portal.
async function resolveScan(db, raw) {
  const text = String(raw ?? '').trim();
  const m = text.match(/^MF1\.(MF-[A-Z0-9]{6})\.(\d+)\.([0-9a-f]{16})$/i);
  if (m) {
    const code = m[1].toUpperCase();
    const slot = Number(m[2]);
    const current = Math.floor(Date.now() / ROTATION_MS);
    if (slot !== current && slot !== current - 1) {
      throw new HttpError(410, 'QR caducado. Pide al socio que actualice su tarjeta del portal.');
    }
    if (m[3].toLowerCase() !== await qrSignature(db, code, slot)) throw new HttpError(400, 'QR no válido');
    return code;
  }
  const setting = await db.prepare("SELECT value FROM settings WHERE key = 'rotating_qr'").first();
  if (setting?.value === '1') {
    throw new HttpError(400, 'Esta tarjeta ya no es válida. El socio debe usar el QR de su portal.');
  }
  return text.toUpperCase();
}

// Contraseña temporal legible (sin letras confundibles como O/0 o I/1).
function tempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => alphabet[b % alphabet.length]).join('');
}

async function authenticateClient(db, request) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Sesión requerida');
  const row = await db.prepare(
    `SELECT s.client_id, s.expires_at, a.must_change, a.active AS account_active, c.active AS client_active
       FROM client_sessions s
       JOIN client_accounts a ON a.client_id = s.client_id
       JOIN clients c ON c.id = s.client_id
      WHERE s.token_hash = ?`,
  ).bind(await sha256Hex(token)).first();
  if (!row || !row.account_active || !row.client_active || row.expires_at < Date.now()) {
    throw new HttpError(401, 'Sesión expirada, vuelve a ingresar');
  }
  return { clientId: row.client_id, tokenHash: await sha256Hex(token), mustChange: row.must_change === 1 };
}

// Lo que ve el socio. La tarjeta (código QR) solo aparece con membresía activa o por vencer.
async function portalPayload(db, clientId, mustChange) {
  if (mustChange) return { must_change: true };
  const client = await db.prepare('SELECT full_name, code FROM clients WHERE id = ?').bind(clientId).first();
  const m = await db.prepare(
    `SELECT m.end_date, p.name AS plan_name FROM memberships m JOIN plans p ON p.id = m.plan_id
      WHERE m.client_id = ? ORDER BY m.end_date DESC LIMIT 1`,
  ).bind(clientId).first();
  const today = todayPanama();
  const status = membershipStatus(m?.end_date, today);
  const showCard = (status === 'activa' || status === 'por_vencer') && !!client.code;
  const { results } = await db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('gym_name', 'phone', 'whatsapp', 'schedule')",
  ).all();
  const gym = Object.fromEntries(results.map((r) => [r.key, r.value ?? '']));
  return {
    must_change: false,
    client: { name: client.full_name },
    membership: {
      status,
      plan: m?.plan_name ?? null,
      end_date: m?.end_date ?? null,
      days_left: m?.end_date ? daysBetween(m.end_date, today) : null,
    },
    card: showCard ? await rotatingCard(db, client.code) : null,
    gym: { name: gym.gym_name || '', phone: gym.phone || '', whatsapp: gym.whatsapp || '', schedule: gym.schedule || '' },
  };
}

route('POST', /^portal\/login$/, 'public', async ({ db, body }) => {
  const login = normalizeCedula(body.cedula);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!login || !password) throw new HttpError(400, 'Escribe tu cédula y tu contraseña');
  const row = await db.prepare(
    `SELECT a.client_id, a.password_hash, a.salt, a.must_change
       FROM clients c JOIN client_accounts a ON a.client_id = c.id
      WHERE UPPER(REPLACE(TRIM(c.cedula), ' ', '')) = ? AND a.active = 1 AND c.active = 1`,
  ).bind(login).first();
  const ok = row && await verifyPassword(password, row.password_hash, row.salt);
  if (!ok) throw new HttpError(401, 'Cédula o contraseña incorrectas');
  const token = randomToken();
  await db.batch([
    db.prepare('INSERT INTO client_sessions (token_hash, client_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(token), row.client_id, Date.now() + PORTAL_SESSION_DAYS * 86400000),
    db.prepare("UPDATE client_accounts SET last_login = datetime('now') WHERE client_id = ?").bind(row.client_id),
  ]);
  return json({ token, must_change: row.must_change === 1 });
});

route('POST', /^portal\/logout$/, 'public', async ({ db, request }) => {
  const s = await authenticateClient(db, request);
  await db.prepare('DELETE FROM client_sessions WHERE token_hash = ?').bind(s.tokenHash).run();
  return json({ ok: true });
});

route('GET', /^portal\/me$/, 'public', async ({ db, request }) => {
  const s = await authenticateClient(db, request);
  return json(await portalPayload(db, s.clientId, s.mustChange));
});

// Cambio de contraseña (también es el primer paso después de una contraseña temporal).
route('POST', /^portal\/password$/, 'public', async ({ db, request, body }) => {
  const s = await authenticateClient(db, request);
  const current = typeof body.current === 'string' ? body.current : '';
  const next = typeof body.password === 'string' ? body.password : '';
  if (next.length < 8) throw new HttpError(400, 'La nueva contraseña debe tener al menos 8 caracteres');
  if (next === current) throw new HttpError(400, 'La nueva contraseña debe ser distinta a la actual');
  const acc = await db.prepare('SELECT password_hash, salt FROM client_accounts WHERE client_id = ?').bind(s.clientId).first();
  if (!await verifyPassword(current, acc.password_hash, acc.salt)) {
    throw new HttpError(401, 'La contraseña actual no es correcta');
  }
  const { hash, salt } = await hashPassword(next);
  await db.batch([
    db.prepare('UPDATE client_accounts SET password_hash = ?, salt = ?, must_change = 0 WHERE client_id = ?')
      .bind(hash, salt, s.clientId),
    // Se cierran las demás sesiones del socio; la actual sigue abierta.
    db.prepare('DELETE FROM client_sessions WHERE client_id = ? AND token_hash != ?').bind(s.clientId, s.tokenHash),
  ]);
  return json(await portalPayload(db, s.clientId, false));
});

// Administrador: crea o restablece el acceso del socio con una contraseña temporal (se muestra una sola vez).
route('POST', /^clients\/([^/]+)\/portal-access$/, 'admin', async ({ db, args }) => {
  const client = await db.prepare('SELECT id, cedula FROM clients WHERE id = ? AND active = 1').bind(args[0]).first();
  if (!client) throw new HttpError(404, 'Cliente no encontrado');
  if (!normalizeCedula(client.cedula)) throw new HttpError(400, 'El cliente necesita cédula para tener acceso al portal');
  const password = tempPassword();
  const { hash, salt } = await hashPassword(password);
  await db.batch([
    db.prepare(
      `INSERT INTO client_accounts (client_id, password_hash, salt, must_change, active)
       VALUES (?, ?, ?, 1, 1)
       ON CONFLICT(client_id) DO UPDATE SET password_hash = excluded.password_hash,
         salt = excluded.salt, must_change = 1, active = 1`,
    ).bind(client.id, hash, salt),
    db.prepare('DELETE FROM client_sessions WHERE client_id = ?').bind(client.id),
  ]);
  return json({ login: client.cedula, password }, 201);
});

route('POST', /^admin\/reset$/, 'creator', async ({ db, body }) => {
  if (body.confirm !== 'REINICIAR') throw new HttpError(400, 'Escribe REINICIAR para confirmar el reinicio');
  // Orden pensado para las llaves foráneas: primero lo que depende de otras tablas.
  const tables = ['client_sessions', 'client_accounts', 'client_ledger', 'sale_items', 'stock_movements', 'payments', 'sales', 'memberships', 'entries', 'clients', 'products'];
  const deleted = {};
  for (const t of tables) {
    deleted[t] = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n;
  }
  await db.batch(tables.map((t) => db.prepare(`DELETE FROM ${t}`)));
  return json({ ok: true, deleted });
});

route('PUT', /^settings$/, 'admin', async ({ db, body }) => {
  const stmts = [];
  for (const key of SETTING_KEYS) {
    if (body[key] === undefined) continue;
    const value = optString(body[key], 120) ?? '';
    stmts.push(
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).bind(key, value),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return json({ ok: true });
});
