// Mission Fit - frontend conectado a la API (/api/*).
(() => {
  'use strict';

  const TOKEN_KEY = 'mf_token';
  const RANK = { user: 1, admin: 2, creator: 3 };
  const ROLE_LABEL = { creator: '👑 Creador', admin: '📊 Administrador', user: '👤 Recepción' };
  const METHOD_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', yapi: 'Yapi' };
  const STATUS = {
    activa: ['Activa', 'badge-success'],
    por_vencer: ['Por vencer', 'badge-warning'],
    vencida: ['Vencida', 'badge-danger'],
    sin_membresia: ['Sin membresía', 'badge-muted'],
  };
  const MENU = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard', min: 'admin', title: ['📊 Dashboard', 'Resumen general del gimnasio'] },
    { id: 'checkin', icon: '📱', label: 'Check-in', min: 'user', title: ['📱 Check-in', 'Registra entradas y renovaciones'] },
    { id: 'clientes', icon: '👥', label: 'Clientes', min: 'user', title: ['👥 Clientes', 'Directorio y estado de membresías'] },
    { id: 'inventario', icon: '📦', label: 'Inventario', min: 'user', title: ['📦 Inventario y ventas', 'Productos, stock y venta rápida'] },
    { id: 'reportes', icon: '📈', label: 'Reportes', min: 'admin', title: ['📈 Reportes', 'Ingresos, entradas y ventas'] },
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

  let me = null;
  let plans = [];
  let products = [];
  let cart = [];
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
    show('loginPage');
  }

  async function enterApp() {
    $('userName').textContent = me.name;
    $('userRole').textContent = ROLE_LABEL[me.role];
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
    const canEnter = client.membership_status === 'activa' || client.membership_status === 'por_vencer';
    $('ciDetail').style.display = 'block';
    $('ciDetail').innerHTML = `
      <div class="flex-between">
        <div>
          <div class="detail-title">${esc(client.full_name)}</div>
          <div class="muted">Cédula ${esc(client.cedula || '–')} · Tel. ${esc(client.phone || '–')}</div>
        </div>
        ${badge(client.membership_status)}
      </div>
      <div class="detail-meta">
        Plan: <strong>${esc(client.membership_plan || '—')}</strong> · vence: <strong>${fmtDate(client.membership_end)}</strong>
      </div>
      <div class="btn-group">
        <button class="btn btn-success" id="ciEnter" ${canEnter ? '' : 'disabled'}>✓ Registrar entrada</button>
      </div>
      ${canEnter ? '' : '<p class="muted" style="margin-top:8px;">Para entrar, primero debe renovar o pagar el día.</p>'}
      <hr class="detail-divider">
      <div class="card-title" style="margin-bottom:12px;">💳 Cobrar membresía</div>
      <div class="form-row">
        <div class="form-group"><label>Plan:</label>
          <select id="renewPlan">${plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.price)}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Método:</label>
          <select id="renewMethod">${Object.entries(METHOD_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </div>
      </div>
      <div class="btn-group"><button class="btn btn-primary" id="renewBtn">💳 Cobrar y activar</button></div>
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

    $('renewBtn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true);
      try {
        const r = await api('POST', 'memberships', {
          client_id: client.id,
          plan_id: $('renewPlan').value,
          method: $('renewMethod').value,
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

  async function clientDetail(id) {
    const { client, memberships, payments, entries } = await api('GET', 'clients/' + encodeURIComponent(id));
    openModal(`
      <button class="modal-close" data-close>✕</button>
      <div class="modal-header">${esc(client.full_name)}</div>
      <p class="muted">Cédula ${esc(client.cedula || '–')} · Tel. ${esc(client.phone || '–')} · ${esc(client.email || '')}</p>
      <p style="margin-top:8px;">Estado: ${badge(client.membership_status)} · Plan: <strong>${esc(client.membership_plan || '—')}</strong> · Vence: <strong>${fmtDate(client.membership_end)}</strong></p>
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
  // Inventario y venta rápida
  // -------------------------------------------------------------------------

  async function loadProducts() {
    const r = await api('GET', 'products');
    products = r.products;
    $('newProductBtn').style.display = can('admin') ? '' : 'none';

    $('productsBody').innerHTML = products.map((p) => {
      const low = p.stock <= p.min_stock;
      return `<tr>
        <td><strong>${esc(p.name)}</strong></td>
        <td>${p.stock}</td>
        <td>${money(p.price)}</td>
        <td>${low ? '<span class="badge badge-warning">Bajo stock</span>' : '<span class="badge badge-success">OK</span>'}</td>
        <td class="row-actions">
          ${can('admin') ? `<button class="btn btn-secondary btn-small" data-restock="${esc(p.id)}">+ Stock</button>
          <button class="btn btn-secondary btn-small" data-edit-product="${esc(p.id)}">Editar</button>` : ''}
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">Aún no hay productos.</td></tr>';

    const sellable = products.filter((p) => p.stock > 0);
    $('posProduct').innerHTML = sellable.length
      ? sellable.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.price)} (stock ${p.stock})</option>`).join('')
      : '<option value="">Sin productos disponibles</option>';
    renderCart();
  }

  function renderCart() {
    $('cartBody').innerHTML = cart.map((c, i) => `
      <tr>
        <td>${esc(c.name)}</td>
        <td>${c.qty}</td>
        <td>${money(c.qty * c.price)}</td>
        <td class="row-actions"><button class="btn btn-danger btn-small" data-remove="${i}">Quitar</button></td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Carrito vacío.</td></tr>';
    const total = cart.reduce((s, c) => s + c.qty * c.price, 0);
    $('cartTotal').textContent = money(total);
  }

  function addToCart() {
    const id = $('posProduct').value;
    const qty = parseInt($('posQty').value, 10);
    const p = products.find((x) => x.id === id);
    if (!p) return toast('Selecciona un producto', false);
    if (!(qty >= 1)) return toast('Cantidad inválida', false);
    const inCart = cart.find((c) => c.product_id === id);
    const newQty = (inCart?.qty || 0) + qty;
    if (newQty > p.stock) return toast(`Solo hay ${p.stock} de ${p.name}`, false);
    if (inCart) inCart.qty = newQty;
    else cart.push({ product_id: id, name: p.name, price: p.price, qty });
    $('posQty').value = 1;
    renderCart();
  }

  async function chargeSale(btn) {
    if (!cart.length) return toast('Agrega productos al carrito', false);
    setBusy(btn, true);
    try {
      const r = await api('POST', 'sales', {
        items: cart.map((c) => ({ product_id: c.product_id, qty: c.qty })),
        method: $('posMethod').value,
      });
      cart = [];
      renderCart();
      toast(`✓ Venta cobrada: ${money(r.sale.total)}`);
      loadProducts();
    } catch (err) {
      toast(err.message, false);
    } finally {
      setBusy(btn, false);
    }
  }

  function productFormHtml(p = {}) {
    const isEdit = !!p.id;
    return `
      <div class="modal-header">${isEdit ? '✏️ Editar producto' : '➕ Nuevo producto'}</div>
      <form id="productForm" data-id="${esc(p.id || '')}">
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nombre:</label><input name="name" required value="${esc(p.name ?? '')}"></div></div>
        <div class="form-row">
          <div class="form-group"><label>Precio:</label><input name="price" type="number" step="0.01" min="0" required value="${p.price ?? ''}"></div>
          <div class="form-group"><label>Stock mínimo:</label><input name="min_stock" type="number" min="0" value="${p.min_stock ?? 5}"></div>
        </div>
        ${isEdit ? '' : '<div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Stock inicial:</label><input name="stock" type="number" min="0" value="0"></div></div>'}
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

    $('repDaysBody').innerHTML = r.days.map((d) => `
      <tr><td>${fmtDate(d.day)}</td><td>${d.entries}</td><td>${money(d.income)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">Sin movimientos en este período.</td></tr>';

    $('repMethodBody').innerHTML = Object.entries(r.by_method).map(([m, v]) => (
      `<tr><td>${METHOD_LABEL[m]}</td><td>${money(v)}</td></tr>`
    )).join('');

    $('repProductsBody').innerHTML = r.products.map((p) => (
      `<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>${money(p.total)}</td></tr>`
    )).join('') || '<tr><td colspan="3" class="muted">Sin ventas de productos.</td></tr>';
  }

  // -------------------------------------------------------------------------
  // Configuración
  // -------------------------------------------------------------------------

  async function loadConfig() {
    const [{ settings }, { users }] = await Promise.all([api('GET', 'settings'), api('GET', 'users')]);
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
    $('usersBody').innerHTML = users.map((u) => `
      <tr>
        <td>${esc(u.name)}</td>
        <td>${esc(u.email)}</td>
        <td>${esc(ROLE_LABEL[u.role])}</td>
        <td class="row-actions">${me.role === 'creator' && u.id !== me.id ? `<button class="btn btn-danger btn-small" data-del-user="${esc(u.id)}">Eliminar</button>` : ''}</td>
      </tr>`).join('');
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

  function userFormHtml() {
    const roles = me.role === 'creator'
      ? [['creator', '👑 Creador'], ['admin', '📊 Administrador'], ['user', '👤 Recepción']]
      : [['admin', '📊 Administrador'], ['user', '👤 Recepción']];
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
      if (confirm('¿Cerrar sesión?')) logout(false);
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

    // Inventario
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
            <div class="btn-group">
              <button class="btn btn-primary" type="submit">✓ Registrar</button>
              <button class="btn btn-secondary" type="button" data-close>Cancelar</button>
            </div>
          </form>`);
        $('restockForm').dataset.id = restock;
      }
      if (edit) openModal(productFormHtml(products.find((x) => x.id === edit)));
    });
    $('posAdd').addEventListener('click', addToCart);
    $('cartBody').addEventListener('click', (e) => {
      const i = e.target.dataset.remove;
      if (i !== undefined) { cart.splice(Number(i), 1); renderCart(); }
    });
    $('posCharge').addEventListener('click', (e) => chargeSale(e.currentTarget));

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
      const id = e.target.dataset.delUser;
      if (!id || !confirm('¿Eliminar este usuario? Ya no podrá ingresar.')) return;
      try {
        await api('DELETE', 'users/' + encodeURIComponent(id));
        toast('Usuario eliminado');
        loadConfig();
      } catch (err) {
        toast(err.message, false);
      }
    });

    // Modales: delegación para formularios y cierre
    $('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal' || e.target.dataset.close !== undefined) closeModal();
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
          await api(form.dataset.id ? 'PUT' : 'POST', path, data);
          toast('Cliente guardado');
          closeModal();
          loadClients();
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
