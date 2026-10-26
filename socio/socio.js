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

  function showView(name) {
    document.querySelectorAll('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== name; });
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

  function renderHome(d) {
    const first = String(d.client?.name || '').split(' ')[0];
    $('greet').textContent = first ? `Hola, ${first}` : 'Hola';
    const labels = { activa: 'Activa', por_vencer: 'Por vencer', vencida: 'Vencida', sin_membresia: 'Sin membresía' };
    const tone = { activa: 'ok', por_vencer: 'warn', vencida: 'bad', sin_membresia: 'bad' };
    const m = d.membership || {};
    $('status').className = 'pill ' + (tone[m.status] || '');
    $('status').textContent = labels[m.status] || '—';
    let planText = m.plan ? `${m.plan} · vence ${fmtDate(m.end_date)}` : 'Sin membresía registrada';
    if (m.status === 'por_vencer' && m.days_left != null) planText += ` · faltan ${m.days_left} día(s)`;
    $('plan').textContent = planText;

    if (d.card?.code) {
      $('qrWrap').hidden = false;
      $('noCard').hidden = true;
      $('qrImg').src = qrDataUrl(d.card.code);
      $('qrCode').textContent = d.card.code;
    } else {
      $('qrWrap').hidden = true;
      $('noCard').hidden = false;
      $('qrImg').removeAttribute('src');
      $('qrCode').textContent = '';
    }

    const gym = d.gym || {};
    $('gymName').textContent = gym.name || 'Mission Fit Panamá';
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

  function showLogin(message) {
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
