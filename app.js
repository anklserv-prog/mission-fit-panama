// Mission Fit - frontend conectado a la API (/api/*).
(() => {
  'use strict';

  const TOKEN_KEY = 'mf_token';
  const RANK = { user: 1, admin: 2, creator: 3 };
  const ROLE_LABEL = { creator: '👑 Creador', admin: '📊 Administrador', user: '👤 Recepción' };
  const METHOD_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', yapi: 'Yappy', cuenta: 'Cuenta' };
  const YAPPY_LOGO = '<img class="yappy-logo" src="/img/yappy.png" alt="" aria-hidden="true">';
  const STATUS = {
    activa: ['Activa', 'badge-success'],
    por_vencer: ['Por vencer', 'badge-warning'],
    vencida: ['Vencida', 'badge-danger'],
    sin_membresia: ['Sin membresía', 'badge-muted'],
  };
  // Debe coincidir con PRODUCT_ICONS de lib/util.js (la API valida contra esa lista).
  const PRODUCT_ICONS = [
    '💧', '🥤', '🧃', '☕', '🍵', '🧋', '🥛', '🍺', '🍷', '🍹',
    '🍫', '🍪', '🥜', '🍿', '🍟', '🥪', '🍌', '🍎', '🍊', '🥗',
    '🍗', '🍝', '🥤', '🧊', '🏋️', '🧴', '👕', '🧢', '🎽', '📦',
  ];
  const MENU = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard', min: 'admin', title: ['📊 Dashboard', 'Resumen general del gimnasio'] },
    { id: 'checkin', icon: '📱', label: 'Check-in', min: 'user', title: ['📱 Check-in', 'Registra entradas y renovaciones'] },
    { id: 'clientes', icon: '👥', label: 'Clientes', min: 'user', title: ['👥 Clientes', 'Directorio, estado de membresías y cuenta'] },
    { id: 'inventario', icon: '🛒', label: 'Market', min: 'user', title: ['🛒 Market', 'Productos, venta rápida e inventario'] },
    { id: 'reportes', icon: '📈', label: 'Reportes', min: 'admin', title: ['📈 Reportes', 'Ingresos, entradas, ventas y cuentas'] },
    { id: 'config', icon: '⚙️', label: 'Configuración', min: 'admin', title: ['⚙️ Configuración', 'Datos del gimnasio, planes y usuarios'] },
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const money = (n) => '$' + Number(n || 0).toFixed(2);
  const badge = (status) => {
    const [text, cls] = STATUS[status] || [status, 'badge-muted'];
    return `<span class="badge ${cls}">${esc(text)}</span>`;
  };
  const fmtDate = (d) => {
    if (!d) return '–';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };
  const panamaToday = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
  const addDays = (d, n) => {
    const x = new Date(d + 'T00:00:00Z');
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const timeOf = (ms) => new Date(ms).toLocaleTimeString('es-PA', {
    timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit',
  });
  const can = (min) => !!me && RANK[me.role] >= RANK[min];
  const categoryOf = (p) => p.category || 'General';

  let me = null;
  let plans = [];
  let products = [];
  let users = [];
  let cart = [];
  let posClient = null; // { id, full_name, balance } o null (venta de mostrador)
  let marketCat = 'Todos';
  let marketSearch = '';
  let currentView = 'dashboard';
  let openTimer = null;
  let searchTimer = null;

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  function toast(msg, ok = true) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (ok ? 'ok' : 'bad');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.className = 'toast'; }, 3200);
  }

  async function api(method, path, body) {
    const headers = {};
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch('/api/' + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* respuesta sin cuerpo */ }

    if (res.status === 401 && token && path !== 'login') {
      logout(true);
      throw new Error('Tu sesión expiró, vuelve a ingresar');
    }
    if (!res.ok) {
      const err = new Error(data.error || 'Error ' + res.status);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function show(id) {
    ['setupPage', 'loginPage', 'appPage'].forEach((p) => {
      $(p).style.display = p === id ? 'flex' : 'none';
    });
  }

  function openModal(html) {
    $('modalBox').innerHTML = html;
    $('modal').classList.add('active');
  }
  function closeModal() {
    $('modal').classList.remove('active');
    $('modalBox').innerHTML = '';
  }
  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }
  function setBusy(btn, busy, label) {
    if (!btn) return;
    btn.disabled = busy;
    if (busy) { btn.dataset.label = btn.textContent; btn.textContent = 'Guardando…'; }
    else if (btn.dataset.label) btn.textContent = label || btn.dataset.label;
  }

  // -------------------------------------------------------------------------
  // Sesión
  // -------------------------------------------------------------------------

  async function boot() {
    let status;
    try {
      status = await api('GET', 'status');
    } catch (err) {
      $('loginError').textContent = 'No se pudo conectar con el servidor.';
      show('loginPage');
      return;
    }
    if (!status.configured) { show('setupPage'); return; }
    if (!localStorage.getItem(TOKEN_KEY)) { show('loginPage'); return; }
    try {
      const r = await api('GET', 'me');
      me = r.user;
      await enterApp();
    } catch (_) {
      show('loginPage');
    }
  }

  function logout(silent) {
    if (!silent) api('POST', 'logout').catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
    me = null;
    clearInterval(openTimer);
    cart = [];
    posClient = null;
    show('loginPage');
  }

  function paintUser() {
    $('userName').textContent = me.name;
    $('userRole').textContent = ROLE_LABEL[me.role];
    $('headerUser').textContent = `${me.name} · ${ROLE_LABEL[me.role]}`;
  }

  async function refreshMe() {
    me = (await api('GET', 'me')).user;
    paintUser();
  }

  async function enterApp() {
    paintUser();
    buildNav();
    const p = await api('GET', 'plans');
    plans = p.plans;
    show('appPage');
    go(MENU.find((m) => can(m.min)).id);
  }

  function buildNav() {
    const nav = $('navMenu');
    nav.innerHTML = '';
    MENU.filter((m) => can(m.min)).forEach((m) => {
      const li = document.createElement('li');
      li.className = 'nav-item';
      li.id = 'nav-' + m.id;
      li.innerHTML = `<span class="nav-icon">${m.icon}</span><span>${m.label}</span>`;
      li.addEventListener('click', () => go(m.id));
      nav.appendChild(li);
    });
  }

  function go(id) {
    const item = MENU.find((m) => m.id === id);
    if (!item || !can(item.min)) return;
    currentView = id;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    $('nav-' + id)?.classList.add('active');
    const viewEl = $(id === 'config' ? 'configView' : id + 'View');
    viewEl.classList.add('active');
    $('headerTitle').textContent = item.title[0];
    $('headerSubtitle').textContent = item.title[1];

    clearInterval(openTimer);
    const loaders = {
      dashboard: loadDashboard,
      checkin: () => {
        openTimer = setInterval(() => loadOpenEntries().catch(() => {}), 30000);
        return loadOpenEntries();
      },
      clientes: loadClients,
      inventario: loadProducts,
      reportes: loadReport,
      config: loadConfig,
    };
    loaders[id]().catch((e) => toast(e.message, false));
  }

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------

  async function loadDashboard() {
    const d = await api('GET', 'dashboard');
    $('kClients').textContent = d.clients_total;
    $('kIncome').textContent = money(d.income_today);
    $('kEntries').textContent = d.entries_today;
    $('kExpiring').textContent = d.expiring_count;
    $('weekBody').innerHTML = d.week.map((r) => (
      `<tr><td>${fmtDate(r.day)}</td><td>${r.entries}</td><td>${money(r.income)}</td></tr>`
    )).join('');
    $('expiringList').innerHTML = d.expiring.length
      ? `<table><thead><tr><th>Cliente</th><th>Teléfono</th><th>Plan</th><th>Vence</th></tr></thead><tbody>${
        d.expiring.map((e) => `<tr><td>${esc(e.full_name)}</td><td>${esc(e.phone || '–')}</td><td>${esc(e.plan_name)}</td><td>${fmtDate(e.membership_end)}</td></tr>`).join('')
      }</tbody></table>`
      : '<p class="muted">Nadie vence en los próximos 7 días.</p>';
  }

  // -------------------------------------------------------------------------
  // Check-in
  // -------------------------------------------------------------------------

  async function searchCheckin() {
    const q = $('ciSearch').value.trim();
    if (q.length < 2) { $('ciResults').innerHTML = ''; return; }
    const { clients } = await api('GET', 'clients?q=' + encodeURIComponent(q));
    $('ciResults').innerHTML = clients.slice(0, 8).map((c) => `
      <div class="result-row" data-id="${esc(c.id)}">
        <div><strong>${esc(c.full_name)}</strong> <span class="muted">${esc(c.cedula || '')}</span></div>
        ${badge(c.membership_status)}
      </div>`).join('') || '<p class="muted">Sin resultados.</p>';
  }

  async function showClientCheckin(id) {
    const { client } = await api('GET', 'clients/' + encodeURIComponent(id));
    const st = client.membership_status;
    const active = st === 'activa' || st === 'por_vencer';
    const endTxt = fmtDate(client.membership_end);

    // Estado de la membresía: cada caso se ve distinto para no confundir a recepción.
    const statusBox = {
      activa: `<div class="status-box ok">✅ <strong>Membresía activa</strong> hasta el ${endTxt}${client.membership_plan ? ` · ${esc(client.membership_plan)}` : ''}</div>`,
      por_vencer: `<div class="status-box warn">⚠️ <strong>Membresía por vencer</strong>: vence el ${endTxt}. Renueva para seguir entrando.</div>`,
      vencida: `<div class="status-box off">⛔ <strong>Membresía vencida</strong> desde el ${endTxt}. No puede entrar hasta renovar.</div>`,
      sin_membresia: '<div class="status-box off">⛔ <strong>Sin membresía</strong>. Debe cobrar una membresía para entrar.</div>',
    }[st] || '';

    const planOptions = plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.price)}</option>`).join('');
    const methodOptions = Object.entries(METHOD_LABEL)
      .filter(([v]) => v !== 'cuenta')
      .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    const renewLabel = active ? '🔁 Renovar' : '💳 Cobrar y activar';
    const renewForm = `
      <div class="form-row">
        <div class="form-group"><label>Plan:</label><select id="renewPlan">${planOptions}</select></div>
        <div class="form-group"><label>Método:</label><select id="renewMethod">${methodOptions}</select></div>
      </div>
      <div class="form-row ref-box" id="renewRefBox" style="display:none;">
        <div class="form-group" style="grid-column:1 / -1;"><label>Código de transacción de Yappy:</label><input id="renewRef" class="wide-input" autocomplete="off" placeholder="Ej: 1A2B3C4D"></div>
      </div>
      <div class="btn-group"><button class="btn btn-primary" id="renewBtn">${renewLabel}</button></div>`;

    let renewSection;
    if (st === 'activa') {
      renewSection = `<details class="renew-details"><summary>🔁 Renovar por adelantado</summary>${renewForm}</details>`;
    } else if (st === 'por_vencer') {
      renewSection = `<div class="card-title" style="margin-bottom:12px;">🔁 Renovar membresía</div>${renewForm}`;
    } else {
      renewSection = `<div class="card-title" style="margin-bottom:12px;">💳 Cobrar membresía</div>${renewForm}`;
    }

    $('ciDetail').style.display = 'block';
    $('ciDetail').innerHTML = `
      <div class="flex-between">
        <div>
          <div class="detail-title">${esc(client.full_name)}</div>
          <div class="muted">Cédula ${esc(client.cedula || '–')} · Tel. ${esc(client.phone || '–')}</div>
        </div>
        ${badge(st)}
      </div>
      ${statusBox}
      <div class="btn-group">
        <button class="btn btn-success" id="ciEnter" ${active ? '' : 'disabled'}>✓ Registrar entrada</button>
      </div>
      ${active ? '' : '<p class="muted" style="margin-top:8px;">Para entrar, primero debe cobrar la membresía.</p>'}
      <hr class="detail-divider">
      ${renewSection}
    `;

    // Guardar el botón antes de cualquier await: e.currentTarget queda en null después.
    $('ciEnter')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true);
      try {
        await api('POST', 'entries/check-in', { client_id: client.id });
        toast(`✓ Entrada registrada: ${client.full_name}`);
        loadOpenEntries();
        showClientCheckin(client.id);
      } catch (err) {
        toast(err.message, false);
      } finally {
        setBusy(btn, false);
      }
    });

    $('renewMethod').addEventListener('change', () => {
      $('renewRefBox').style.display = $('renewMethod').value === 'yapi' ? '' : 'none';
    });
    $('renewBtn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true);
      try {
        const r = await api('POST', 'memberships', {
          client_id: client.id,
          plan_id: $('renewPlan').value,
          method: $('renewMethod').value,
          reference: $('renewRef').value,
        });
        toast(`Membresía activa hasta ${fmtDate(r.membership.end_date)}`);
        showClientCheckin(client.id);
      } catch (err) {
        toast(err.message, false);
      } finally {
        setBusy(btn, false);
      }
    });

    $('ciDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadOpenEntries() {
    if (currentView !== 'checkin') return;
    const { entries } = await api('GET', 'entries/open');
    if (!entries.length) {
      $('openEntries').innerHTML = '<p class="muted">Nadie dentro en este momento.</p>';
      return;
    }
    $('openEntries').innerHTML = `<table><thead><tr><th>Cliente</th><th>Entrada</th><th>Tiempo</th><th></th></tr></thead><tbody>${
      entries.map((en) => {
        const mins = Math.round((Date.now() - en.check_in_at) / 60000);
        return `<tr>
          <td>${esc(en.full_name)}</td>
          <td>${timeOf(en.check_in_at)}</td>
          <td>${mins} min</td>
          <td class="row-actions"><button class="btn btn-danger btn-small" data-out="${esc(en.id)}">Salida</button></td>
        </tr>`;
      }).join('')
    }</tbody></table>`;
  }

  // -------------------------------------------------------------------------
  // Clientes
  // -------------------------------------------------------------------------

  async function loadClients() {
    const q = $('clientSearch').value.trim();
    const { clients } = await api('GET', 'clients?q=' + encodeURIComponent(q));
    $('clientsBody').innerHTML = clients.map((c) => `
      <tr>
        <td><strong>${esc(c.full_name)}</strong></td>
        <td>${esc(c.cedula || '–')}</td>
        <td>${esc(c.phone || '–')}</td>
        <td>${esc(c.membership_plan || '—')}</td>
        <td>${fmtDate(c.membership_end)}</td>
        <td>${badge(c.membership_status)}</td>
        <td class="row-actions">
          <button class="btn btn-secondary btn-small" data-detail="${esc(c.id)}">Ver</button>
          ${can('admin') ? `<button class="btn btn-secondary btn-small" data-edit="${esc(c.id)}">Editar</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">Sin clientes que mostrar.</td></tr>';
  }

  function clientFormHtml(c = {}) {
    const v = (k) => esc(c[k] ?? '');
    return `
      <div class="modal-header">${c.id ? '✏️ Editar cliente' : '➕ Nuevo cliente'}</div>
      <form id="clientForm" data-id="${esc(c.id || '')}">
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nombre completo:</label><input name="full_name" required value="${v('full_name')}"></div></div>
        <div class="form-row">
          <div class="form-group"><label>Cédula:</label><input name="cedula" value="${v('cedula')}"></div>
          <div class="form-group"><label>Teléfono:</label><input name="phone" type="tel" placeholder="+507 6789-0123" value="${v('phone')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Email:</label><input name="email" type="email" value="${v('email')}"></div>
          <div class="form-group"><label>Fecha de nacimiento:</label><input name="birth_date" type="date" value="${v('birth_date')}"></div>
        </div>
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Notas:</label><input name="notes" value="${v('notes')}"></div></div>
        <div class="error" id="clientError"></div>
        <div class="btn-group">
          <button class="btn btn-primary" type="submit">✓ Guardar</button>
          <button class="btn btn-secondary" type="button" data-close>Cancelar</button>
        </div>
      </form>`;
  }

  // Formulario para cobrar una membresía a un cliente (desde su ficha o al crearlo).
  function membershipFormHtml(clientId) {
    const methodOptions = Object.entries(METHOD_LABEL)
      .filter(([v]) => v !== 'cuenta')
      .map(([v, l]) => `<option value="${v}">${v === 'yapi' ? 'Yappy' : l}</option>`).join('');
    return `
      <form id="memberForm" data-id="${esc(clientId)}">
        <div class="form-row">
          <div class="form-group"><label>Plan:</label><select name="plan_id">${plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.price)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Método:</label><select name="method">${methodOptions}</select></div>
        </div>
        <div class="form-row ref-box" style="display:none;">
          <div class="form-group" style="grid-column:1 / -1;"><label>Código de transacción de Yappy:</label><input name="reference" class="wide-input" autocomplete="off" placeholder="Ej: 1A2B3C4D"></div>
        </div>
        <div class="error"></div>
        <div class="btn-group"><button class="btn btn-primary" type="submit">💳 Cobrar membresía</button></div>
      </form>`;
  }

  async function clientDetail(id) {
    const [{ client, memberships, payments, entries }, ledger] = await Promise.all([
      api('GET', 'clients/' + encodeURIComponent(id)),
      api('GET', 'clients/' + encodeURIComponent(id) + '/ledger'),
    ]);
    const bal = Number(ledger.balance || 0);
    const movRows = ledger.movements.map((m) => `
      <tr>
        <td>${fmtDate(m.day)}</td>
        <td>${m.kind === 'cargo' ? 'Cargo' : 'Abono'}</td>
        <td>${esc(m.note || '')}${m.method ? ` · ${esc(METHOD_LABEL[m.method] || m.method)}` : ''}</td>
        <td class="${m.kind === 'cargo' ? 'amt-debit' : 'amt-credit'}">${m.kind === 'cargo' ? '+' : '−'}${money(m.amount)}</td>
      </tr>`).join('');

    openModal(`
      <button class="modal-close" data-close>✕</button>
      <div class="modal-header">${esc(client.full_name)}</div>
      <p class="muted">Cédula ${esc(client.cedula || '–')} · Tel. ${esc(client.phone || '–')} · ${esc(client.email || '')}</p>
      <p style="margin-top:8px;">Estado: ${badge(client.membership_status)} · Plan: <strong>${esc(client.membership_plan || '—')}</strong> · Vence: <strong>${fmtDate(client.membership_end)}</strong></p>
      <hr class="detail-divider">
      <div class="card-title" style="font-size:15px;">📒 Cuenta del cliente</div>
      <div class="status-box ${bal > 0.005 ? 'warn' : 'ok'}">Saldo pendiente: <strong>${money(bal)}</strong></div>
      ${bal > 0.005 ? `
      <form id="abonoForm" data-id="${esc(client.id)}" style="margin-top:12px;">
        <div class="form-row">
          <div class="form-group"><label>Monto del abono:</label><input name="amount" type="number" step="0.01" min="0.01" max="${bal.toFixed(2)}" required></div>
          <div class="form-group"><label>Método:</label><select name="method">${Object.entries(METHOD_LABEL).filter(([v]) => v !== 'cuenta').map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        </div>
        <div class="error" id="abonoError"></div>
        <div class="btn-group"><button class="btn btn-success" type="submit">✓ Registrar abono</button></div>
      </form>` : ''}
      ${ledger.movements.length ? `<table style="margin-top:12px;"><thead><tr><th>Día</th><th>Tipo</th><th>Detalle</th><th>Monto</th></tr></thead><tbody>${movRows}</tbody></table>` : '<p class="muted">Sin movimientos de cuenta.</p>'}
      <hr class="detail-divider">
      <div class="card-title" style="font-size:15px;">💳 Cobrar membresía</div>
      ${membershipFormHtml(client.id)}
      <hr class="detail-divider">
      <div class="card-title" style="font-size:15px;">Membresías</div>
      ${memberships.length ? `<table><thead><tr><th>Plan</th><th>Desde</th><th>Hasta</th><th>Monto</th></tr></thead><tbody>${
        memberships.map((m) => `<tr><td>${esc(m.plan_name)}</td><td>${fmtDate(m.start_date)}</td><td>${fmtDate(m.end_date)}</td><td>${money(m.amount)}</td></tr>`).join('')
      }</tbody></table>` : '<p class="muted">Sin membresías.</p>'}
      <div class="card-title" style="font-size:15px;margin-top:16px;">Últimas entradas</div>
      ${entries.length ? `<table><thead><tr><th>Día</th><th>Entrada</th><th>Salida</th></tr></thead><tbody>${
        entries.slice(0, 10).map((e) => `<tr><td>${fmtDate(e.day)}</td><td>${timeOf(e.check_in_at)}</td><td>${e.check_out_at ? timeOf(e.check_out_at) : 'Dentro'}</td></tr>`).join('')
      }</tbody></table>` : '<p class="muted">Sin entradas registradas.</p>'}
      <div class="card-title" style="font-size:15px;margin-top:16px;">Pagos</div>
      ${payments.length ? `<table><thead><tr><th>Día</th><th>Método</th><th>Monto</th></tr></thead><tbody>${
        payments.slice(0, 10).map((p) => `<tr><td>${fmtDate(p.day)}</td><td>${METHOD_LABEL[p.method] || esc(p.method)}</td><td>${money(p.amount)}</td></tr>`).join('')
      }</tbody></table>` : '<p class="muted">Sin pagos registrados.</p>'}
    `);
  }

  // -------------------------------------------------------------------------
  // Market: productos en cuadrícula, carrito y venta
  // -------------------------------------------------------------------------

  async function loadProducts() {
    const r = await api('GET', 'products');
    products = r.products;
    $('newProductBtn').style.display = can('admin') ? '' : 'none';

    // Ajusta el carrito a los datos nuevos (stock agotado o precio cambiado).
    cart = cart
      .map((c) => {
        const p = products.find((x) => x.id === c.product_id);
        if (!p || p.stock <= 0) return null;
        return { ...c, price: p.price, qty: Math.min(c.qty, p.stock) };
      })
      .filter(Boolean);

    renderMarket();
    renderProductsTable();
    renderCart();
  }

  function renderMarket() {
    const cats = ['Todos', ...new Set(products.map(categoryOf))];
    if (!cats.includes(marketCat)) marketCat = 'Todos';
    $('mkCats').innerHTML = cats.map((c) => (
      `<button class="cat-tab ${c === marketCat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`
    )).join('');

    const q = marketSearch.trim().toLowerCase();
    const list = products.filter((p) => (
      (marketCat === 'Todos' || categoryOf(p) === marketCat) &&
      (!q || p.name.toLowerCase().includes(q))
    ));
    $('mkGrid').innerHTML = list.map((p) => {
      const out = p.stock <= 0;
      const low = !out && p.stock <= p.min_stock;
      return `
        <button class="pcard" data-add="${esc(p.id)}" ${out ? 'disabled' : ''}>
          <span class="pcard-icon">${esc(p.icon || '📦')}</span>
          <span class="pcard-name">${esc(p.name)}</span>
          <span class="pcard-price">${money(p.price)}</span>
          <span class="pcard-stock ${low ? 'low' : ''}">${out ? 'Agotado' : (low ? `Pocas: ${p.stock}` : `Stock ${p.stock}`)}</span>
        </button>`;
    }).join('') || '<p class="muted" style="grid-column:1/-1;">No hay productos en esta categoría.</p>';
  }

  function renderProductsTable() {
    $('productsBody').innerHTML = products.map((p) => {
      const low = p.stock <= p.min_stock;
      return `<tr>
        <td><span class="tbl-icon">${esc(p.icon || '📦')}</span><strong>${esc(p.name)}</strong></td>
        <td>${esc(categoryOf(p))}</td>
        <td>${p.stock}</td>
        <td>${money(p.price)}</td>
        <td>${low ? '<span class="badge badge-warning">Bajo stock</span>' : '<span class="badge badge-success">OK</span>'}</td>
        <td class="row-actions">
          ${can('admin') ? `<button class="btn btn-secondary btn-small" data-restock="${esc(p.id)}">+ Stock</button>
          <button class="btn btn-secondary btn-small" data-edit-product="${esc(p.id)}">Editar</button>` : ''}
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">Aún no hay productos.</td></tr>';
  }

  function addToCart(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const line = cart.find((c) => c.product_id === id);
    const newQty = (line?.qty || 0) + 1;
    if (newQty > p.stock) return toast(`Solo hay ${p.stock} de ${p.name}`, false);
    if (line) line.qty = newQty;
    else cart.push({ product_id: id, name: p.name, icon: p.icon || '📦', price: p.price, qty: 1 });
    renderCart();
  }

  function changeQty(i, delta) {
    const line = cart[i];
    if (!line) return;
    const p = products.find((x) => x.id === line.product_id);
    const next = line.qty + delta;
    if (next <= 0) { cart.splice(i, 1); }
    else if (p && next > p.stock) { return toast(`Solo hay ${p.stock} de ${p.name}`, false); }
    else line.qty = next;
    renderCart();
  }

  function renderCart() {
    $('cartItems').innerHTML = cart.length ? cart.map((c, i) => `
      <div class="cart-line">
        <span class="ci">${esc(c.icon)}</span>
        <div class="cart-name"><strong>${esc(c.name)}</strong><div class="muted">${money(c.price)} c/u</div></div>
        <div class="qty-ctrl">
          <button data-dec="${i}" aria-label="Quitar uno">−</button>
          <span>${c.qty}</span>
          <button data-inc="${i}" aria-label="Agregar uno">+</button>
        </div>
        <strong class="cart-amt">${money(c.qty * c.price)}</strong>
        <button class="btn-x" data-remove="${i}" title="Quitar producto">✕</button>
      </div>`).join('') : '<div class="cart-empty">Toca un producto para agregarlo a la venta.</div>';

    const units = cart.reduce((s, c) => s + c.qty, 0);
    const total = cart.reduce((s, c) => s + c.qty * c.price, 0);
    $('sumItems').textContent = units;
    $('cartTotal').textContent = money(total);
    $('posCharge').disabled = cart.length === 0;

    $('posClientInfo').innerHTML = posClient
      ? `<div class="client-chip ${posClient.balance > 0.005 ? 'debt' : ''}">
           <div><strong>👤 ${esc(posClient.full_name)}</strong>
             <div class="muted">Saldo pendiente: ${money(posClient.balance)}</div></div>
           <button class="btn btn-secondary btn-small" data-clear-client>Quitar</button>
         </div>`
      : '<p class="muted" style="margin-top:6px;">Sin cliente: venta de mostrador.</p>';

    $('posRefBox').style.display = $('posMethod').value === 'yapi' ? '' : 'none';

    // Muestra el logo de Yappy cuando ese es el método elegido.
    $('posMethodHint').innerHTML = $('posMethod').value === 'yapi'
      ? `<span class="method-hint">${YAPPY_LOGO} Cobro por Yappy</span>`
      : '';

    // "Cargar a cuenta" solo está disponible cuando hay un cliente seleccionado.
    $('posCuentaOpt').disabled = !posClient;
    if (!posClient && $('posMethod').value === 'cuenta') $('posMethod').value = 'efectivo';
  }

  async function searchPosClient() {
    const q = $('posClientSearch').value.trim();
    if (q.length < 2) { $('posClientResults').innerHTML = ''; return; }
    const { clients } = await api('GET', 'clients?q=' + encodeURIComponent(q));
    $('posClientResults').innerHTML = clients.slice(0, 6).map((c) => `
      <div class="result-row" data-pick="${esc(c.id)}">
        <div><strong>${esc(c.full_name)}</strong> <span class="muted">${esc(c.cedula || '')}</span></div>
      </div>`).join('') || '<p class="muted">Sin resultados.</p>';
  }

  async function pickPosClient(id) {
    const { client } = await api('GET', 'clients/' + encodeURIComponent(id));
    posClient = { id: client.id, full_name: client.full_name, balance: Number(client.balance || 0) };
    $('posClientSearch').value = '';
    $('posClientResults').innerHTML = '';
    renderCart();
  }

  async function chargeSale(btn) {
    if (!cart.length) return toast('Agrega productos al carrito', false);
    const method = $('posMethod').value;
    if (method === 'cuenta' && !posClient) return toast('Selecciona el cliente para cargar a cuenta', false);
    if (method === 'yapi' && !$('posRef').value.trim()) return toast('Ingresa el código de transacción de Yappy', false);

    setBusy(btn, true);
    try {
      const r = await api('POST', 'sales', {
        items: cart.map((c) => ({ product_id: c.product_id, qty: c.qty })),
        method,
        reference: method === 'yapi' ? $('posRef').value : undefined,
        client_id: posClient ? posClient.id : undefined,
      });
      const who = posClient ? ` · ${posClient.full_name}` : '';
      toast(r.sale.on_account
        ? `✓ Cargado a la cuenta${who}: ${money(r.sale.total)}`
        : `✓ Venta cobrada${who}: ${money(r.sale.total)}`);
      cart = [];
      posClient = null;
      $('posMethod').value = 'efectivo';
      $('posRef').value = '';
      renderCart();
      loadProducts();
    } catch (err) {
      toast(err.message, false);
    } finally {
      setBusy(btn, false);
    }
  }

  function productFormHtml(p = {}) {
    const isEdit = !!p.id;
    const cur = p.icon || '📦';
    const cats = [...new Set(products.map((x) => x.category).filter(Boolean))];
    return `
      <div class="modal-header">${isEdit ? '✏️ Editar producto' : '➕ Nuevo producto'}</div>
      <form id="productForm" data-id="${esc(p.id || '')}">
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nombre:</label><input name="name" required value="${esc(p.name ?? '')}"></div></div>
        <div class="form-row">
          <div class="form-group"><label>Precio:</label><input name="price" type="number" step="0.01" min="0" required value="${p.price ?? ''}"></div>
          <div class="form-group"><label>Categoría:</label><input name="category" list="catList" placeholder="Ej: Bebidas" value="${esc(p.category ?? '')}"><datalist id="catList">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Stock mínimo:</label><input name="min_stock" type="number" min="0" value="${p.min_stock ?? 5}"></div>
          ${isEdit ? '<div class="form-group"></div>' : '<div class="form-group"><label>Stock inicial:</label><input name="stock" type="number" min="0" value="0"></div>'}
        </div>
        <div class="form-row">
          <div class="form-group" style="grid-column:1 / -1;">
            <label>Icono:</label>
            <div class="icon-grid">${PRODUCT_ICONS.map((i) => (
              `<button type="button" class="icon-opt ${i === cur ? 'sel' : ''}" data-icon="${i}">${i}</button>`
            )).join('')}</div>
            <input type="hidden" name="icon" value="${esc(cur)}">
          </div>
        </div>
        <div class="error" id="productError"></div>
        <div class="btn-group">
          <button class="btn btn-primary" type="submit">✓ Guardar</button>
          <button class="btn btn-secondary" type="button" data-close>Cancelar</button>
        </div>
      </form>`;
  }

  // -------------------------------------------------------------------------
  // Reportes
  // -------------------------------------------------------------------------

  async function loadReport() {
    const today = panamaToday();
    const period = $('repPeriod').value;
    const from = period === 'today' ? today
      : period === 'week' ? addDays(today, -6)
      : today.slice(0, 8) + '01';
    const r = await api('GET', `reports/summary?from=${from}&to=${today}`);

    $('rIncome').textContent = money(r.income_total);
    $('rMemberships').textContent = r.memberships_sold;
    $('rEntries').textContent = r.entries_total;
    $('rUnique').textContent = r.unique_clients;
    $('rNew').textContent = r.new_clients;
    $('rAbonos').textContent = money(r.income_abonos);
    $('rOnAccount').textContent = money(r.charged_to_accounts);
    $('rPending').textContent = money(r.accounts_pending);

    $('repDaysBody').innerHTML = r.days.map((d) => `
      <tr><td>${fmtDate(d.day)}</td><td>${d.entries}</td><td>${money(d.income)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">Sin movimientos en este período.</td></tr>';

    $('repMethodBody').innerHTML = Object.entries(r.by_method).map(([m, v]) => (
      `<tr><td>${METHOD_LABEL[m] || esc(m)}</td><td>${money(v)}</td></tr>`
    )).join('');

    $('repProductsBody').innerHTML = r.products.map((p) => (
      `<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>${money(p.total)}</td></tr>`
    )).join('') || '<tr><td colspan="3" class="muted">Sin ventas de productos.</td></tr>';
  }

  // -------------------------------------------------------------------------
  // Configuración
  // -------------------------------------------------------------------------

  async function loadConfig() {
    const [{ settings }, usersRes] = await Promise.all([api('GET', 'settings'), api('GET', 'users')]);
    users = usersRes.users;
    const form = $('settingsForm');
    Object.entries(settings).forEach(([k, v]) => {
      const el = form.elements[k];
      if (el) el.value = v ?? '';
    });
    const canEdit = can('admin');
    form.querySelectorAll('input, select, button').forEach((el) => { el.disabled = !canEdit; });

    $('plansBody').innerHTML = plans.map((p) => `
      <tr>
        <td>${esc(p.name)}</td>
        <td>${p.duration_days} día(s)</td>
        <td>${money(p.price)}</td>
        <td class="row-actions">${canEdit ? `<button class="btn btn-secondary btn-small" data-edit-plan="${esc(p.id)}">Editar</button>` : ''}</td>
      </tr>`).join('');

    $('newUserBtn').style.display = canEdit ? '' : 'none';
    $('usersBody').innerHTML = users.map((u) => {
      // El creador edita a cualquiera; el administrador solo a usuarios de recepción.
      const editable = me.role === 'creator' || u.role === 'user';
      const removable = me.role === 'creator' && u.id !== me.id;
      return `
      <tr>
        <td>${esc(u.name)}${u.id === me.id ? ' <span class="muted">(tú)</span>' : ''}</td>
        <td>${esc(u.email)}</td>
        <td>${esc(ROLE_LABEL[u.role])}</td>
        <td class="row-actions">
          ${editable ? `<button class="btn btn-secondary btn-small" data-edit-user="${esc(u.id)}">Editar</button>` : ''}
          ${removable ? `<button class="btn btn-danger btn-small" data-del-user="${esc(u.id)}">Eliminar</button>` : ''}
        </td>
      </tr>`;
    }).join('');
  }

  function planFormHtml(p) {
    return `
      <div class="modal-header">✏️ Editar plan</div>
      <form id="planForm" data-id="${esc(p.id)}">
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nombre:</label><input name="name" required value="${esc(p.name)}"></div></div>
        <div class="form-row">
          <div class="form-group"><label>Precio:</label><input name="price" type="number" step="0.01" min="0" required value="${p.price}"></div>
          <div class="form-group"><label>Duración (días):</label><input name="duration_days" type="number" min="1" required value="${p.duration_days}"></div>
        </div>
        <div class="error" id="planError"></div>
        <div class="btn-group">
          <button class="btn btn-primary" type="submit">✓ Guardar</button>
          <button class="btn btn-secondary" type="button" data-close>Cancelar</button>
        </div>
      </form>`;
  }

  function roleOptions() {
    return me.role === 'creator'
      ? [['creator', '👑 Creador'], ['admin', '📊 Administrador'], ['user', '👤 Recepción']]
      : [['admin', '📊 Administrador'], ['user', '👤 Recepción']];
  }

  function userFormHtml() {
    const roles = roleOptions();
    return `
      <div class="modal-header">➕ Crear usuario</div>
      <form id="userForm">
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nombre:</label><input name="name" required></div></div>
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Email:</label><input name="email" type="email" required></div></div>
        <div class="form-row">
          <div class="form-group"><label>Contraseña (mínimo 8):</label><input name="password" type="password" minlength="8" required></div>
          <div class="form-group"><label>Rol:</label><select name="role">${roles.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        </div>
        <div class="error" id="userError"></div>
        <div class="btn-group">
          <button class="btn btn-primary" type="submit">✓ Crear</button>
          <button class="btn btn-secondary" type="button" data-close>Cancelar</button>
        </div>
      </form>`;
  }

  function userEditFormHtml(u) {
    const self = u.id === me.id;
    const roles = roleOptions();
    return `
      <div class="modal-header">✏️ Editar usuario</div>
      <form id="userEditForm" data-id="${esc(u.id)}">
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nombre:</label><input name="name" required value="${esc(u.name)}"></div></div>
        <div class="form-row">
          <div class="form-group"><label>Rol:</label>
            <select name="role" ${self ? 'disabled' : ''}>${roles.map(([v, l]) => `<option value="${v}" ${v === u.role ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </div>
          <div class="form-group"><label>Estado:</label>
            <select name="active" ${self ? 'disabled' : ''}>
              <option value="1" ${u.active ? 'selected' : ''}>Activo</option>
              <option value="0" ${!u.active ? 'selected' : ''}>Desactivado</option>
            </select>
          </div>
        </div>
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nueva contraseña (opcional, mínimo 8):</label><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Déjala en blanco para no cambiarla"></div></div>
        <p class="muted" style="margin-bottom:10px;">${self ? 'No puedes cambiar tu propio rol ni desactivarte.' : 'Al desactivar o cambiar la contraseña, la sesión de ese usuario se cierra.'}</p>
        <div class="error" id="userError"></div>
        <div class="btn-group">
          <button class="btn btn-primary" type="submit">✓ Guardar</button>
          <button class="btn btn-secondary" type="button" data-close>Cancelar</button>
        </div>
      </form>`;
  }

  // -------------------------------------------------------------------------
  // Eventos
  // -------------------------------------------------------------------------

  function bindEvents() {
    $('setupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      setBusy(btn, true);
      try {
        await api('POST', 'setup', formData(e.target));
        $('setupError').textContent = '';
        show('loginPage');
        toast('Usuario creador creado. Ahora ingresa.');
      } catch (err) {
        $('setupError').textContent = err.message;
      } finally {
        setBusy(btn, false);
      }
    });

    $('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      setBusy(btn, true);
      try {
        const r = await api('POST', 'login', {
          email: $('loginEmail').value,
          password: $('loginPassword').value,
        });
        localStorage.setItem(TOKEN_KEY, r.token);
        me = r.user;
        $('loginError').textContent = '';
        $('loginPassword').value = '';
        await enterApp();
      } catch (err) {
        $('loginError').textContent = err.message;
      } finally {
        setBusy(btn, false);
      }
    });

    $('logoutBtn').addEventListener('click', () => {
      if (confirm('¿Cerrar sesión para ingresar con otro usuario?')) logout(false);
    });

    // Check-in
    $('ciSearch').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => searchCheckin().catch((e) => toast(e.message, false)), 250);
    });
    $('ciResults').addEventListener('click', (e) => {
      const row = e.target.closest('.result-row');
      if (row) showClientCheckin(row.dataset.id).catch((err) => toast(err.message, false));
    });
    $('openEntries').addEventListener('click', async (e) => {
      const id = e.target.dataset.out;
      if (!id) return;
      try {
        const r = await api('POST', `entries/${encodeURIComponent(id)}/check-out`);
        toast(`Salida registrada: ${r.entry.minutes} min`);
        loadOpenEntries();
      } catch (err) {
        toast(err.message, false);
      }
    });

    // Clientes
    let clientTimer;
    $('clientSearch').addEventListener('input', () => {
      clearTimeout(clientTimer);
      clientTimer = setTimeout(() => loadClients().catch((e) => toast(e.message, false)), 250);
    });
    $('newClientBtn').addEventListener('click', () => openModal(clientFormHtml()));
    $('clientsBody').addEventListener('click', (e) => {
      const detail = e.target.dataset.detail;
      const edit = e.target.dataset.edit;
      if (detail) clientDetail(detail).catch((err) => toast(err.message, false));
      if (edit) {
        api('GET', 'clients/' + encodeURIComponent(edit))
          .then(({ client }) => openModal(clientFormHtml(client)))
          .catch((err) => toast(err.message, false));
      }
    });

    // Market: cuadrícula, categorías y búsqueda
    $('mkSearch').addEventListener('input', (e) => { marketSearch = e.target.value; renderMarket(); });
    $('mkCats').addEventListener('click', (e) => {
      const c = e.target.closest('[data-cat]');
      if (!c) return;
      marketCat = c.dataset.cat;
      renderMarket();
    });
    $('mkGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]');
      if (b && !b.disabled) addToCart(b.dataset.add);
    });

    // Market: carrito y cliente
    $('cartItems').addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset.inc !== undefined) changeQty(Number(t.dataset.inc), 1);
      else if (t.dataset.dec !== undefined) changeQty(Number(t.dataset.dec), -1);
      else if (t.dataset.remove !== undefined) { cart.splice(Number(t.dataset.remove), 1); renderCart(); }
    });
    let posClientTimer;
    $('posClientSearch').addEventListener('input', () => {
      clearTimeout(posClientTimer);
      posClientTimer = setTimeout(() => searchPosClient().catch((e) => toast(e.message, false)), 250);
    });
    $('posClientResults').addEventListener('click', (e) => {
      const row = e.target.closest('[data-pick]');
      if (row) pickPosClient(row.dataset.pick).catch((err) => toast(err.message, false));
    });
    $('posClientInfo').addEventListener('click', (e) => {
      if (e.target.dataset.clearClient !== undefined) { posClient = null; renderCart(); }
    });
    $('posMethod').addEventListener('change', renderCart);
    $('posCharge').addEventListener('click', (e) => chargeSale(e.currentTarget));
    $('posClear').addEventListener('click', () => {
      cart = [];
      posClient = null;
      renderCart();
    });

    // Inventario (administración de productos)
    $('newProductBtn').addEventListener('click', () => openModal(productFormHtml()));
    $('productsBody').addEventListener('click', (e) => {
      const restock = e.target.dataset.restock;
      const edit = e.target.dataset.editProduct;
      if (restock) {
        const p = products.find((x) => x.id === restock);
        openModal(`
          <div class="modal-header">+ Stock: ${esc(p.name)}</div>
          <form id="restockForm">
            <div class="form-row">
              <div class="form-group"><label>Cantidad que ingresa:</label><input name="qty" type="number" min="1" required></div>
            </div>
            <div class="error" id="restockError"></div>
            <div class="btn-group">
              <button class="btn btn-primary" type="submit">✓ Registrar</button>
              <button class="btn btn-secondary" type="button" data-close>Cancelar</button>
            </div>
          </form>`);
        $('restockForm').dataset.id = restock;
      }
      if (edit) openModal(productFormHtml(products.find((x) => x.id === edit)));
    });

    // Reportes
    $('repLoad').addEventListener('click', () => loadReport().catch((e) => toast(e.message, false)));
    $('repPeriod').addEventListener('change', () => loadReport().catch((e) => toast(e.message, false)));

    // Configuración
    $('settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      setBusy(btn, true);
      try {
        await api('PUT', 'settings', formData(e.target));
        toast('Datos guardados');
      } catch (err) {
        toast(err.message, false);
      } finally {
        setBusy(btn, false);
      }
    });
    $('plansBody').addEventListener('click', (e) => {
      const id = e.target.dataset.editPlan;
      if (id) openModal(planFormHtml(plans.find((p) => p.id === id)));
    });
    $('newUserBtn').addEventListener('click', () => openModal(userFormHtml()));
    $('usersBody').addEventListener('click', async (e) => {
      const editId = e.target.dataset.editUser;
      const delId = e.target.dataset.delUser;
      if (editId) {
        const u = users.find((x) => x.id === editId);
        if (u) openModal(userEditFormHtml(u));
        return;
      }
      if (!delId || !confirm('¿Eliminar este usuario? Ya no podrá ingresar.')) return;
      try {
        await api('DELETE', 'users/' + encodeURIComponent(delId));
        toast('Usuario eliminado');
        loadConfig();
      } catch (err) {
        toast(err.message, false);
      }
    });

    // Modales: delegación para formularios, selector de iconos y cierre
    $('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal' || e.target.dataset.close !== undefined) closeModal();
    });
    $('modalBox').addEventListener('click', (e) => {
      const icon = e.target.closest('[data-icon]');
      if (!icon) return;
      const form = icon.closest('form');
      form.querySelector('input[name="icon"]').value = icon.dataset.icon;
      form.querySelectorAll('.icon-opt').forEach((b) => b.classList.toggle('sel', b === icon));
    });
    // Muestra el campo de código de Yappy solo cuando ese es el método elegido.
    $('modalBox').addEventListener('change', (e) => {
      if (e.target.name !== 'method') return;
      const box = e.target.closest('form').querySelector('.ref-box');
      if (box) box.style.display = e.target.value === 'yapi' ? '' : 'none';
    });
    $('modalBox').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = e.submitter;
      const data = formData(form);
      setBusy(btn, true);
      try {
        if (form.id === 'clientForm') {
          const path = form.dataset.id ? 'clients/' + encodeURIComponent(form.dataset.id) : 'clients';
          const saved = await api(form.dataset.id ? 'PUT' : 'POST', path, data);
          toast('Cliente guardado');
          closeModal();
          loadClients();
          // Un cliente nuevo pasa directo a su ficha para cobrarle la membresía.
          if (!form.dataset.id && saved.client?.id) {
            clientDetail(saved.client.id).catch((err) => toast(err.message, false));
          }
        } else if (form.id === 'productForm') {
          if (form.dataset.id) {
            await api('PUT', 'products/' + encodeURIComponent(form.dataset.id), data);
            toast('Producto actualizado');
          } else {
            await api('POST', 'products', data);
            toast('Producto creado');
          }
          closeModal();
          loadProducts();
        } else if (form.id === 'restockForm') {
          await api('POST', `products/${encodeURIComponent(form.dataset.id)}/restock`, { qty: data.qty });
          toast('Stock actualizado');
          closeModal();
          loadProducts();
        } else if (form.id === 'memberForm') {
          const r = await api('POST', 'memberships', {
            client_id: form.dataset.id,
            plan_id: data.plan_id,
            method: data.method,
            reference: data.reference,
          });
          toast(`Membresía activa hasta ${fmtDate(r.membership.end_date)}`);
          await clientDetail(form.dataset.id);
          loadClients().catch(() => {});
        } else if (form.id === 'abonoForm') {
          await api('POST', 'clients/' + encodeURIComponent(form.dataset.id) + '/abonos', {
            amount: data.amount,
            method: data.method,
          });
          toast('Abono registrado');
          await clientDetail(form.dataset.id);
          loadClients().catch(() => {});
        } else if (form.id === 'planForm') {
          await api('PUT', 'plans/' + encodeURIComponent(form.dataset.id), data);
          toast('Plan actualizado');
          closeModal();
          plans = (await api('GET', 'plans')).plans;
          loadConfig();
        } else if (form.id === 'userForm') {
          await api('POST', 'users', data);
          toast('Usuario creado');
          closeModal();
          loadConfig();
        } else if (form.id === 'userEditForm') {
          const payload = { name: data.name };
          if (data.role !== undefined) payload.role = data.role;
          if (data.active !== undefined) payload.active = data.active === '1';
          if (data.password) payload.password = data.password;
          const id = form.dataset.id;
          await api('PUT', 'users/' + encodeURIComponent(id), payload);
          toast('Usuario actualizado');
          closeModal();
          if (id === me.id) await refreshMe();
          loadConfig();
        }
      } catch (err) {
        const errEl = form.querySelector('.error');
        if (errEl) errEl.textContent = err.message;
        else toast(err.message, false);
      } finally {
        setBusy(btn, false);
      }
    });
  }

  bindEvents();
  boot();
})();
