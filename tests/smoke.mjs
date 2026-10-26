// Prueba de humo de la API. Ejecutar con el servidor local encendido: npm test
// Para empezar de cero, borra la carpeta .wrangler/state (se recrea sola).
const BASE = process.env.BASE_URL || 'http://localhost:8788';
const suffix = Date.now().toString(36);

let failures = 0;
let passes = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name} ${detail ? '→ ' + detail : ''}`);
  }
}

// Acepta { token, body } o directamente el cuerpo cuando no hay sesión.
async function call(method, path, opts = {}) {
  const isEnvelope = 'token' in opts || 'body' in opts;
  const token = isEnvelope ? opts.token : undefined;
  const body = isEnvelope ? opts.body : (Object.keys(opts).length ? opts : undefined);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}/api/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

console.log(`Probando ${BASE}`);

// 1. Configuración inicial
console.log('\n1. Configuración inicial');
let status = await call('GET', 'status');
check('estado responde', status.status === 200, JSON.stringify(status));
if (!status.data.configured) {
  const r = await call('POST', 'setup', {
    name: 'Creador Prueba', email: `creador-${suffix}@test.local`, password: 'clave-segura-1',
  });
  check('setup crea el creador', r.status === 201, JSON.stringify(r.data));
}
const creatorEmail = `creador-${suffix}@test.local`;
// Si la base ya tenía un creador (de otra prueba), no podemos saber su clave; usamos el que creamos arriba
// o pedimos que se borre el estado local.
let login = await call('POST', 'login', { email: creatorEmail, password: 'clave-segura-1' });
if (login.status !== 200) {
  console.log('\nNo se pudo ingresar con el creador de esta prueba.');
  console.log('Borra .wrangler/state y vuelve a ejecutar la prueba.');
  process.exit(1);
}
const creator = login.data.token;
check('login del creador', !!creator);

const second = await call('POST', 'setup', { name: 'Otro', email: `otro-${suffix}@test.local`, password: 'clave-segura-1' });
check('setup no se puede repetir', second.status === 403, `status ${second.status}`);

const badLogin = await call('POST', 'login', { email: creatorEmail, password: 'mala-clave' });
check('contraseña incorrecta rechazada', badLogin.status === 401);

const noSession = await call('GET', 'clients');
check('ruta protegida sin sesión devuelve 401', noSession.status === 401);

// 2. Roles
console.log('\n2. Roles y permisos');
const adminEmail = `admin-${suffix}@test.local`;
const userEmail = `recepcion-${suffix}@test.local`;
const a = await call('POST', 'users', { token: creator, body: { name: 'Admin', email: adminEmail, password: 'clave-admin-1', role: 'admin' } });
check('creador crea administrador', a.status === 201, JSON.stringify(a.data));
const u = await call('POST', 'users', { token: creator, body: { name: 'Recepción', email: userEmail, password: 'clave-user-1', role: 'user' } });
check('creador crea recepción', u.status === 201, JSON.stringify(u.data));
const adminToken = (await call('POST', 'login', { email: adminEmail, password: 'clave-admin-1' })).data.token;
const userToken = (await call('POST', 'login', { email: userEmail, password: 'clave-user-1' })).data.token;

const userSettings = await call('PUT', 'settings', { token: userToken, body: { gym_name: 'Hack' } });
check('recepción no puede cambiar configuración', userSettings.status === 403, `status ${userSettings.status}`);
const userReport = await call('GET', `reports/summary?from=${today}&to=${today}`, { token: userToken });
check('recepción no ve reportes', userReport.status === 403);
const adminCreatesCreator = await call('POST', 'users', { token: adminToken, body: { name: 'X', email: `x-${suffix}@test.local`, password: 'clave-x-1234', role: 'creator' } });
check('admin no puede crear creadores', adminCreatesCreator.status === 403, `status ${adminCreatesCreator.status}`);

// 3. Clientes
console.log('\n3. Clientes');
const cedula = `8-${suffix}`;
const c1 = await call('POST', 'clients', { token: userToken, body: { full_name: 'Juan Prueba', cedula, phone: '6000-0001' } });
check('recepción registra cliente', c1.status === 201, JSON.stringify(c1.data));
const clientId = c1.data.client.id;
const dup = await call('POST', 'clients', { token: userToken, body: { full_name: 'Otro', cedula } });
check('cédula duplicada rechazada', dup.status === 409, `status ${dup.status}`);
const search = await call('GET', `clients?q=${encodeURIComponent(cedula)}`, { token: userToken });
check('búsqueda por cédula encuentra al cliente', search.data.clients.some((c) => c.id === clientId));
check('cliente nuevo aparece sin membresía', search.data.clients.find((c) => c.id === clientId)?.membership_status === 'sin_membresia');

// 4. Check-in y membresías
console.log('\n4. Membresías y check-in');
const noMember = await call('POST', 'entries/check-in', { token: userToken, body: { client_id: clientId } });
check('check-in sin membresía bloqueado', noMember.status === 402, `status ${noMember.status}`);

const plans = (await call('GET', 'plans', { token: userToken })).data.plans;
const monthly = plans.find((p) => p.id === 'monthly');
check('planes sembrados', plans.length >= 4 && !!monthly);

const m1 = await call('POST', 'memberships', { token: userToken, body: { client_id: clientId, plan_id: 'monthly', method: 'efectivo' } });
check('cobra membresía mensual', m1.status === 201, JSON.stringify(m1.data));
check('membresía empieza hoy', m1.data.membership?.start_date === today);
check('membresía dura 30 días', m1.data.membership?.end_date === addDays(today, 29));

const yappyNoRef = await call('POST', 'memberships', { token: userToken, body: { client_id: clientId, plan_id: 'monthly', method: 'yapi' } });
check('Yappy sin código rechazado', yappyNoRef.status === 400, `status ${yappyNoRef.status}`);
const m2 = await call('POST', 'memberships', { token: userToken, body: { client_id: clientId, plan_id: 'monthly', method: 'yapi', reference: `yp-${suffix}-a` } });
check('renovación empieza al día siguiente del vencimiento', m2.data.membership?.start_date === addDays(today, 30), JSON.stringify(m2.data));
const yappyDup = await call('POST', 'memberships', { token: userToken, body: { client_id: clientId, plan_id: 'monthly', method: 'yapi', reference: `YP-${suffix}-A` } });
check('código de Yappy repetido rechazado', yappyDup.status === 409, `status ${yappyDup.status}`);

const badMethod = await call('POST', 'memberships', { token: userToken, body: { client_id: clientId, plan_id: 'monthly', method: 'bitcoin' } });
check('método de pago inválido rechazado', badMethod.status === 400);

const ci = await call('POST', 'entries/check-in', { token: userToken, body: { client_id: clientId } });
check('check-in con membresía activa', ci.status === 201, JSON.stringify(ci.data));
const ciDup = await call('POST', 'entries/check-in', { token: userToken, body: { client_id: clientId } });
check('segundo check-in mientras está dentro, rechazado', ciDup.status === 409);

const open = await call('GET', 'entries/open', { token: userToken });
check('aparece en "dentro del gimnasio"', open.data.entries.some((e) => e.client_id === clientId));

const entryId = ci.data.entry.id;
const out = await call('POST', `entries/${entryId}/check-out`, { token: userToken });
check('check-out registra salida', out.status === 200 && typeof out.data.entry.minutes === 'number', JSON.stringify(out.data));
const outAgain = await call('POST', `entries/${entryId}/check-out`, { token: userToken });
check('segunda salida rechazada', outAgain.status === 409);

// Cliente con membresía vencida
const c2 = await call('POST', 'clients', { token: userToken, body: { full_name: 'Vencido Prueba', cedula: `9-${suffix}` } });
await call('POST', 'memberships', { token: userToken, body: { client_id: c2.data.client.id, plan_id: 'daily', method: 'efectivo' } });
const daily = await call('POST', 'entries/check-in', { token: userToken, body: { client_id: c2.data.client.id } });
check('pago diario permite entrar el mismo día', daily.status === 201, JSON.stringify(daily.data));

// 5. Inventario y ventas
console.log('\n5. Inventario y ventas');
const prod = await call('POST', 'products', { token: adminToken, body: { name: `Agua ${suffix}`, price: 1, stock: 10, min_stock: 4 } });
check('admin crea producto', prod.status === 201, JSON.stringify(prod.data));
const pid = prod.data.product.id;

const userProd = await call('POST', 'products', { token: userToken, body: { name: 'Nope', price: 1 } });
check('recepción no crea productos', userProd.status === 403);

const sale = await call('POST', 'sales', { token: userToken, body: { items: [{ product_id: pid, qty: 3 }], method: 'efectivo' } });
check('venta de 3 unidades', sale.status === 201 && sale.data.sale.total === 3, JSON.stringify(sale.data));

const tooMany = await call('POST', 'sales', { token: userToken, body: { items: [{ product_id: pid, qty: 50 }], method: 'efectivo' } });
check('venta sin stock suficiente rechazada', tooMany.status === 409, `status ${tooMany.status}`);

const prods = (await call('GET', 'products', { token: userToken })).data.products;
check('stock baja a 7 tras la venta', prods.find((p) => p.id === pid)?.stock === 7);

const restock = await call('POST', `products/${pid}/restock`, { token: adminToken, body: { qty: 5 } });
check('reabastecimiento suma stock', restock.status === 200 && restock.data.stock === 12, JSON.stringify(restock.data));

const emptySale = await call('POST', 'sales', { token: userToken, body: { items: [], method: 'efectivo' } });
check('venta vacía rechazada', emptySale.status === 400);

// 6. Dashboard y reportes
console.log('\n6. Dashboard y reportes');
const dash = await call('GET', 'dashboard', { token: adminToken });
check('dashboard responde', dash.status === 200);
check('dashboard trae 7 días', dash.data.week?.length === 7);
check('ingresos de hoy incluyen cobros y venta', dash.data.income_today >= 79.99 + 79.99 + 15 + 3, `income ${dash.data.income_today}`);
check('entradas de hoy cuentan', dash.data.entries_today >= 2, `entries ${dash.data.entries_today}`);
check('clientes activos cuentan', dash.data.clients_total >= 2);

const rep = await call('GET', `reports/summary?from=${today}&to=${today}`, { token: adminToken });
check('reporte del día responde', rep.status === 200);
check('reporte separa membresías y ventas', rep.data.income_memberships >= 159.98 && rep.data.income_sales >= 3, JSON.stringify(rep.data));
check('reporte lista productos vendidos', rep.data.products.some((p) => p.name === `Agua ${suffix}` && p.qty === 3));
const badRange = await call('GET', `reports/summary?from=${addDays(today, 5)}&to=${today}`, { token: adminToken });
check('rango de fechas invertido rechazado', badRange.status === 400);

// 7. Configuración
console.log('\n7. Configuración');
const cfg = await call('PUT', 'settings', { token: adminToken, body: { gym_name: 'Mission Fit Panamá', phone: '+507 6000-0000' } });
check('admin guarda configuración', cfg.status === 200);
const cfgGet = await call('GET', 'settings', { token: userToken });
check('configuración se lee', cfgGet.data.settings?.gym_name === 'Mission Fit Panamá');

const planEdit = await call('PUT', 'plans/daily', { token: adminToken, body: { price: 16 } });
check('admin cambia precio de plan', planEdit.status === 200 && planEdit.data.plan.price === 16);

// 8. Errores
console.log('\n8. Rutas y errores');
const notFound = await call('GET', 'no-existe', { token: creator });
check('ruta inexistente devuelve 404', notFound.status === 404);
const wrongMethod = await call('DELETE', 'status', { token: creator });
check('método no permitido devuelve 405', wrongMethod.status === 405);

// 9. Market: iconos, categorías, cuenta del cliente y edición de usuarios
console.log('\n9. Market, cuenta del cliente y usuarios');
const badIcon = await call('POST', 'products', { token: adminToken, body: { name: 'Icono malo', price: 1, icon: '🦄' } });
check('icono fuera de la lista rechazado', badIcon.status === 400, `status ${badIcon.status}`);
const iconProd = await call('POST', 'products', { token: adminToken, body: { name: `Jugo ${suffix}`, price: 1.5, stock: 6, min_stock: 2, icon: '🧃', category: 'Bebidas' } });
check('producto con icono y categoría', iconProd.status === 201 && iconProd.data.product.icon === '🧃' && iconProd.data.product.category === 'Bebidas', JSON.stringify(iconProd.data));
const jid = iconProd.data.product.id;

const noClientAcc = await call('POST', 'sales', { token: userToken, body: { items: [{ product_id: jid, qty: 1 }], method: 'cuenta' } });
check('cargar a cuenta sin cliente rechazado', noClientAcc.status === 400, `status ${noClientAcc.status}`);

const acc = await call('POST', 'sales', { token: userToken, body: { items: [{ product_id: jid, qty: 2 }], method: 'cuenta', client_id: clientId } });
check('venta a cuenta registrada', acc.status === 201 && acc.data.sale.on_account === true && acc.data.sale.method === 'cuenta', JSON.stringify(acc.data));

const led1 = await call('GET', `clients/${clientId}/ledger`, { token: userToken });
check('saldo del cliente tras la venta a cuenta', led1.data.balance === 3, JSON.stringify(led1.data));
check('movimiento de cargo en el libro', led1.data.movements?.some((m) => m.kind === 'cargo' && m.amount === 3));

const overAbono = await call('POST', `clients/${clientId}/abonos`, { token: userToken, body: { amount: 5, method: 'efectivo' } });
check('abono mayor al saldo rechazado', overAbono.status === 400, `status ${overAbono.status}`);

const abono = await call('POST', `clients/${clientId}/abonos`, { token: userToken, body: { amount: 1.5, method: 'tarjeta' } });
check('abono parcial registrado', abono.status === 201 && abono.data.balance === 1.5, JSON.stringify(abono.data));

const detail = await call('GET', `clients/${clientId}`, { token: userToken });
check('ficha del cliente muestra saldo', detail.data.client?.balance === 1.5);

const repAcc = await call('GET', `reports/summary?from=${today}&to=${today}`, { token: adminToken });
check('reporte incluye abonos cobrados', repAcc.data.income_abonos >= 1.5, JSON.stringify(repAcc.data));
check('reporte incluye cargado a cuentas', repAcc.data.charged_to_accounts >= 3);
check('reporte incluye saldo por cobrar', repAcc.data.accounts_pending >= 1.5);

const editUser = await call('PUT', `users/${(await call('GET', 'users', { token: creator })).data.users.find((x) => x.email === userEmail).id}`, { token: adminToken, body: { name: 'Recepción Editada' } });
check('admin edita nombre de recepción', editUser.status === 200, JSON.stringify(editUser.data));
const editAdmin = await call('PUT', `users/${(await call('GET', 'users', { token: creator })).data.users.find((x) => x.email === adminEmail).id}`, { token: adminToken, body: { name: 'Nope' } });
check('admin no puede editar a otro administrador', editAdmin.status === 403, `status ${editAdmin.status}`);
const shortPass = await call('PUT', `users/${(await call('GET', 'users', { token: creator })).data.users.find((x) => x.email === userEmail).id}`, { token: creator, body: { password: 'corta' } });
check('contraseña corta al editar rechazada', shortPass.status === 400);

const recId = (await call('GET', 'users', { token: creator })).data.users.find((x) => x.email === userEmail).id;
const deact = await call('PUT', `users/${recId}`, { token: creator, body: { active: false } });
check('creador desactiva recepción', deact.status === 200, JSON.stringify(deact.data));
const oldSession = await call('GET', 'clients', { token: userToken });
check('sesión de usuario desactivado se cierra', oldSession.status === 401, `status ${oldSession.status}`);

// 10. Yappy en ventas de Market
console.log('\n10. Yappy en Market');
const yVenta = await call('POST', 'sales', { token: creator, body: { items: [{ product_id: pid, qty: 1 }], method: 'yapi' } });
check('venta por Yappy sin código rechazada', yVenta.status === 400, `status ${yVenta.status}`);
const yVentaOk = await call('POST', 'sales', { token: creator, body: { items: [{ product_id: pid, qty: 1 }], method: 'yapi', reference: `vy-${suffix}` } });
check('venta por Yappy con código registrada', yVentaOk.status === 201, JSON.stringify(yVentaOk.data));
const yVentaDup = await call('POST', 'sales', { token: creator, body: { items: [{ product_id: pid, qty: 1 }], method: 'yapi', reference: `VY-${suffix}` } });
check('mismo código de Yappy en otra venta rechazado', yVentaDup.status === 409, `status ${yVentaDup.status}`);

// 11. Uso diario frente a membresía
console.log('\n11. Uso diario');
const dailyMember = await call('POST', 'memberships', { token: creator, body: { client_id: clientId, plan_id: 'daily', method: 'efectivo' } });
check('miembro activo no puede pagar uso diario', dailyMember.status === 409, `status ${dailyMember.status}`);
const dailyTwice = await call('POST', 'memberships', { token: creator, body: { client_id: c2.data.client.id, plan_id: 'daily', method: 'efectivo' } });
check('no se cobra uso diario dos veces el mismo día', dailyTwice.status === 409, `status ${dailyTwice.status}`);
const c3 = await call('POST', 'clients', { token: creator, body: { full_name: 'Visitante Prueba', cedula: `7-${suffix}` } });
const dailyNew = await call('POST', 'memberships', { token: creator, body: { client_id: c3.data.client.id, plan_id: 'daily', method: 'efectivo' } });
check('sin membresía sí paga uso diario', dailyNew.status === 201, `status ${dailyNew.status}`);
const dailyIn = await call('POST', 'entries/check-in', { token: creator, body: { client_id: c3.data.client.id } });
check('uso diario permite entrar', dailyIn.status === 201, `status ${dailyIn.status}`);

console.log(`\nResultado: ${passes} pasaron, ${failures} fallaron`);
process.exit(failures ? 1 : 0);
