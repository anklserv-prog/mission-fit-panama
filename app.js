// Mission Fit - frontend conectado a la API (/api/*).
(() => {
  'use strict';

  const TOKEN_KEY = 'mf_token';
  const RANK = { user: 1, admin: 2, creator: 3 };
  const ROLE_LABEL = { creator: 'Creador', admin: 'Administrador', user: 'Recepción' };
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
  // icon: id del símbolo SVG en index.html. short: texto de la barra inferior en celular.
  const MENU = [
    { id: 'dashboard', icon: 'home', label: 'Dashboard', min: 'admin', title: ['Dashboard', 'Resumen general del gimnasio'] },
    { id: 'checkin', icon: 'scan', label: 'Check-in', min: 'user', title: ['Check-in', 'Registra entradas y renovaciones'] },
    { id: 'clientes', icon: 'users', label: 'Clientes', min: 'user', title: ['Clientes', 'Directorio, estado de membresías y cuenta'] },
    { id: 'inventario', icon: 'cart', label: 'Market', min: 'user', title: ['Market', 'Productos, venta rápida e inventario'] },
    { id: 'reportes', icon: 'chart', label: 'Reportes', min: 'admin', title: ['Reportes', 'Ingresos, entradas, ventas y cuentas'] },
    { id: 'config', icon: 'sliders', label: 'Configuración', short: 'Ajustes', min: 'admin', title: ['Configuración', 'Datos del gimnasio, planes y usuarios'] },
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const money = (n) => '$' + Number(n || 0).toFixed(2);
  // Icono SVG del sprite de index.html.
  const ico = (name, cls = '') => `<svg class="ico${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  // Cuadro de estado con icono (ok, warn, off, info).
  const stateBox = (kind, icon, html) => `<div class="status-box has-ico ${kind}">${ico(icon)}<div>${html}</div></div>`;
  // Dato con icono pequeño (cédula, teléfono, email).
  const attr = (icon, text) => `<span class="attr">${ico(icon)}<span>${esc(text)}</span></span>`;
  const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2)
    .map((w) => w.charAt(0)).join('').toUpperCase() || '–';
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
  // Teléfono para WhatsApp: 507 + 8 dígitos.
  const waNumber = (phone) => {
    const d = String(phone || '').replace(/\D/g, '');
    return d.length === 8 ? '507' + d : d;
  };
  // Hora (Panamá) a partir de una fecha guardada por SQLite en UTC.
  const timeSql = (s) => (s
    ? new Date(String(s).replace(' ', 'T') + 'Z').toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Panama' })
    : '');
  // Rango del período elegido en Reportes.
  const periodRange = () => {
    const today = panamaToday();
    const p = $('repPeriod') ? $('repPeriod').value : 'today';
    return { from: p === 'today' ? today : p === 'week' ? addDays(today, -6) : today.slice(0, 8) + '01', to: today };
  };
  // QR del código del cliente (librería local: funciona sin internet).
  const qrDataUrl = (text, cell = 6) => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(cell, 2);
  };
  const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
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
  let newClientFrom = null; // 'checkin' cuando el cliente nuevo se crea desde el check-in

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

  // Tarjeta de confirmación del escaneo: no se cierra tocando fuera; solo con su botón o la ✕.
  let scanCardOpen = false;
  function openModal(html) {
    $('modalBox').innerHTML = html;
    $('modal').classList.add('active');
  }
  function closeModal() {
    stopScanner();
    scanCardOpen = false;
    $('modal').classList.remove('active');
    $('modalBox').innerHTML = '';
    $('modalBox').style.maxWidth = '';
  }
  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }
  function setBusy(btn, busy, label) {
    if (!btn) return;
    btn.disabled = busy;
    if (busy) { btn.dataset.label = btn.innerHTML; btn.textContent = 'Guardando…'; }
    else if (btn.dataset.label) btn.innerHTML = label || btn.dataset.label;
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
    $('userAvatar').textContent = initials(me.name);
    $('headerAvatar').textContent = initials(me.name);
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
      li.innerHTML = `<span class="nav-icon">${ico(m.icon)}</span><span class="nav-label">${m.label}</span><span class="nav-short">${m.short || m.label}</span>`;
      li.title = m.label;
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

  // Check-in con dos pestañas: Miembro (membresía) y Uso diario (cobro del día, sin membresía).
  let checkinClient = null;
  let checkinMode = 'miembro';

  const isDailyPlanName = (name) => plans.some((p) => p.name === name && p.duration_days === 1);
  const dailyPlan = () => plans.find((p) => p.duration_days === 1);
  const methodSelectOptions = () => Object.entries(METHOD_LABEL)
    .filter(([v]) => v !== 'cuenta')
    .map(([v, l]) => `<option value="${v}">${v === 'yapi' ? 'Yappy' : l}</option>`).join('');

  let checkinOpen = null; // entrada abierta del cliente mostrado (si está dentro)

  async function showClientCheckin(id) {
    const [{ client }, { entries }] = await Promise.all([
      api('GET', 'clients/' + encodeURIComponent(id)),
      api('GET', 'entries/open'),
    ]);
    checkinClient = client;
    checkinOpen = entries.find((en) => en.client_id === client.id) || null;
    const paidDailyToday = isDailyPlanName(client.membership_plan)
      && (client.membership_status === 'activa' || client.membership_status === 'por_vencer');
    checkinMode = paidDailyToday ? 'diario' : 'miembro';
    renderCheckin();
    $('ciDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Si la tarjeta de check-in muestra la entrada que acaba de cerrarse (desde la lista o el modal),
  // se vuelve a cargar para que no quede el botón "Registrar salida" ni el estado "dentro" viejos.
  function refreshCheckinIfShowing(entryId) {
    if (checkinClient && checkinOpen && checkinOpen.id === entryId) {
      showClientCheckin(checkinClient.id).catch(() => {});
    }
  }

  function renderCheckin() {
    const client = checkinClient;
    const st = client.membership_status;
    const active = st === 'activa' || st === 'por_vencer';
    const daily = isDailyPlanName(client.membership_plan);
    const memberActive = active && !daily;
    const tabs = `
      <div class="mode-tabs">
        <button class="mode-tab ${checkinMode === 'miembro' ? 'active' : ''}" data-mode="miembro">${ico('card')}Membresía</button>
        <button class="mode-tab ${checkinMode === 'diario' ? 'active' : ''}" data-mode="diario">${ico('ticket')}Diario</button>
      </div>`;
    const header = `
      <div class="flex-between">
        <div class="detail-head">
          <span class="avatar avatar-lg">${esc(initials(client.full_name))}</span>
          <div>
            <div class="detail-title">${esc(client.full_name)}</div>
            <div class="attr-list">${attr('idcard', client.cedula || '–')}${attr('phone', client.phone || '–')}</div>
          </div>
        </div>
        ${badge(st)}
      </div>`;

    $('ciDetail').style.display = 'block';
    const mins = checkinOpen ? Math.round((Date.now() - checkinOpen.check_in_at) / 60000) : 0;
    const insideBox = `
      ${stateBox('ok', 'dumbbell', `<strong>Ya está dentro del gimnasio</strong> desde ${checkinOpen ? timeOf(checkinOpen.check_in_at) : ''} · ${mins} min`)}
      <div class="btn-group"><button class="btn btn-danger" id="ciExit">${ico('logout')}Registrar salida</button></div>`;
    $('ciDetail').innerHTML = header + tabs + (checkinOpen ? insideBox
      : (checkinMode === 'miembro'
        ? miembroPanel(client, st, active, daily, memberActive)
        : diarioPanel(client, active, daily, memberActive)));
    bindCheckinPanel();
  }

  function miembroPanel(client, st, active, daily, memberActive) {
    const endTxt = fmtDate(client.membership_end);
    // Estado de la membresía: cada caso se ve distinto para no confundir a recepción.
    const statusBox = daily && active
      ? stateBox('ok', 'ticket', '<strong>Uso diario pagado hoy</strong>. Puede entrar.')
      : ({
        activa: stateBox('ok', 'check-circle', `<strong>Membresía activa</strong> hasta el ${endTxt}${client.membership_plan ? ` · ${esc(client.membership_plan)}` : ''}`),
        por_vencer: stateBox('warn', 'clock', `<strong>Membresía por vencer</strong>: vence el ${endTxt}. Renueva para seguir entrando.`),
        vencida: stateBox('off', 'ban', `<strong>Membresía vencida</strong> desde el ${endTxt}. No puede entrar hasta renovar.`),
        sin_membresia: stateBox('off', 'ban', '<strong>Sin membresía</strong>. Debe cobrar una membresía para entrar.'),
      }[st] || '');

    const planOptions = plans.filter((p) => p.duration_days !== 1)
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.price)}</option>`).join('');
    const renewLabel = active ? `${ico('refresh')}Renovar` : `${ico('card')}Cobrar y activar`;
    const renewForm = `
      <div class="form-row">
        <div class="form-group"><label>Plan</label><select id="renewPlan">${planOptions}</select></div>
        <div class="form-group"><label>Método</label><select id="renewMethod">${methodSelectOptions()}</select></div>
      </div>
      <div class="form-row ref-box" id="renewRefBox" style="display:none;">
        <div class="form-group" style="grid-column:1 / -1;"><label>Código de transacción de Yappy</label><input id="renewRef" class="wide-input" autocomplete="off" placeholder="Ej: 1A2B3C4D"></div>
      </div>
      <div class="btn-group"><button class="btn btn-primary" id="renewBtn">${renewLabel}</button></div>`;

    let renewSection;
    if (memberActive && st === 'activa') {
      renewSection = `<details class="renew-details"><summary>${ico('refresh')} Renovar por adelantado ${ico('chevron-down', 'caret')}</summary>${renewForm}</details>`;
    } else if (memberActive) {
      renewSection = `<div class="section-title">${ico('refresh')} Renovar membresía</div>${renewForm}`;
    } else {
      renewSection = `<div class="section-title">${ico('card')} Cobrar membresía</div>${renewForm}`;
    }

    return `
      ${statusBox}
      <div class="btn-group">
        <button class="btn btn-success btn-lg" id="ciEnter" ${active ? '' : 'disabled'}>${ico('check')}Registrar entrada</button>
      </div>
      ${active ? '' : '<p class="muted" style="margin-top:8px;">Para entrar, primero debe cobrar la membresía o el uso diario.</p>'}
      <hr class="detail-divider">
      ${renewSection}`;
  }

  function diarioPanel(client, active, daily, memberActive) {
    if (memberActive) {
      return stateBox('warn', 'info', '<strong>Tiene membresía activa</strong>. El uso diario no aplica; el ingreso se registra desde la pestaña Membresía.');
    }
    if (daily && active) {
      return `
        <div class="btn-group" style="margin-top:12px;"><button class="btn btn-success btn-lg" id="ciEnter">${ico('check')}Registrar entrada</button></div>`;
    }
    const dp = dailyPlan();
    return `
      ${stateBox('info', 'ticket', `<strong>Uso diario</strong>: cobra el día${dp ? ` (${money(dp.price)})` : ''} y registra la entrada.`)}
      <div class="form-row" style="margin-top:12px;">
        <div class="form-group"><label>Método</label><select id="dailyMethod">${methodSelectOptions()}</select></div>
      </div>
      <div class="form-row ref-box" id="dailyRefBox" style="display:none;">
        <div class="form-group" style="grid-column:1 / -1;"><label>Código de transacción de Yappy</label><input id="dailyRef" class="wide-input" autocomplete="off" placeholder="Ej: 1A2B3C4D"></div>
      </div>
      <div class="btn-group"><button class="btn btn-primary" id="dailyBtn" ${dp ? '' : 'disabled'}>${ico('ticket')}Cobrar y registrar entrada</button></div>`;
  }

  function bindCheckinPanel() {
    const client = checkinClient;

    $('ciExit')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true);
      try {
        const r = await api('POST', `entries/${encodeURIComponent(checkinOpen.id)}/check-out`);
        toast(`Salida registrada: ${client.full_name} (${r.entry.minutes} min)`);
        loadOpenEntries();
        showClientCheckin(client.id);
      } catch (err) {
        toast(err.message, false);
        // 409: la entrada ya tiene salida (se dio desde la lista). Se refresca la tarjeta.
        if (err.status === 409) showClientCheckin(client.id).catch(() => {});
      } finally {
        setBusy(btn, false);
      }
    });

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

    $('renewMethod')?.addEventListener('change', () => {
      $('renewRefBox').style.display = $('renewMethod').value === 'yapi' ? '' : 'none';
    });
    $('renewBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if ($('renewMethod').value === 'yapi' && !$('renewRef').value.trim()) {
        toast('Ingresa el código de transacción de Yappy antes de cobrar', false);
        $('renewRef').focus();
        return;
      }
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

    $('dailyMethod')?.addEventListener('change', () => {
      $('dailyRefBox').style.display = $('dailyMethod').value === 'yapi' ? '' : 'none';
    });
    $('dailyBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      // Yappy sin código: no se cobra ni se registra la entrada.
      if ($('dailyMethod').value === 'yapi' && !$('dailyRef').value.trim()) {
        toast('Ingresa el código de transacción de Yappy antes de cobrar', false);
        $('dailyRef').focus();
        return;
      }
      setBusy(btn, true);
      try {
        const dp = dailyPlan();
        await api('POST', 'memberships', {
          client_id: client.id,
          plan_id: dp.id,
          method: $('dailyMethod').value,
          reference: $('dailyRef').value,
        });
        await api('POST', 'entries/check-in', { client_id: client.id });
        toast(`✓ Uso diario cobrado y entrada registrada: ${client.full_name}`);
        loadOpenEntries();
        showClientCheckin(client.id);
      } catch (err) {
        toast(err.message, false);
        showClientCheckin(client.id).catch(() => {});
      } finally {
        setBusy(btn, false);
      }
    });
  }

  let openEntriesList = [];

  async function loadOpenEntries() {
    if (currentView !== 'checkin') return;
    const { entries } = await api('GET', 'entries/open');
    openEntriesList = entries;
    if (!entries.length) {
      $('openEntries').innerHTML = '<p class="muted">Nadie dentro en este momento.</p>';
      return;
    }
    $('openEntries').innerHTML = `<div class="inside-list">${
      entries.map((en) => {
        const mins = Math.round((Date.now() - en.check_in_at) / 60000);
        return `<div class="inside-row">
          <button class="inside-info" data-detail="${esc(en.id)}" title="Ver detalle">
            <span class="avatar avatar-sm" aria-hidden="true">${esc(initials(en.full_name))}</span>
            <span class="inside-text"><strong>${esc(en.full_name)}</strong>
            <span class="muted">Entró ${timeOf(en.check_in_at)}</span></span>
          </button>
          <span class="inside-time">${ico('clock')} ${mins} min</span>
          <button class="btn btn-danger btn-small" data-out="${esc(en.id)}">${ico('logout')}Salida</button>
        </div>`;
      }).join('')
    }</div>`;
  }

  // Tarjeta de detalle de una persona dentro del gimnasio.
  async function openInsideCard(en) {
    const [{ client }, { entries: today }] = await Promise.all([
      api('GET', 'clients/' + encodeURIComponent(en.client_id)),
      api('GET', 'entries'),
    ]);
    const visitsToday = today.filter((x) => x.client_id === en.client_id).length;
    const mins = Math.round((Date.now() - en.check_in_at) / 60000);
    openModal(`
      <div class="detail-title">${esc(client.full_name)}</div>
      <div class="muted">Cédula ${esc(client.cedula || '–')} · Tel. ${esc(client.phone || '–')}</div>
      <div class="inside-card">
        <div class="inside-stat"><span class="muted">Hora de entrada</span><strong>${timeOf(en.check_in_at)}</strong></div>
        <div class="inside-stat"><span class="muted">Tiempo adentro</span><strong>${mins} min</strong></div>
        <div class="inside-stat"><span class="muted">Entradas hoy</span><strong>${visitsToday}</strong></div>
        <div class="inside-stat"><span class="muted">Membresía</span><strong>${esc(client.membership_plan || 'Sin plan')}</strong></div>
        <div class="inside-stat"><span class="muted">Estado</span>${badge(client.membership_status)}</div>
        <div class="inside-stat"><span class="muted">Vence</span><strong>${client.membership_end ? fmtDate(client.membership_end) : '–'}</strong></div>
      </div>
      <div class="btn-group">
        <button class="btn btn-danger" data-out-modal="${esc(en.id)}">${ico('logout')}Registrar salida</button>
        <button class="btn btn-secondary" data-close-modal>Cerrar</button>
      </div>`);
  }

  // -------------------------------------------------------------------------
  // Clientes
  // -------------------------------------------------------------------------

  async function loadClients() {
    const q = $('clientSearch').value.trim();
    const { clients } = await api('GET', 'clients?q=' + encodeURIComponent(q));
    $('clientsBody').innerHTML = clients.map((c) => `
      <tr class="st-${esc(c.membership_status)}">
        <td class="c-name"><span class="avatar avatar-sm cell-ico" aria-hidden="true">${esc(initials(c.full_name))}</span><strong>${esc(c.full_name)}</strong></td>
        <td class="c-ced">${ico('idcard', 'cell-ico')}${esc(c.cedula || '–')}</td>
        <td class="c-phone">${ico('phone', 'cell-ico')}${esc(c.phone || '–')}</td>
        <td class="c-plan">${esc(c.membership_plan || '—')}</td>
        <td class="c-end">${ico('calendar', 'cell-ico')}<span class="cell-label">Vence</span>${fmtDate(c.membership_end)}</td>
        <td class="c-status">${badge(c.membership_status)}</td>
        <td class="row-actions c-actions">
          <button class="btn btn-secondary btn-small" data-detail="${esc(c.id)}">${ico('eye')}Ver</button>
          ${can('admin') ? `<button class="btn btn-secondary btn-small" data-edit="${esc(c.id)}">${ico('edit')}Editar</button>` : ''}
        </td>
      </tr>`).join('') || '<tr class="empty-row"><td colspan="7" class="muted">Sin clientes que mostrar.</td></tr>';
  }

  function clientFormHtml(c = {}) {
    const v = (k) => esc(c[k] ?? '');
    return `
      <button class="modal-close" type="button" data-close aria-label="Cerrar">${ico('x')}</button>
      <div class="modal-header">${c.id ? 'Editar cliente' : 'Nuevo cliente'}</div>
      <form id="clientForm" data-id="${esc(c.id || '')}">
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nombre completo</label><input name="full_name" required value="${v('full_name')}"></div></div>
        <div class="form-row">
          <div class="form-group"><label>Cédula</label><input name="cedula" value="${v('cedula')}"></div>
          <div class="form-group"><label>Teléfono (WhatsApp)</label><input name="phone" type="tel" required placeholder="6789-0123" value="${v('phone')}"><span class="muted">Obligatorio. Se usa para enviar la tarjeta.</span></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Email</label><input name="email" type="email" value="${v('email')}"></div>
          <div class="form-group"><label>Fecha de nacimiento</label><input name="birth_date" type="date" value="${v('birth_date')}"></div>
        </div>
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Notas</label><input name="notes" value="${v('notes')}"></div></div>
        <div class="error" id="clientError"></div>
        <div class="btn-group">
          <button class="btn btn-primary" type="submit">${ico('check')}Guardar</button>
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
          <div class="form-group"><label>Plan</label><select name="plan_id">${plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.price)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Método</label><select name="method">${methodOptions}</select></div>
        </div>
        <div class="form-row ref-box" style="display:none;">
          <div class="form-group" style="grid-column:1 / -1;"><label>Código de transacción de Yappy</label><input name="reference" class="wide-input" autocomplete="off" placeholder="Ej: 1A2B3C4D"></div>
        </div>
        <div class="error"></div>
        <div class="btn-group"><button class="btn btn-primary" type="submit">${ico('card')}Cobrar membresía</button></div>
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
      <button class="modal-close" type="button" data-close aria-label="Cerrar">${ico('x')}</button>
      <div class="detail-head">
        <span class="avatar avatar-lg">${esc(initials(client.full_name))}</span>
        <div class="modal-header" style="margin:0;">${esc(client.full_name)}</div>
      </div>
      <div class="attr-list attr-list-wrap">${attr('idcard', client.cedula || '–')}${attr('phone', client.phone || '–')}${client.email ? attr('mail', client.email) : ''}</div>
      <div class="member-sum st-${esc(client.membership_status)}">
        <div><span class="member-sum-label">Estado</span>${badge(client.membership_status)}</div>
        <div><span class="member-sum-label">Plan</span><strong>${esc(client.membership_plan || '—')}</strong></div>
        <div><span class="member-sum-label">Vence</span><strong class="member-sum-end">${fmtDate(client.membership_end)}</strong></div>
      </div>
      <hr class="detail-divider">
      <div class="section-title">${ico('mobile')} Portal del socio</div>
      <p class="muted">El socio entra con su cédula y su contraseña para ver su tarjeta y el horario. Al crear o restablecer el acceso se genera una contraseña temporal.</p>
      ${client.cedula ? `<div class="btn-group"><button class="btn btn-secondary btn-small" data-portal-access>${ico('key')}Crear o restablecer acceso</button></div><div id="portalResult"></div>` : '<p class="muted">Agrega la cédula del cliente para darle acceso al portal.</p>'}
      <hr class="detail-divider">
      <div class="section-title">${ico('idcard')} Tarjeta del cliente</div>
      ${client.code ? `
      <div class="client-card-box">
        <img id="qrImg" class="qr-img" alt="QR del cliente">
        <div>
          <div class="muted">Código interno · <span id="cardShareInfo"></span></div>
          <div class="client-code">${esc(client.code)}</div>
          <div class="card-actions">
            <button class="btn btn-secondary btn-small" data-card-download>${ico('download')}Descargar tarjeta</button>
            <button class="btn btn-success btn-small" data-card-share>${ico('send')}Enviar por WhatsApp</button>
            <button class="btn btn-secondary btn-small" data-wa-chat>${ico('message')}Abrir chat</button>
          </div>
        </div>
      </div>` : `
      ${stateBox('warn', 'lock', '<strong>Tarjeta protegida.</strong> Para descargarla, enviarla o verla de nuevo, solicítalo a la administración.')}
      <div class="btn-group"><button class="btn btn-secondary btn-small" data-wa-chat>${ico('message')}Abrir chat</button></div>`}
      ${can('admin') && client.card_open !== 1 ? `<div class="btn-group"><button class="btn btn-secondary btn-small" data-card-open>${ico('unlock')}Permitir un uso a recepción</button></div>` : ''}
      <hr class="detail-divider">
      <div class="section-title">${ico('book')} Cuenta del cliente</div>
      ${stateBox(bal > 0.005 ? 'warn' : 'ok', bal > 0.005 ? 'alert' : 'check-circle', `Saldo pendiente: <strong>${money(bal)}</strong>`)}
      ${bal > 0.005 ? `
      <form id="abonoForm" data-id="${esc(client.id)}" style="margin-top:12px;">
        <div class="form-row">
          <div class="form-group"><label>Monto del abono</label><input name="amount" type="number" step="0.01" min="0.01" max="${bal.toFixed(2)}" required></div>
          <div class="form-group"><label>Método</label><select name="method">${Object.entries(METHOD_LABEL).filter(([v]) => v !== 'cuenta').map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        </div>
        <div class="error" id="abonoError"></div>
        <div class="btn-group"><button class="btn btn-success" type="submit">${ico('check')}Registrar abono</button></div>
      </form>` : ''}
      ${ledger.movements.length ? `<table class="mini-table" style="margin-top:12px;"><thead><tr><th>Día</th><th>Tipo</th><th>Detalle</th><th>Monto</th></tr></thead><tbody>${movRows}</tbody></table>` : '<p class="muted">Sin movimientos de cuenta.</p>'}
      <hr class="detail-divider">
      <div class="section-title">${ico('card')} Cobrar membresía</div>
      ${membershipFormHtml(client.id)}
      <hr class="detail-divider">
      <div class="section-title">${ico('calendar')} Membresías</div>
      ${memberships.length ? `<table class="mini-table"><thead><tr><th>Plan</th><th>Desde</th><th>Hasta</th><th>Monto</th></tr></thead><tbody>${
        memberships.map((m) => `<tr><td>${esc(m.plan_name)}</td><td>${fmtDate(m.start_date)}</td><td>${fmtDate(m.end_date)}</td><td>${money(m.amount)}</td></tr>`).join('')
      }</tbody></table>` : '<p class="muted">Sin membresías.</p>'}
      <div class="section-title" style="margin-top:20px;">${ico('enter')} Últimas entradas</div>
      ${entries.length ? `<table class="mini-table"><thead><tr><th>Día</th><th>Entrada</th><th>Salida</th></tr></thead><tbody>${
        entries.slice(0, 10).map((e) => `<tr><td>${fmtDate(e.day)}</td><td>${timeOf(e.check_in_at)}</td><td>${e.check_out_at ? timeOf(e.check_out_at) : 'Dentro'}</td></tr>`).join('')
      }</tbody></table>` : '<p class="muted">Sin entradas registradas.</p>'}
      <div class="section-title" style="margin-top:20px;">${ico('dollar')} Pagos</div>
      ${payments.length ? `<table class="mini-table"><thead><tr><th>Día</th><th>Método</th><th>Monto</th></tr></thead><tbody>${
        payments.slice(0, 10).map((p) => `<tr><td>${fmtDate(p.day)}</td><td>${METHOD_LABEL[p.method] || esc(p.method)}</td><td>${money(p.amount)}</td></tr>`).join('')
      }</tbody></table>` : '<p class="muted">Sin pagos registrados.</p>'}
    `);
    cardClient = client;
    refreshCardShareInfo();
    if (client.code) $('qrImg').src = qrDataUrl(client.code, 4);
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
    loadSalesToday().catch(() => {});
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
          ${can('admin') ? `<button class="btn btn-secondary btn-small" data-restock="${esc(p.id)}">${ico('plus')}Stock</button>
          <button class="btn btn-secondary btn-small" data-edit-product="${esc(p.id)}">${ico('edit')}Editar</button>` : ''}
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
        <button class="btn-x" data-remove="${i}" title="Quitar producto" aria-label="Quitar producto">${ico('x')}</button>
      </div>`).join('') : '<div class="cart-empty">Toca un producto para agregarlo a la venta.</div>';

    const units = cart.reduce((s, c) => s + c.qty, 0);
    const total = cart.reduce((s, c) => s + c.qty * c.price, 0);
    $('sumItems').textContent = units;
    $('cartTotal').textContent = money(total);
    $('posCharge').disabled = cart.length === 0;

    $('posClientInfo').innerHTML = posClient
      ? `<div class="client-chip ${posClient.balance > 0.005 ? 'debt' : ''}">
           <div><strong>${ico('user')} ${esc(posClient.full_name)}</strong>
             <div class="muted">Saldo pendiente: ${money(posClient.balance)}</div></div>
           ${posClient.balance > 0.005 ? `<button class="btn btn-success btn-small" data-pay-debt>${ico('dollar')}Cobrar saldo</button>` : ''}
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

  // Lista de clientes con scroll: al hacer clic se ve todo; al escribir filtra por nombre, cédula, teléfono o código.
  async function searchPosClient() {
    const q = $('posClientSearch').value.trim();
    const { clients } = await api('GET', 'clients?q=' + encodeURIComponent(q));
    $('posClientResults').innerHTML = clients.map((c) => `
      <div class="result-row" data-pick="${esc(c.id)}">
        <div><strong>${esc(c.full_name)}</strong>
          <div class="muted">${esc(c.cedula || 'Sin cédula')} · ${esc(c.phone || 'Sin teléfono')}</div></div>
        ${badge(c.membership_status)}
      </div>`).join('') || '<p class="muted" style="padding:8px;">Sin resultados.</p>';
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

  // -------------------------------------------------------------------------
  // Excel (.xlsx) sin librerías externas: una hoja con los detalles.
  // -------------------------------------------------------------------------

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (bytes) => {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  function zipStore(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true);
      ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true);
      ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const centralSize = central.reduce((s, a) => s + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true); end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  // Excel con formato: nombre del negocio, título, período, tabla con filtros y fila de totales (SUBTOTAL,
  // así los totales cambian al filtrar en Excel).
  function makeXlsx({ business, title, period, columns, rows, moneyCols = [], sheetName }) {
    const enc = new TextEncoder();
    const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const RS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const x = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
    const colName = (i) => {
      let s = '';
      let n = i + 1;
      while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
      return s;
    };
    // Nombres de columna únicos (Excel exige encabezados distintos en una tabla).
    const seen = {};
    const names = columns.map((c) => {
      const base = String(c);
      seen[base] = (seen[base] || 0) + 1;
      return seen[base] === 1 ? base : `${base} ${seen[base]}`;
    });
    // Fechas ISO (2026-10-23) se muestran como 23/10/2026.
    const fixValue = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v);
    // Estilos (índices en cellXfs, ver styles.xml abajo).
    const ST = { business: 1, title: 2, period: 3, head: 4, text: 5, money: 6, num: 7, totLabel: 8, totMoney: 9, totNum: 10 };
    const nCols = names.length;
    const lastCol = colName(nCols - 1);
    const HEAD_ROW = 4;
    const firstData = HEAD_ROW + 1;
    const lastData = HEAD_ROW + rows.length;
    const hasRows = rows.length > 0;
    const isMoney = (i) => moneyCols.includes(columns[i]);
    const isNum = (i) => hasRows && rows.every((r) => r[i] === null || r[i] === undefined || typeof r[i] === 'number');
    const cellXml = (v, ref, style) => {
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
      if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${style}"/>`;
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${x(fixValue(v))}</t></is></c>`;
    };
    const formulaXml = (ref, style, f) => `<c r="${ref}" s="${style}"><f>${x(f)}</f></c>`;

    // Ancho de columna según el contenido más largo.
    const widths = names.map((n, i) => {
      let max = String(n).length;
      for (const r of rows) max = Math.max(max, String(fixValue(r[i]) ?? '').length + (isMoney(i) ? 2 : 0));
      return Math.min(48, Math.max(12, Math.round(max * 1.1) + 3));
    });
    const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');

    const bizRow = `<row r="1" ht="28" customHeight="1">${cellXml(business, 'A1', ST.business)}</row>`;
    const titleRow = `<row r="2" ht="20" customHeight="1">${cellXml(title, 'A2', ST.title)}</row>`;
    const periodRow = `<row r="3">${cellXml(period, 'A3', ST.period)}</row>`;
    const headRow = `<row r="${HEAD_ROW}" ht="24" customHeight="1">${names.map((n, i) => cellXml(n, colName(i) + HEAD_ROW, ST.head)).join('')}</row>`;
    const dataRows = rows.map((r, k) => {
      const rn = firstData + k;
      return `<row r="${rn}">${r.map((v, i) => {
        const style = isMoney(i) ? ST.money : (isNum(i) ? ST.num : ST.text);
        return cellXml(v, colName(i) + rn, style);
      }).join('')}</row>`;
    }).join('');
    let totals = '';
    if (hasRows) {
      const tRow = lastData + 1;
      const cells = names.map((_, i) => {
        const ref = colName(i) + tRow;
        if (i === 0) return cellXml('Total (visible)', ref, ST.totLabel);
        if (isMoney(i) || isNum(i)) return formulaXml(ref, isMoney(i) ? ST.totMoney : ST.totNum, `SUBTOTAL(109,${colName(i)}${firstData}:${colName(i)}${lastData})`);
        return cellXml('', ref, ST.totLabel);
      }).join('');
      const cRow = tRow + 1;
      totals = `<row r="${tRow}">${cells}</row>` +
        `<row r="${cRow}">${cellXml('Registros visibles', `A${cRow}`, ST.totLabel)}${formulaXml(`B${cRow}`, ST.totNum, `SUBTOTAL(103,A${firstData}:A${lastData})`)}</row>`;
    }
    const merges = [`A1:${lastCol}1`, `A2:${lastCol}2`, `A3:${lastCol}3`];
    const sheetXml = `<worksheet xmlns="${NS}" xmlns:r="${RS}">` +
      `<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${HEAD_ROW}" topLeftCell="A${firstData}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<cols>${cols}</cols>` +
      `<sheetData>${bizRow}${titleRow}${periodRow}${headRow}${dataRows}${totals}</sheetData>` +
      `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` +
      `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
      `<pageSetup orientation="landscape"/>` +
      (hasRows ? `<tableParts count="1"><tablePart r:id="rId1"/></tableParts>` : '') +
      `</worksheet>`;

    const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const tableRef = `A${HEAD_ROW}:${lastCol}${lastData}`;
    const tableXml = `${H}<table xmlns="${NS}" id="1" name="Datos" displayName="Datos" ref="${tableRef}" totalsRowShown="0"><autoFilter ref="${tableRef}"/><tableColumns count="${nCols}">${names.map((n, i) => `<tableColumn id="${i + 1}" name="${x(n)}"/>`).join('')}</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
    const stylesXml = `${H}<styleSheet xmlns="${NS}">` +
      `<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>` +
      `<fonts count="6">` +
      `<font><sz val="11"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="16"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="12"/><color rgb="FF0F172A"/><name val="Calibri"/></font>` +
      `<font><i/><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>` +
      `</fonts>` +
      `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
      `<fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill>` +
      `<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills>` +
      `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
      `<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="11">` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
      `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
      `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
      `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
      `<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` +
      `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>` +
      `<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
      `<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` +
      `<xf numFmtId="164" fontId="5" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>` +
      `<xf numFmtId="1" fontId="5" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>` +
      `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const contentTypes = `${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hasRows ? '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>' : ''}</Types>`;
    const files = [
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(`${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
      { name: 'xl/workbook.xml', data: enc.encode(`${H}<workbook xmlns="${NS}" xmlns:r="${RS}"><sheets><sheet name="${x(String(sheetName || 'Reporte')).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${RS}/styles" Target="styles.xml"/></Relationships>`) },
      { name: 'xl/styles.xml', data: enc.encode(stylesXml) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(`${H}${sheetXml}`) },
    ];
    if (hasRows) {
      files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: enc.encode(`${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RS}/table" Target="../tables/table1.xml"/></Relationships>`) });
      files.push({ name: 'xl/tables/table1.xml', data: enc.encode(tableXml) });
    }
    return zipStore(files);
  }

  // -------------------------------------------------------------------------
  // Detalle de reportes (tarjetas clicables) con buscador
  // -------------------------------------------------------------------------

  async function openDetail(kind, from, to) {
    const [r, st] = await Promise.all([
      api('GET', `reports/detail?kind=${encodeURIComponent(kind)}&from=${from}&to=${to}`),
      api('GET', 'settings').catch(() => ({ settings: {} })),
    ]);
    const business = st.settings?.gym_name || 'Mission Fit Panamá';
    const moneyCols = ['Monto', 'Total', 'Saldo'];
    const moneyIdx = r.columns.findIndex((c) => moneyCols.includes(c));
    const period = from === to ? fmtDate(from) : `${fmtDate(from)} al ${fmtDate(to)}`;
    const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    // Palabras de búsqueda: los números admiten "$" y coma decimal ("$199,99" = 199.99).
    const words = () => ($('detailSearch')?.value || '').trim().split(/\s+/).filter(Boolean)
      .map((t) => (/^[\d.,$]+$/.test(t) ? t.replace(/\$/g, '').replace(',', '.') : norm(t)));
    const matches = (row, w) => {
      const hay = norm(row.map((v) => v ?? '').join(' '));
      return w.every((term) => hay.includes(norm(term)));
    };
    let shown = r.rows;
    // Fechas ISO (2026-10-23) se muestran como 23/10/2026; montos con formato de dinero.
    const cellHtml = (v, i) => {
      if (moneyCols.includes(r.columns[i])) return money(v);
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
      return esc(v ?? '');
    };
    const renderBody = () => {
      const w = words();
      shown = w.length ? r.rows.filter((row) => matches(row, w)) : r.rows;
      const codeIdx = r.columns.indexOf('Código');
      $('detailBody').innerHTML = shown.map((row) => `<tr${codeIdx >= 0 && row[codeIdx] ? ` class="clickable" data-code="${esc(row[codeIdx])}" title="Abrir ficha para cobrar"` : ''}>${row.map((v, i) => `<td>${cellHtml(v, i)}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${r.columns.length}" class="muted">Ningún registro coincide con la búsqueda.</td></tr>`;
      const total = moneyIdx >= 0 ? shown.reduce((s, row) => s + Number(row[moneyIdx] || 0), 0) : null;
      $('detailCount').textContent = `${shown.length} de ${r.rows.length} registro${r.rows.length === 1 ? '' : 's'}`
        + (total !== null ? ` · Total ${money(total)}` : '');
      $('detailXlsx').disabled = shown.length === 0;
    };
    openModal(`
      <div class="modal-header">${esc(r.title)}</div>
      <p class="muted">${esc(period)}</p>
      ${r.rows.length ? `
      <div class="form-group" style="margin-top:12px;">
        <div class="search-field">${ico('search')}<input id="detailSearch" class="wide-input" type="search" autocomplete="off" placeholder="Buscar por monto, código de Yappy, persona o producto..."></div>
      </div>
      <p class="muted" id="detailCount"></p>
      <div class="detail-table-wrap" style="margin-top:8px;">
        <table><thead><tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody id="detailBody"></tbody></table>
      </div>` : '<p class="muted" style="margin-top:12px;">Sin registros en este período.</p>'}
      <div class="btn-group">
        <button class="btn btn-success" id="detailXlsx" ${r.rows.length ? '' : 'disabled'}>${ico('download')}Descargar Excel</button>
        <button class="btn btn-secondary" data-close-modal>Cerrar</button>
      </div>`);
    // En "Saldo pendiente": tocar un cliente abre su ficha, donde se registra el abono.
    $('detailBody')?.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr[data-code]');
      if (!tr) return;
      try {
        const { client } = await api('GET', 'clients/code/' + encodeURIComponent(tr.dataset.code));
        closeModal();
        clientDetail(client.id).catch((err) => toast(err.message, false));
      } catch (err) { toast(err.message, false); }
    });
    if (r.rows.length) {
      // Ventana más ancha para que las tablas quepan sin deslizar a los lados.
      $('modalBox').style.maxWidth = 'min(1040px, 96vw)';
      $('detailSearch').addEventListener('input', renderBody);
      renderBody();
    }
    $('detailXlsx').addEventListener('click', () => {
      const slug = norm(business).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reporte';
      const blob = makeXlsx({
        business,
        title: r.title,
        period: `Período: ${period} · ${shown.length} registro${shown.length === 1 ? '' : 's'}`,
        columns: r.columns,
        rows: shown,
        moneyCols,
        sheetName: r.title,
      });
      downloadBlob(blob, `${slug}-${kind}-${from}_${to}.xlsx`);
    });
  }

  async function searchYappy() {
    const ref = $('yappyQ').value.trim();
    if (!ref) return toast('Escribe el código de Yappy', false);
    const { results } = await api('GET', 'payments/search?ref=' + encodeURIComponent(ref));
    $('yappyResults').innerHTML = results.length ? `<div class="table-responsive"><table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Cliente</th><th>Código</th><th>Método</th><th>Monto</th></tr></thead>
        <tbody>${results.map((r) => `<tr>
          <td>${fmtDate(r.day)} ${timeSql(r.created_at)}</td><td>${esc(r.kind)}</td>
          <td>${esc(r.client_name || 'Mostrador')}</td><td><strong>${esc(r.reference)}</strong></td>
          <td>${esc(r.method === 'yapi' ? 'Yappy' : (METHOD_LABEL[r.method] || r.method))}</td><td>${money(r.amount)}</td>
        </tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No hay pagos ni ventas con ese código.</p>';
  }

  // -------------------------------------------------------------------------
  // Tarjeta del cliente: QR con su código interno y envío por WhatsApp
  // -------------------------------------------------------------------------

  let cardClient = null;
  const loadImageUrl = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  async function clientCardBlob(c) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 840;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 640, 840);
    ctx.fillStyle = '#2563EB';
    ctx.fillRect(0, 0, 640, 130);
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.fillText('MISSION FIT PANAMÁ', 320, 82);
    ctx.fillStyle = '#0F172A';
    let size = 40;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    while (ctx.measureText(c.full_name).width > 580 && size > 22) {
      size -= 2;
      ctx.font = `bold ${size}px system-ui, sans-serif`;
    }
    ctx.fillText(c.full_name, 320, 220);
    const img = await loadImageUrl(qrDataUrl(c.code, 10));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 110, 260, 420, 420);
    ctx.fillStyle = '#2563EB';
    ctx.font = 'bold 46px monospace';
    ctx.fillText(c.code, 320, 735);
    ctx.fillStyle = '#64748B';
    ctx.font = '26px system-ui, sans-serif';
    ctx.fillText('Presenta este QR o código al entrar', 320, 790);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  const waText = (c) => `Hola ${c.full_name}, aquí está tu tarjeta de Mission Fit Panamá. Código: ${c.code}. Preséntala o muestra el QR al entrar.`;
  function openWhatsappChat(phone, text) {
    const n = waNumber(phone);
    if (!n) return toast('El cliente no tiene teléfono', false);
    window.open(`https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}`, '_blank', 'noopener');
  }
  // Con navegador móvil: abre el menú de compartir (WhatsApp → contacto), como en UTAPP.
  // En escritorio: descarga la imagen y abre el chat para adjuntarla.
  // Tarjeta protegida: la recepción la usa una sola vez (enviar o descargar) cuando el administrador
  // la abre; después queda bloqueada. Al usarla se cierra antes de generar la imagen: si se cancela el envío, también cuenta.
  async function consumeCard(c) {
    try {
      const r = await api('POST', 'clients/' + encodeURIComponent(c.id) + '/card-use');
      if (me.role === 'user') {
        clientDetail(c.id).catch(() => {});
      } else if (cardClient && cardClient.id === c.id) {
        cardClient.card_shares = r.card_shares;
        refreshCardShareInfo();
      }
      return true;
    } catch (err) {
      toast(err.message, false);
      return false;
    }
  }
  function refreshCardShareInfo() {
    const info = $('cardShareInfo');
    if (info && cardClient) {
      const n = Number(cardClient.card_shares || 0);
      info.textContent = `Tarjeta usada ${n} ${n === 1 ? 'vez' : 'veces'}`;
    }
  }
  async function shareClientCard(c) {
    const snap = { ...c };
    if (!(await consumeCard(c))) return;
    const blob = await clientCardBlob(snap);
    const file = new File([blob], `tarjeta-${snap.code}.png`, { type: 'image/png' });
    const text = waText(snap);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
      } catch (err) {
        if (err.name !== 'AbortError') throw err;
      }
      return;
    }
    downloadBlob(blob, `tarjeta-${snap.code}.png`);
    openWhatsappChat(snap.phone, text);
    toast('Imagen descargada: adjúntala en el chat de WhatsApp.');
  }

  // -------------------------------------------------------------------------
  // Check-in con cámara: lectura del QR de la tarjeta
  // -------------------------------------------------------------------------

  let scanStream = null;
  let scanTimer = null;
  function stopScanner() {
    clearInterval(scanTimer);
    scanTimer = null;
    if (scanStream) {
      scanStream.getTracks().forEach((t) => t.stop());
      scanStream = null;
    }
  }
  function openScanner() {
    openModal(`
      <div class="modal-header">Escanear QR del cliente</div>
      <div class="scan-box"><video id="scanVideo" playsinline muted></video></div>
      <p class="muted" id="scanHint" style="margin-top:8px;">Apunta la cámara al QR de la tarjeta del cliente.</p>
      <form id="scanForm" style="margin-top:12px;">
        <div class="form-group"><label>¿No hay cámara? Escribe o pega el código</label>
          <input id="scanCode" class="wide-input" autocomplete="off" placeholder="MF-XXXXXX"></div>
        <div class="btn-group">
          <button class="btn btn-primary" type="submit">${ico('search')}Buscar</button>
          <button class="btn btn-secondary" type="button" data-close-modal>Cerrar</button>
        </div>
      </form>`);
    $('scanForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = $('scanCode').value.trim();
      if (code) handleScanCode(code);
    });
    startCamera();
  }
  // Lectura de QR: usa el lector nativo si el navegador lo trae (Chrome Android) y, si no,
  // decodifica cada cuadro con jsQR (iPad/iPhone Safari, Firefox, escritorio).
  const canUseCamera = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  let scanCanvas = null;
  function makeReader(video) {
    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      return async () => {
        if (!video.videoWidth || scanBusy) return;
        try {
          const found = await detector.detect(video);
          if (found.length) handleScanCode(found[0].rawValue);
        } catch (err) {
          // Cuadro sin QR legible: se sigue buscando.
        }
      };
    }
    scanCanvas = scanCanvas || document.createElement('canvas');
    return () => {
      if (!video.videoWidth || scanBusy || typeof jsQR !== 'function') return;
      const w = Math.min(640, video.videoWidth);
      const h = Math.round(video.videoHeight * w / video.videoWidth);
      scanCanvas.width = w;
      scanCanvas.height = h;
      const ctx = scanCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);
      const frame = ctx.getImageData(0, 0, w, h);
      const code = jsQR(frame.data, w, h, { inversionAttempts: 'dontInvert' });
      if (code && code.data) handleScanCode(code.data);
    };
  }
  function startCamera() {
    if (!$('scanVideo') || scanStream || scanTimer) return;
    if (!canUseCamera()) {
      $('scanHint').textContent = 'Este navegador no permite abrir la cámara. Escribe el código de la tarjeta.';
      $('scanVideo').style.display = 'none';
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        const video = $('scanVideo');
        if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }
        scanStream = stream;
        video.setAttribute('playsinline', '');
        video.setAttribute('muted', '');
        video.muted = true;
        video.srcObject = stream;
        // Safari (iPad) puede bloquear la reproducción automática: en ese caso se pide tocar el video.
        video.play().catch(() => {
          if ($('scanHint')) $('scanHint').textContent = 'Toca la imagen de la cámara para activarla.';
          video.addEventListener('click', () => video.play().catch(() => {}), { once: true });
        });
        const readFrame = makeReader(video);
        scanTimer = setInterval(readFrame, 300);
        $('scanHint').textContent = 'Apunta la cámara al QR de la tarjeta del cliente.';
      })
      .catch(() => {
        if ($('scanHint')) $('scanHint').textContent = 'No se pudo abrir la cámara. Revisa el permiso de cámara del navegador o escribe el código.';
      });
  }
  // Tarjeta de confirmación: el ingreso (o la salida) se registra solo con su botón.
  // La ✕ cierra sin registrar y queda en la bitácora. Si la bitácora no se puede guardar, la tarjeta sigue abierta.
  // La ficha que estaba abierta en Check-in se quita: la tarjeta de escaneo la reemplaza.
  function clearCheckinDetail() {
    checkinClient = null;
    checkinOpen = null;
    $('ciDetail').style.display = 'none';
    $('ciDetail').innerHTML = '';
  }

  function openScanCard(client, openEntry) {
    clearCheckinDetail();
    const st = client.membership_status;
    const active = st === 'activa' || st === 'por_vencer';
    const endTxt = fmtDate(client.membership_end);
    const statusLine = openEntry
      ? stateBox('ok', 'dumbbell', `<strong>Ya está dentro</strong> desde ${timeOf(openEntry.check_in_at)}.`)
      : active
        ? stateBox(st === 'por_vencer' ? 'warn' : 'ok', st === 'por_vencer' ? 'clock' : 'check-circle', `<strong>${st === 'por_vencer' ? 'Membresía por vencer' : 'Membresía activa'}</strong> hasta el ${endTxt}${client.membership_plan ? ` · ${esc(client.membership_plan)}` : ''}`)
        : stateBox('off', 'ban', st === 'vencida'
          ? `<strong>Membresía vencida</strong> desde el ${endTxt}. No puede entrar hasta renovar.`
          : '<strong>Sin membresía.</strong> Debe cobrar una membresía para entrar.');
    const action = openEntry
      ? `<button class="btn btn-danger scan-action" id="scanAction" type="button">${ico('logout')}Registrar salida</button>`
      : `<button class="btn btn-success scan-action" id="scanAction" type="button" ${active ? '' : 'disabled'}>${ico('check')}Registrar ingreso</button>`;

    openModal(`
      <div class="scan-card">
        <div class="scan-top">
          <div>
            <div class="scan-label">Cliente escaneado</div>
            <div class="scan-name">${esc(client.full_name)}</div>
            <div class="muted">${esc(client.membership_plan || 'Sin plan')}</div>
          </div>
          <button class="scan-x" type="button" id="scanClose" aria-label="Cerrar sin registrar">${ico('x')}</button>
        </div>
        ${statusLine}
        <p class="scan-err" id="scanErr" hidden></p>
        <div class="scan-actions">${action}</div>
      </div>`);
    scanCardOpen = true;

    $('scanClose').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('POST', 'scan-log', { client_id: client.id, action: 'cerrado' });
        closeModal();
        toast('Cerrado sin registrar');
      } catch (err) {
        btn.disabled = false;
        $('scanErr').textContent = `No se pudo guardar en la bitácora: ${err.message}. Intenta de nuevo.`;
        $('scanErr').hidden = false;
      }
    });

    $('scanAction')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true);
      $('scanErr').hidden = true;
      try {
        if (openEntry) await api('POST', `entries/${encodeURIComponent(openEntry.id)}/check-out`);
        else await api('POST', 'entries/check-in', { client_id: client.id });
        closeModal();
        toast(openEntry ? `Salida registrada: ${client.full_name}` : `Ingreso registrado: ${client.full_name}`);
        clearCheckinDetail();
        go('checkin');
      } catch (err) {
        setBusy(btn, false);
        $('scanErr').textContent = err.message;
        $('scanErr').hidden = false;
      }
    });
  }

  let scanBusy = false;
  async function handleScanCode(raw) {
    if (scanBusy) return;
    const code = String(raw).trim();
    scanBusy = true;
    stopScanner();
    if ($('scanHint')) $('scanHint').textContent = 'Buscando cliente…';
    try {
      const { client } = await api('GET', 'scan/' + encodeURIComponent(code));
      scanBusy = false;
      const { entries } = await api('GET', 'entries/open');
      openScanCard(client, entries.find((en) => en.client_id === client.id) || null);
    } catch (err) {
      scanBusy = false;
      toast(err.message, false);
      // No se reactiva la cámara sola: si el mismo QR sigue frente a ella, se leería otra vez en bucle.
      // La recepción toca "Escanear otra vez" cuando quiera leer otra tarjeta.
      if ($('scanHint')) {
        $('scanHint').innerHTML = `${esc(err.message)}. <button class="btn btn-secondary btn-small" type="button" id="scanAgain" style="margin-left:8px;">${ico('scan')}Escanear otra vez</button>`;
        $('scanAgain')?.addEventListener('click', () => startCamera());
      }
    }
  }

  // -------------------------------------------------------------------------
  // Market: ventas de hoy
  // -------------------------------------------------------------------------

  async function loadSalesToday() {
    const { sales } = await api('GET', 'sales');
    const cobrado = sales.filter((s) => !s.on_account).reduce((t, s) => t + Number(s.total), 0);
    const cuenta = sales.filter((s) => s.on_account).reduce((t, s) => t + Number(s.total), 0);
    $('salesSummary').textContent = `${sales.length} venta${sales.length === 1 ? '' : 's'} · cobrado ${money(cobrado)}${cuenta ? ` · a cuenta ${money(cuenta)}` : ''}`;
    $('salesList').innerHTML = sales.map((s) => `
      <button class="sale-row" data-sale="${esc(s.id)}">
        <span class="sale-time">${timeSql(s.created_at)}</span>
        <span class="sale-main"><strong>${esc(s.client_name || 'Mostrador')}</strong>
          <span class="muted">${esc(s.items || '')}</span></span>
        <span class="sale-amt"><strong>${money(s.total)}</strong>
          <span class="muted">${s.on_account ? 'A cuenta' : esc(METHOD_LABEL[s.method] || s.method)}</span></span>
      </button>`).join('') || '<p class="muted">Aún no hay ventas hoy.</p>';
  }

  async function openSaleDetail(id) {
    const { sale, lines } = await api('GET', 'sales/' + encodeURIComponent(id));
    openModal(`
      <div class="modal-header">Venta de ${timeSql(sale.created_at)}</div>
      <p class="muted">${esc(sale.client_name || 'Mostrador')}${sale.client_phone ? ` · Tel. ${esc(sale.client_phone)}` : ''}</p>
      <div class="detail-table-wrap" style="margin-top:12px;"><table>
        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
        <tbody>${lines.map((l) => `<tr><td>${esc(l.icon || '')} ${esc(l.name)}</td><td>${l.qty}</td><td>${money(l.unit_price)}</td><td>${money(l.subtotal)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="sum-box" style="margin-top:12px;">
        <div class="sum-row sum-total"><span>Total</span><span>${money(sale.total)}</span></div>
        <div class="sum-row"><span>Pago</span><span>${sale.on_account ? 'Cargado a cuenta' : esc(METHOD_LABEL[sale.method] || sale.method)}</span></div>
        ${sale.reference ? `<div class="sum-row"><span>Código Yappy</span><strong>${esc(sale.reference)}</strong></div>` : ''}
      </div>
      <div class="btn-group"><button class="btn btn-secondary" data-close-modal>Cerrar</button></div>`);
  }

  function productFormHtml(p = {}) {
    const isEdit = !!p.id;
    const cur = p.icon || '📦';
    const cats = [...new Set(products.map((x) => x.category).filter(Boolean))];
    return `
      <button class="modal-close" type="button" data-close aria-label="Cerrar">${ico('x')}</button>
      <div class="modal-header">${isEdit ? 'Editar producto' : 'Nuevo producto'}</div>
      <form id="productForm" data-id="${esc(p.id || '')}">
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nombre</label><input name="name" required value="${esc(p.name ?? '')}"></div></div>
        <div class="form-row">
          <div class="form-group"><label>Precio</label><input name="price" type="number" step="0.01" min="0" required value="${p.price ?? ''}"></div>
          <div class="form-group"><label>Categoría</label><input name="category" list="catList" placeholder="Ej: Bebidas" value="${esc(p.category ?? '')}"><datalist id="catList">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Stock mínimo</label><input name="min_stock" type="number" min="0" value="${p.min_stock ?? 5}"></div>
          ${isEdit ? '<div class="form-group"></div>' : '<div class="form-group"><label>Stock inicial</label><input name="stock" type="number" min="0" value="0"></div>'}
        </div>
        <div class="form-row">
          <div class="form-group" style="grid-column:1 / -1;">
            <label>Icono</label>
            <div class="icon-grid">${PRODUCT_ICONS.map((i) => (
              `<button type="button" class="icon-opt ${i === cur ? 'sel' : ''}" data-icon="${i}">${i}</button>`
            )).join('')}</div>
            <input type="hidden" name="icon" value="${esc(cur)}">
          </div>
        </div>
        <div class="error" id="productError"></div>
        <div class="btn-group">
          <button class="btn btn-primary" type="submit">${ico('check')}Guardar</button>
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

  // Avisos para socios: publica el administrador. El socio los ve al abrir su portal y los cierra con "Entendido".
  function ensureNoticesCard() {
    if (!can('admin')) return;
    if (!$('noticesCard')) {
      const card = document.createElement('div');
      card.className = 'card';
      card.id = 'noticesCard';
      card.innerHTML = `
        <div class="card-title"><span class="card-title-icon">${ico('megaphone')}</span> Avisos para socios</div>
        <p class="muted">Aparecen cuando el socio abre su portal. Por ejemplo: día cerrado, feriado o cambio de horario.</p>
        <form id="noticeForm">
          <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Título</label><input name="title" maxlength="120" required placeholder="Ej. Cerrado por feriado"></div></div>
          <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Mensaje</label><input name="body" maxlength="1000" required placeholder="Ej. El gimnasio estará cerrado el lunes 3 de noviembre."></div></div>
          <div class="form-row">
            <div class="form-group"><label>Desde (opcional)</label><input name="starts_on" type="date"></div>
            <div class="form-group"><label>Hasta (opcional)</label><input name="ends_on" type="date"></div>
          </div>
          <div class="error" id="noticeError"></div>
          <div class="btn-group"><button class="btn btn-primary" type="submit">${ico('megaphone')}Publicar aviso</button></div>
        </form>
        <div id="noticesList" style="margin-top:12px;"></div>`;
      $('configView').appendChild(card);
      $('noticeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const btn = f.querySelector('button');
        $('noticeError').textContent = '';
        setBusy(btn, true);
        try {
          await api('POST', 'notices', formData(f));
          f.reset();
          toast('Aviso publicado');
          loadNoticesList();
        } catch (err) {
          $('noticeError').textContent = err.message;
        } finally {
          setBusy(btn, false);
        }
      });
      $('noticesList').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-del-notice]');
        if (!b) return;
        try {
          await api('DELETE', 'notices/' + encodeURIComponent(b.dataset.delNotice));
          toast('Aviso quitado');
          loadNoticesList();
        } catch (err) {
          toast(err.message, false);
        }
      });
    }
    loadNoticesList().catch(() => {});
  }

  async function loadNoticesList() {
    const { notices } = await api('GET', 'notices');
    $('noticesList').innerHTML = notices.length
      ? notices.map((n) => `<div class="result-row"><div><strong>${esc(n.title)}</strong><div class="muted">${n.ends_on >= '9999-12-31' ? 'Sin fecha límite' : `Hasta ${fmtDate(n.ends_on)}`} · ${esc(n.body)}</div></div><button class="btn btn-secondary btn-small" data-del-notice="${esc(n.id)}">Quitar</button></div>`).join('')
      : '<p class="muted">No hay avisos vigentes.</p>';
  }

  // Tarjeta de reinicio de datos: solo la ve el creador. Pide escribir REINICIAR para habilitar el botón.
  function ensureResetCard() {
    if (me.role !== 'creator' || $('resetCard')) return;
    const card = document.createElement('div');
    card.className = 'card card-danger';
    card.id = 'resetCard';
    card.innerHTML = `
      <div class="card-title"><span class="card-title-icon danger">${ico('alert')}</span> Reiniciar datos (fin de la prueba Beta)</div>
      <p class="muted">Borra clientes, membresías, pagos, entradas, ventas, cuentas por cobrar e inventario de productos. Conserva usuarios, planes y la configuración del gimnasio. <strong>No se puede deshacer.</strong> Si necesitas conservar algo, descárgalo antes en Reportes.</p>
      <div class="form-row">
        <div class="form-group"><label>Escribe <strong>REINICIAR</strong> para confirmar:</label><input id="resetConfirm" autocomplete="off"></div>
      </div>
      <div class="btn-group"><button class="btn btn-danger" id="resetBtn" disabled>${ico('trash')}Reiniciar todos los datos</button></div>`;
    $('configView').appendChild(card);
    $('resetConfirm').addEventListener('input', () => {
      $('resetBtn').disabled = $('resetConfirm').value.trim() !== 'REINICIAR';
    });
    $('resetBtn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true);
      try {
        await api('POST', 'admin/reset', { confirm: 'REINICIAR' });
        toast('Datos reiniciados. Recargando…');
        setTimeout(() => location.reload(), 1200);
      } catch (err) {
        toast(err.message, false);
        setBusy(btn, false);
      }
    });
  }

  async function loadConfig() {
    const [{ settings }, usersRes] = await Promise.all([api('GET', 'settings'), api('GET', 'users')]);
    users = usersRes.users;
    ensureResetCard();
    ensureNoticesCard();
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
        <td class="row-actions">${canEdit ? `<button class="btn btn-secondary btn-small" data-edit-plan="${esc(p.id)}">${ico('edit')}Editar</button>` : ''}</td>
      </tr>`).join('');

    $('newUserBtn').style.display = canEdit ? '' : 'none';
    $('usersBody').innerHTML = users.map((u) => {
      // El creador edita a cualquiera; el administrador solo a usuarios de recepción.
      const editable = me.role === 'creator' || u.role === 'user';
      const removable = me.role === 'creator' && u.id !== me.id;
      return `
      <tr>
        <td><span class="user-cell"><span class="avatar avatar-sm" aria-hidden="true">${esc(initials(u.name))}</span><strong>${esc(u.name)}</strong>${u.id === me.id ? ' <span class="muted">(tú)</span>' : ''}</span></td>
        <td>${esc(u.email)}</td>
        <td><span class="role-tag role-${esc(u.role)}">${esc(ROLE_LABEL[u.role])}</span></td>
        <td class="row-actions">
          ${editable ? `<button class="btn btn-secondary btn-small" data-edit-user="${esc(u.id)}">${ico('edit')}Editar</button>` : ''}
          ${removable ? `<button class="btn btn-danger btn-small" data-del-user="${esc(u.id)}">${ico('trash')}Eliminar</button>` : ''}
        </td>
      </tr>`;
    }).join('');
  }

  function planFormHtml(p) {
    return `
      <button class="modal-close" type="button" data-close aria-label="Cerrar">${ico('x')}</button>
      <div class="modal-header">Editar plan</div>
      <form id="planForm" data-id="${esc(p.id)}">
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nombre</label><input name="name" required value="${esc(p.name)}"></div></div>
        <div class="form-row">
          <div class="form-group"><label>Precio</label><input name="price" type="number" step="0.01" min="0" required value="${p.price}"></div>
          <div class="form-group"><label>Duración (días)</label><input name="duration_days" type="number" min="1" required value="${p.duration_days}"></div>
        </div>
        <div class="error" id="planError"></div>
        <div class="btn-group">
          <button class="btn btn-primary" type="submit">${ico('check')}Guardar</button>
          <button class="btn btn-secondary" type="button" data-close>Cancelar</button>
        </div>
      </form>`;
  }

  function roleOptions() {
    return me.role === 'creator'
      ? [['creator', 'Creador'], ['admin', 'Administrador'], ['user', 'Recepción']]
      : [['admin', 'Administrador'], ['user', 'Recepción']];
  }

  function userFormHtml() {
    const roles = roleOptions();
    return `
      <button class="modal-close" type="button" data-close aria-label="Cerrar">${ico('x')}</button>
      <div class="modal-header">Crear usuario</div>
      <form id="userForm">
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nombre</label><input name="name" required></div></div>
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Email</label><input name="email" type="email" required></div></div>
        <div class="form-row">
          <div class="form-group"><label>Contraseña (mínimo 8)</label><input name="password" type="password" minlength="8" required></div>
          <div class="form-group"><label>Rol</label><select name="role">${roles.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        </div>
        <div class="error" id="userError"></div>
        <div class="btn-group">
          <button class="btn btn-primary" type="submit">${ico('check')}Crear</button>
          <button class="btn btn-secondary" type="button" data-close>Cancelar</button>
        </div>
      </form>`;
  }

  function userEditFormHtml(u) {
    const self = u.id === me.id;
    const roles = roleOptions();
    return `
      <button class="modal-close" type="button" data-close aria-label="Cerrar">${ico('x')}</button>
      <div class="modal-header">Editar usuario</div>
      <form id="userEditForm" data-id="${esc(u.id)}">
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nombre</label><input name="name" required value="${esc(u.name)}"></div></div>
        <div class="form-row">
          <div class="form-group"><label>Rol</label>
            <select name="role" ${self ? 'disabled' : ''}>${roles.map(([v, l]) => `<option value="${v}" ${v === u.role ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </div>
          <div class="form-group"><label>Estado</label>
            <select name="active" ${self ? 'disabled' : ''}>
              <option value="1" ${u.active ? 'selected' : ''}>Activo</option>
              <option value="0" ${!u.active ? 'selected' : ''}>Desactivado</option>
            </select>
          </div>
        </div>
        <div class="form-row"><div class="form-group" style="grid-column:1 / -1;"><label>Nueva contraseña (opcional, mínimo 8)</label><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Déjala en blanco para no cambiarla"></div></div>
        <p class="muted" style="margin-bottom:10px;">${self ? 'No puedes cambiar tu propio rol ni desactivarte.' : 'Al desactivar o cambiar la contraseña, la sesión de ese usuario se cierra.'}</p>
        <div class="error" id="userError"></div>
        <div class="btn-group">
          <button class="btn btn-primary" type="submit">${ico('check')}Guardar</button>
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

    $('ciScan').addEventListener('click', openScanner);
    $('salesList').addEventListener('click', (e) => {
      const row = e.target.closest('[data-sale]');
      if (row) openSaleDetail(row.dataset.sale).catch((err) => toast(err.message, false));
    });
    $('yappyBtn').addEventListener('click', () => searchYappy().catch((e) => toast(e.message, false)));
    $('yappyQ').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchYappy().catch((err) => toast(err.message, false));
    });
    // Tarjetas clicables: en Dashboard usan hoy; en Reportes usan el período elegido.
    document.querySelectorAll('.stat-card[data-kind]').forEach((el) => el.addEventListener('click', () => {
      const today = panamaToday();
      const range = el.closest('#reportesView') ? periodRange() : { from: today, to: today };
      openDetail(el.dataset.kind, range.from, range.to).catch((err) => toast(err.message, false));
    }));

    // Check-in
    $('ciSearch').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => searchCheckin().catch((e) => toast(e.message, false)), 250);
    });
    $('ciResults').addEventListener('click', (e) => {
      const row = e.target.closest('.result-row');
      if (row) showClientCheckin(row.dataset.id).catch((err) => toast(err.message, false));
    });
    $('ciDetail').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-mode]');
      if (!tab || !checkinClient) return;
      checkinMode = tab.dataset.mode;
      renderCheckin();
    });
    // Cliente nuevo desde el check-in: al guardarlo, queda listo para entrar o cobrar.
    $('ciNewClient').addEventListener('click', () => {
      newClientFrom = 'checkin';
      openModal(clientFormHtml());
    });
    $('openEntries').addEventListener('click', async (e) => {
      const outBtn = e.target.closest('[data-out]');
      if (outBtn) {
        const entryId = outBtn.dataset.out;
        try {
          const r = await api('POST', `entries/${encodeURIComponent(entryId)}/check-out`);
          toast(`Salida registrada: ${r.entry.minutes} min`);
        } catch (err) {
          toast(err.message, false);
        }
        loadOpenEntries();
        refreshCheckinIfShowing(entryId);
        return;
      }
      const detail = e.target.closest('[data-detail]');
      if (detail) {
        const en = openEntriesList.find((x) => x.id === detail.dataset.detail);
        if (en) openInsideCard(en).catch((err) => toast(err.message, false));
      }
    });
    $('modalBox').addEventListener('click', async (e) => {
      if (e.target.closest('[data-close-modal]')) { closeModal(); return; }
      if (e.target.closest('[data-portal-access]') && cardClient) {
        const btn = e.target.closest('[data-portal-access]');
        setBusy(btn, true);
        try {
          const r = await api('POST', 'clients/' + encodeURIComponent(cardClient.id) + '/portal-access');
          // Tarjeta con el acceso: se envía por WhatsApp o se cierra con la ✕. La contraseña no se vuelve a mostrar.
          const first = String(cardClient.full_name || '').split(' ')[0];
          const msg = `Hola ${first}, ya tienes acceso al portal del socio de Mission Fit Panamá.\n\nIngresa aquí: ${location.origin}/socio/\nUsuario (cédula): ${r.login}\nContraseña temporal: ${r.password}\n\nAl entrar te pedirá crear tu propia contraseña.`;
          $('portalResult').innerHTML = `
            <div class="status-box ok">
              <div class="flex-between">
                <strong>Acceso creado</strong>
                <button class="scan-x" type="button" id="portalClose" aria-label="Cerrar sin enviar">${ico('x')}</button>
              </div>
              <p style="margin:8px 0;">Cédula: <strong>${esc(r.login)}</strong><br>Contraseña temporal: <strong class="client-code">${esc(r.password)}</strong></p>
              <p class="muted small" style="margin:0;">Esta contraseña no se volverá a mostrar. Si cierras sin enviarla, habrá que restablecer el acceso.</p>
              <div class="btn-group"><a class="btn btn-success" target="_blank" rel="noopener" href="https://wa.me/${esc(waNumber(cardClient.phone))}?text=${encodeURIComponent(msg)}">${ico('send')}Enviar por WhatsApp</a></div>
            </div>`;
          $('portalClose').addEventListener('click', () => { $('portalResult').innerHTML = ''; });
        } catch (err) {
          toast(err.message, false);
        } finally {
          setBusy(btn, false);
        }
        return;
      }
      if (e.target.closest('[data-card-download]') && cardClient) {
        const snap = { ...cardClient };
        if (!(await consumeCard(cardClient))) return;
        clientCardBlob(snap).then((b) => downloadBlob(b, `tarjeta-${snap.code}.png`)).catch((err) => toast(err.message, false));
        return;
      }
      if (e.target.closest('[data-card-open]') && cardClient) {
        const id = cardClient.id;
        api('POST', 'clients/' + encodeURIComponent(id) + '/card-open')
          .then(() => { toast('Tarjeta abierta para un uso de recepción'); return clientDetail(id); })
          .catch((err) => toast(err.message, false));
        return;
      }
      if (e.target.closest('[data-card-share]') && cardClient) {
        shareClientCard(cardClient).catch((err) => toast(err.message, false));
        return;
      }
      if (e.target.closest('[data-wa-chat]') && cardClient) {
        openWhatsappChat(cardClient.phone, waText(cardClient));
        return;
      }
      const b = e.target.closest('[data-out-modal]');
      if (!b) return;
      const entryId = b.dataset.outModal;
      try {
        const r = await api('POST', `entries/${encodeURIComponent(entryId)}/check-out`);
        closeModal();
        toast(`Salida registrada: ${r.entry.minutes} min`);
      } catch (err) {
        toast(err.message, false);
      }
      loadOpenEntries();
      refreshCheckinIfShowing(entryId);
    });

    // Clientes
    let clientTimer;
    $('clientSearch').addEventListener('input', () => {
      clearTimeout(clientTimer);
      clientTimer = setTimeout(() => loadClients().catch((e) => toast(e.message, false)), 250);
    });
    $('newClientBtn').addEventListener('click', () => openModal(clientFormHtml()));
    $('clientsBody').addEventListener('click', (e) => {
      const detail = e.target.closest('[data-detail]')?.dataset.detail;
      const edit = e.target.closest('[data-edit]')?.dataset.edit;
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
      const t = e.target.closest('[data-inc],[data-dec],[data-remove]');
      if (!t) return;
      if (t.dataset.inc !== undefined) changeQty(Number(t.dataset.inc), 1);
      else if (t.dataset.dec !== undefined) changeQty(Number(t.dataset.dec), -1);
      else if (t.dataset.remove !== undefined) { cart.splice(Number(t.dataset.remove), 1); renderCart(); }
    });
    let posClientTimer;
    $('posClientSearch').addEventListener('input', () => {
      clearTimeout(posClientTimer);
      posClientTimer = setTimeout(() => searchPosClient().catch((e) => toast(e.message, false)), 250);
    });
    $('posClientSearch').addEventListener('focus', () => searchPosClient().catch((e) => toast(e.message, false)));
    $('posClientResults').addEventListener('click', (e) => {
      const row = e.target.closest('[data-pick]');
      if (row) pickPosClient(row.dataset.pick).catch((err) => toast(err.message, false));
    });
    $('posClientInfo').addEventListener('click', (e) => {
      if (e.target.closest('[data-clear-client]')) { posClient = null; renderCart(); }
      if (e.target.closest('[data-pay-debt]') && posClient) {
        clientDetail(posClient.id).catch((err) => toast(err.message, false));
      }
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
      const restock = e.target.closest('[data-restock]')?.dataset.restock;
      const edit = e.target.closest('[data-edit-product]')?.dataset.editProduct;
      if (restock) {
        const p = products.find((x) => x.id === restock);
        openModal(`
          <button class="modal-close" type="button" data-close aria-label="Cerrar">${ico('x')}</button>
          <div class="modal-header">Agregar stock · ${esc(p.name)}</div>
          <form id="restockForm">
            <div class="form-row">
              <div class="form-group"><label>Cantidad que ingresa</label><input name="qty" type="number" min="1" required></div>
            </div>
            <div class="error" id="restockError"></div>
            <div class="btn-group">
              <button class="btn btn-primary" type="submit">${ico('check')}Registrar</button>
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
      const id = e.target.closest('[data-edit-plan]')?.dataset.editPlan;
      if (id) openModal(planFormHtml(plans.find((p) => p.id === id)));
    });
    $('newUserBtn').addEventListener('click', () => openModal(userFormHtml()));
    $('usersBody').addEventListener('click', async (e) => {
      const editId = e.target.closest('[data-edit-user]')?.dataset.editUser;
      const delId = e.target.closest('[data-del-user]')?.dataset.delUser;
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
      if (scanCardOpen) return;
      if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal();
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
      if (form.id === 'scanForm') return;
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
          // Un cliente nuevo pasa directo a su ficha, o al check-in si se creó desde ahí.
          if (!form.dataset.id && saved.client?.id) {
            if (newClientFrom === 'checkin') {
              newClientFrom = null;
              go('checkin');
              showClientCheckin(saved.client.id).catch((err) => toast(err.message, false));
            } else {
              clientDetail(saved.client.id).catch((err) => toast(err.message, false));
            }
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
