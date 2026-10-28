// Portal del socio: ingreso con cédula, cambio de contraseña y tarjeta QR de acceso.
// Solo muestra los datos del propio socio (la API lo garantiza en el servidor).
(() => {
  const TOKEN_KEY = 'mf_socio_token';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtDate = (d) => {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };
  const digits = (s) => String(s ?? '').replace(/\D/g, '');

  // El token es una sesión por dispositivo; si el almacenamiento no está disponible, la app sigue funcionando.
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const setToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* sin almacenamiento */ } };

  // Muestra una pantalla. El fondo (foto difuminada) cambia según la pantalla.
  function showView(name) {
    document.querySelectorAll('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== name; });
    document.body.dataset.screen = name;
  }

  let toastTimer = null;
  function toast(msg, bad = false) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (bad ? ' bad' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch('/api/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw Object.assign(new Error('Sin conexión. Revisa tu internet e intenta de nuevo.'), { status: 0 });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'No se pudo completar la acción'), { status: res.status });
    return data;
  }

  // Código QR con la librería local (funciona sin internet, igual que en la app del personal).
  function qrDataUrl(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(6, 2);
  }

  // QR rotativo: el código cambia cada minuto. La página pide el nuevo justo al cambio de minuto.
  let cardTimer = null;
  let tickTimer = null;
  let cardEndsAt = 0;

  function stopCardTimers() {
    clearTimeout(cardTimer);
    clearInterval(tickTimer);
    cardTimer = null;
    tickTimer = null;
  }

  function paintCard(card) {
    stopCardTimers();
    $('qrWrap').hidden = false;
    $('noCard').hidden = true;
    $('qrImg').src = qrDataUrl(card.token);
    cardEndsAt = Date.now() + card.next_ms;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((cardEndsAt - Date.now()) / 1000));
      $('qrCode').textContent = `Se renueva en ${secs} s`;
      $('qrBar').style.width = `${Math.min(100, (secs / 60) * 100)}%`;
    };
    tick();
    tickTimer = setInterval(tick, 1000);
    cardTimer = setTimeout(refreshCard, card.next_ms + 300);
  }

  // Pide el QR del minuto actual. Si no hay conexión, reintenta en 5 segundos.
  async function refreshCard() {
    try {
      const d = await call('GET', 'portal/me');
      if (d.must_change) { showView('password'); return; }
      renderHome(d);
    } catch (err) {
      if (err.status === 401) {
        setToken('');
        showLogin('Tu sesión venció. Vuelve a ingresar.');
        return;
      }
      clearInterval(tickTimer);
      cardTimer = setTimeout(refreshCard, 5000);
    }
  }

  // Al volver a abrir la pantalla (el celular estaba bloqueado) se pide el QR actual sin esperar.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !$('qrWrap').hidden && Date.now() >= cardEndsAt - 500) refreshCard();
  });

  function renderHome(d) {
    const first = String(d.client?.name || '').split(' ')[0];
    $('greet').textContent = first ? `Hola, ${first}` : 'Hola';
    const labels = { activa: 'Activa', por_vencer: 'Por vencer', vencida: 'Vencida', sin_membresia: 'Sin membresía' };
    const tone = { activa: 'ok', por_vencer: 'warn', vencida: 'bad', sin_membresia: 'bad' };
    const m = d.membership || {};
    $('status').className = 'pill ' + (tone[m.status] || '');
    $('status').textContent = labels[m.status] || '—';
    $('plan').textContent = m.plan || 'Sin membresía registrada';
    let expiresText = m.end_date ? `Vence el ${fmtDate(m.end_date)}` : '';
    if (m.status === 'por_vencer' && m.days_left != null) expiresText += ` · faltan ${m.days_left} día(s)`;
    $('expires').textContent = expiresText;

    if (d.card?.token) {
      paintCard(d.card);
    } else {
      stopCardTimers();
      $('qrWrap').hidden = true;
      $('noCard').hidden = false;
      $('qrImg').removeAttribute('src');
      $('qrCode').textContent = '';
    }

    const gym = d.gym || {};
    document.title = `Portal del socio · ${gym.name || 'Mission Fit Panamá'}`;
    $('schedule').textContent = gym.schedule || 'Consulta el horario en recepción.';
    const phone = digits(gym.phone);
    const wa = digits(gym.whatsapp || gym.phone);
    $('callBtn').hidden = !phone;
    if (phone) $('callBtn').href = 'tel:+' + phone;
    $('waBtn').hidden = !wa;
    if (wa) $('waBtn').href = 'https://wa.me/' + wa;
    showView('home');
  }

  // Carga el estado del socio y decide qué pantalla mostrar.
  async function loadHome() {
    showView('loading');
    try {
      const d = await call('GET', 'portal/me');
      if (d.must_change) { showView('password'); return; }
      renderHome(d);
      loadNotices();
    } catch (err) {
      if (err.status === 401) {
        setToken('');
        showLogin('Tu sesión venció. Vuelve a ingresar.');
        return;
      }
      toast(err.message, true);
      showLogin();
    }
  }

  // Avisos del gimnasio: se muestran al abrir el portal, uno por uno. Cerrar (Entendido, ✕ o tocar fuera) queda como visto.
  let pendingNotices = [];
  async function loadNotices() {
    try {
      const { notices } = await call('GET', 'portal/notices');
      pendingNotices = notices;
      showNextNotice();
    } catch { /* sin avisos si no hay conexión */ }
  }
  function showNextNotice() {
    const n = pendingNotices[0];
    if (!n) { $('noticeBox').hidden = true; return; }
    $('noticeTitle').textContent = n.title;
    $('noticeBody').textContent = n.body;
    $('noticeDate').textContent = n.ends_on >= '9999-12-31' ? '' : `Vigente hasta el ${fmtDate(n.ends_on)}`;
    $('noticeBox').hidden = false;
  }
  function closeNotice() {
    const n = pendingNotices.shift();
    if (n) call('POST', `portal/notices/${encodeURIComponent(n.id)}/read`).catch(() => {});
    showNextNotice();
  }
  $('noticeOk').addEventListener('click', closeNotice);
  $('noticeBox').addEventListener('click', (e) => { if (e.target.id === 'noticeBox') closeNotice(); });

  // Botones ⓘ: explican un punto de la pantalla en una hoja. No abren ni cierran las secciones desplegables.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-info]');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      $('infoTitle').textContent = btn.dataset.infoTitle || '';
      $('infoText').textContent = btn.dataset.info || '';
      $('infoBox').hidden = false;
      return;
    }
    if (e.target.id === 'infoBox' || e.target.id === 'infoOk') $('infoBox').hidden = true;
  });

  // Los avisos se refrescan al volver a la app y cada 5 minutos, para que un aviso nuevo llegue sin reabrir el portal.
  const onHome = () => !document.querySelector('[data-view="home"]').hidden;
  document.addEventListener('visibilitychange', () => { if (!document.hidden && getToken() && onHome()) loadNotices(); });
  setInterval(() => { if (getToken() && onHome()) loadNotices(); }, 5 * 60 * 1000);

  // App instalable (PWA): el portal funciona sin internet con su última versión.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/socio/sw.js', { scope: '/socio/' }).catch(() => {}));
  }

  function showLogin(message) {
    stopCardTimers();
    const el = $('loginError');
    el.textContent = message || '';
    el.hidden = !message;
    showView('login');
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button');
    const cedula = f.cedula.value.trim();
    const password = f.password.value;
    $('loginError').hidden = true;
    if (!cedula || !password) {
      showLogin('Escribe tu cédula y tu contraseña.');
      return;
    }
    btn.disabled = true;
    try {
      const r = await call('POST', 'portal/login', { cedula, password });
      setToken(r.token);
      f.password.value = '';
      if (r.must_change) showView('password');
      else await loadHome();
    } catch (err) {
      showLogin(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button');
    const err = $('passwordError');
    err.hidden = true;
    const next = f.password.value;
    if (next.length < 8) return showPwError('La nueva contraseña debe tener al menos 8 caracteres.');
    if (next !== f.confirm.value) return showPwError('Las contraseñas no coinciden.');
    btn.disabled = true;
    try {
      const d = await call('POST', 'portal/password', { current: f.current.value, password: next });
      f.reset();
      toast('Contraseña guardada');
      renderHome(d);
    } catch (error) {
      if (error.status === 401 && /sesión/i.test(error.message)) {
        setToken('');
        showLogin('Tu sesión venció. Vuelve a ingresar.');
      } else {
        showPwError(error.message);
      }
    } finally {
      btn.disabled = false;
    }
  });

  function showPwError(message) {
    const el = $('passwordError');
    el.textContent = message;
    el.hidden = false;
  }

  $('logoutBtn').addEventListener('click', async () => {
    try { await call('POST', 'portal/logout'); } catch { /* si ya venció, igual se cierra */ }
    setToken('');
    showLogin();
  });

  // Arranque: con sesión guardada entra directo; si no, muestra el ingreso.
  if (getToken()) loadHome();
  else showLogin();
})();
