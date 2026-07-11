const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const FORMAS_PAGO = ['Efectivo', 'Tarjeta', 'Transferencia', 'Bizum'];
const ESTADOS = ['Pendiente', 'Pagado', 'Parcial'];
const MODALIDADES = ['Presencial', 'Online'];
const PSICOLOGAS = ['Isabel', 'Raquel', 'Te quiero mucho'];
const PRECIOS_SERVICIO = { individual: 65, pareja: 70 };

const ISABEL_EMAIL = 'iperezfraile@gmail.com'; // Directora: ve todo, se lleva el 40% restante
const DAVID_CENTRO = 'Centro David';
const DAVID_ALQUILER = 10;     // € fijos por sesión presencial en el centro de David
const DAVID_IRPF = 0.15;       // retención a David
const PSICOLOGA_PCT = 0.60;    // parte de la psicóloga sobre el importe ya sin el alquiler de David
const DIRECTORA_PCT = 0.40;    // parte de Isabel (directora) sobre ese mismo importe
const PSICOLOGA_IRPF = 0.07;   // retención a las psicólogas

let currentUserEmail = '';

function alquilerDavid(s) {
  return (s.centro === DAVID_CENTRO && s.modalidad === 'Presencial') ? DAVID_ALQUILER : 0;
}

// Desglose económico completo de una sesión
function sessionFinance(s) {
  const precio = parseFloat(s.precio) || 0;
  const alquiler = alquilerDavid(s);
  const irpfDavid = alquiler * DAVID_IRPF;
  const netoDavid = alquiler - irpfDavid;

  const base = precio - alquiler; // lo que queda tras descontar el alquiler a David
  const brutoPsicologa = base * PSICOLOGA_PCT;
  const brutoDirectora = base * DIRECTORA_PCT;
  const irpfPsicologa = brutoPsicologa * PSICOLOGA_IRPF;
  const netoPsicologa = brutoPsicologa - irpfPsicologa;

  return { precio, alquiler, irpfDavid, netoDavid, base, brutoPsicologa, brutoDirectora, irpfPsicologa, netoPsicologa };
}

function sumFinance(list) {
  return list.reduce((acc, s) => {
    const f = sessionFinance(s);
    acc.facturado += f.precio;
    acc.alquiler += f.alquiler;
    acc.irpfDavid += f.irpfDavid;
    acc.netoDavid += f.netoDavid;
    acc.brutoPsicologa += f.brutoPsicologa;
    acc.irpfPsicologa += f.irpfPsicologa;
    acc.netoPsicologa += f.netoPsicologa;
    acc.brutoDirectora += f.brutoDirectora;
    return acc;
  }, { facturado: 0, alquiler: 0, irpfDavid: 0, netoDavid: 0, brutoPsicologa: 0, irpfPsicologa: 0, netoPsicologa: 0, brutoDirectora: 0 });
}

const EMPTY_FORM = {
  id: null,
  fecha_sesion: new Date().toISOString().slice(0, 10),
  paciente: '',
  responsable_pago: '',
  psicologa: '',
  centro: '',
  modalidad: '',
  tipo_servicio: '',
  precio: '',
  forma_pago: '',
  fecha_ingreso_banco: '',
  estado_pago: 'Pendiente',
  quipu: false,
};

let sessions = [];
let search = '';
let searchScope = 'todos';
let estadoFilter = 'Todos';
let monthFilter = 'Todos';
let form = { ...EMPTY_FORM };
let modalOpen = false;

// ---------- Auth guard ----------
async function initAuth() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.href = 'login.html';
    return null;
  }
  document.getElementById('userLabel').textContent = `Conectado como ${data.session.user.email}`;
  currentUserEmail = (data.session.user.email || '').toLowerCase();
  return data.session;
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  window.location.href = 'login.html';
});

// ---------- Helpers ----------
function eur(n) {
  const v = parseFloat(n);
  if (isNaN(v)) return '0,00 €';
  return v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function monthLabel(dateStr) {
  if (!dateStr) return 'Sin fecha';
  const d = new Date(dateStr + 'T00:00:00');
  const label = d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Data loading ----------
async function loadSessions() {
  const { data, error } = await sb.from('sesiones').select('*').order('fecha_sesion', { ascending: false });
  if (error) {
    console.error(error);
    alert('Error cargando el registro: ' + error.message);
    return;
  }
  sessions = data || [];
  render();
}

document.getElementById('refreshBtn').addEventListener('click', loadSessions);

// Realtime: refresca automáticamente si otra persona del equipo cambia algo
function subscribeRealtime() {
  sb
    .channel('sesiones-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sesiones' }, () => loadSessions())
    .subscribe();
}

// ---------- CRUD ----------
async function saveForm(e) {
  e.preventDefault();
  if (!form.paciente || !form.fecha_sesion) return;

  const payload = {
    fecha_sesion: form.fecha_sesion,
    paciente: form.paciente,
    responsable_pago: form.responsable_pago,
    psicologa: form.psicologa,
    centro: form.centro,
    modalidad: form.modalidad,
    tipo_servicio: form.tipo_servicio,
    precio: parseFloat(form.precio) || 0,
    forma_pago: form.forma_pago,
    fecha_ingreso_banco: form.fecha_ingreso_banco || null,
    estado_pago: form.estado_pago,
    quipu: !!form.quipu,
    updated_at: new Date().toISOString(),
  };

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  let error;
  if (form.id) {
    ({ error } = await sb.from('sesiones').update(payload).eq('id', form.id));
  } else {
    ({ error } = await sb.from('sesiones').insert(payload));
  }

  if (error) {
    alert('Error guardando: ' + error.message);
    btn.disabled = false;
    btn.textContent = 'Guardar';
    return;
  }

  closeModal();
  loadSessions();
}

async function deleteSession(id) {
  if (!confirm('¿Eliminar esta sesión del registro?')) return;
  const { error } = await sb.from('sesiones').delete().eq('id', id);
  if (error) { alert('Error eliminando: ' + error.message); return; }
  loadSessions();
}

async function toggleQuipu(s) {
  const { error } = await sb.from('sesiones').update({ quipu: !s.quipu }).eq('id', s.id);
  if (error) { alert('Error actualizando: ' + error.message); return; }
  loadSessions();
}

// ---------- Filtering & stats ----------
function getOptions() {
  const pick = (key) => [...new Set(sessions.map((s) => s[key]).filter(Boolean))].sort();
  return {
    pacientes: pick('paciente'),
    psicologas: pick('psicologa'),
    centros: pick('centro'),
    tipos: pick('tipo_servicio'),
  };
}

function getFiltered() {
  return sessions.filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      const hay = searchScope === 'todos'
        ? `${s.paciente} ${s.responsable_pago} ${s.psicologa}`.toLowerCase()
        : String(s[searchScope] || '').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (estadoFilter !== 'Todos' && s.estado_pago !== estadoFilter) return false;
    if (monthFilter !== 'Todos' && monthLabel(s.fecha_sesion) !== monthFilter) return false;
    return true;
  });
}

function getStats() {
  const now = new Date();
  const raw = now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const thisMonthLabel = raw.charAt(0).toUpperCase() + raw.slice(1);
  const thisMonth = sessions.filter((s) => monthLabel(s.fecha_sesion) === thisMonthLabel);
  const cobrado = thisMonth.filter((s) => s.estado_pago === 'Pagado').reduce((a, s) => a + (parseFloat(s.precio) || 0), 0);
  const pendiente = thisMonth.filter((s) => s.estado_pago !== 'Pagado').reduce((a, s) => a + (parseFloat(s.precio) || 0), 0);
  const sinQuipu = sessions.filter((s) => s.estado_pago === 'Pagado' && !s.quipu).length;
  const f = sumFinance(thisMonth);
  return { count: thisMonth.length, cobrado, pendiente, sinQuipu, label: thisMonthLabel, thisMonthSessions: thisMonth, ...f };
}

function getPsicologaBreakdown(list) {
  const map = {};
  list.forEach((s) => {
    const key = (s.psicologa || '').trim() || 'Sin asignar';
    (map[key] = map[key] || []).push(s);
  });
  return Object.entries(map)
    .map(([name, rows]) => ({ name, count: rows.length, ...sumFinance(rows) }))
    .sort((a, b) => b.brutoPsicologa - a.brutoPsicologa);
}

// ---------- Rendering ----------
function render() {
  renderStats();
  renderFilters();
  renderTable();
}

function renderStats() {
  const s = getStats();
  const cards = [
    { label: s.label, value: String(s.count), sub: 'sesiones este mes', color: 'var(--blue)' },
    { label: 'Facturado', value: eur(s.facturado), sub: 'total del mes', color: 'var(--sage-deep)' },
    { label: 'Cobrado', value: eur(s.cobrado), sub: 'este mes', color: 'var(--sage)' },
    { label: 'Pendiente', value: eur(s.pendiente), sub: 'por cobrar este mes', color: 'var(--ochre)' },
    { label: 'Sin Quipu', value: String(s.sinQuipu), sub: 'pagos sin contabilizar', color: 'var(--stamp-red)' },
  ];
  document.getElementById('stats').innerHTML = cards.map((c) => `
    <div class="stat-card" style="border-left-color:${c.color};">
      <p class="mono" style="font-size:11px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.04em; margin:0;">${c.label}</p>
      <p class="serif" style="font-size:24px; margin:4px 0 0;">${c.value}</p>
      <p style="font-size:12px; color:var(--ink-soft); margin:2px 0 0;">${c.sub}</p>
    </div>
  `).join('');

  renderLiquidacion(s);
}

function liquidRow(label, value, opts = {}) {
  const strong = opts.strong ? 'font-weight:600;' : '';
  const color = opts.color ? `color:${opts.color};` : '';
  return `
    <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--line); ${strong}">
      <span style="font-size:13px; ${opts.sub ? 'color:var(--ink-soft); padding-left:14px;' : ''}">${label}</span>
      <span class="mono" style="font-size:13px; ${color} ${strong}">${eur(value)}</span>
    </div>`;
}

function splitBar(segments) {
  // segments: [{label, value, color}]
  const total = segments.reduce((a, s) => a + Math.max(s.value, 0), 0) || 1;
  const bar = segments.map((s) => `<div style="width:${(Math.max(s.value, 0) / total * 100).toFixed(2)}%; background:${s.color};" title="${s.label}: ${eur(s.value)}"></div>`).join('');
  const legend = segments.map((s) => `
    <div style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-soft);">
      <span style="width:10px; height:10px; border-radius:2px; background:${s.color}; display:inline-block;"></span>
      ${s.label} <span class="mono" style="color:var(--ink);">${eur(s.value)}</span>
    </div>`).join('');
  return `
    <div style="display:flex; height:14px; border-radius:4px; overflow:hidden; border:1px solid var(--line);">${bar}</div>
    <div style="display:flex; flex-wrap:wrap; gap:14px; margin-top:8px;">${legend}</div>`;
}

function renderLiquidacion(s) {
  const isabelView = currentUserEmail === ISABEL_EMAIL;
  const el = document.getElementById('liquidacion');
  if (!el) return;

  let html = `<h3 class="serif" style="font-size:17px; color:var(--sage-deep); margin:0 0 10px;">Liquidación · ${s.label}</h3>`;

  if (isabelView) {
    // Cifra destacada: lo que Isabel gana de verdad este mes, ya descontado todo
    html += `
      <div style="background:var(--sage-deep); border-radius:8px; padding:16px 18px; margin-bottom:16px; color:#fff;">
        <p class="mono" style="font-size:11px; text-transform:uppercase; letter-spacing:.04em; margin:0; opacity:.8;">Tu neto real este mes — ya descontado David y todas las psicólogas</p>
        <p class="serif" style="font-size:32px; margin:6px 0 0;">${eur(s.brutoDirectora)}</p>
      </div>`;

    html += splitBar([
      { label: 'David (alquiler)', value: s.alquiler, color: 'var(--blue)' },
      { label: 'Psicólogas (bruto)', value: s.brutoPsicologa, color: 'var(--ochre)' },
      { label: 'Tú (directora)', value: s.brutoDirectora, color: 'var(--sage-deep)' },
    ]);
    html += `<p style="font-size:11px; color:var(--ink-soft); margin:8px 0 18px;">Reparto del total facturado (${eur(s.facturado)}) este mes</p>`;

    html += `<p class="mono" style="font-size:11px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.04em; margin:0 0 8px;">Pago a cada psicóloga</p>`;
    const breakdown = getPsicologaBreakdown(s.thisMonthSessions);
    if (breakdown.length === 0) {
      html += `<p style="font-size:13px; color:var(--ink-soft);">Sin sesiones este mes.</p>`;
    } else {
      html += breakdown.map((p) => `
        <div style="border:1px solid var(--line); border-radius:6px; padding:10px 14px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; align-items:baseline;">
            <span style="font-weight:600; font-size:14px;">${esc(p.name)}</span>
            <span style="font-size:11px; color:var(--ink-soft);">${p.count} sesiones</span>
          </div>
          ${liquidRow('Bruto (60%)', p.brutoPsicologa, { sub: true })}
          ${liquidRow(`IRPF (${Math.round(PSICOLOGA_IRPF * 100)}%)`, -p.irpfPsicologa, { sub: true })}
          ${liquidRow('Neto a pagarle', p.netoPsicologa, { strong: true, color: 'var(--sage)' })}
        </div>`).join('');
    }

    html += `<div style="margin-top:14px; padding-top:10px; border-top:2px solid var(--sage-deep);">
      <p class="mono" style="font-size:11px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.04em; margin:0 0 6px;">Alquiler e impuestos</p>
    </div>`;
    html += liquidRow('Alquiler a David (bruto)', s.alquiler, { sub: true });
    html += liquidRow(`IRPF David (${Math.round(DAVID_IRPF * 100)}%)`, -s.irpfDavid, { sub: true });
    html += liquidRow('Neto a pagar a David', s.netoDavid, { sub: true });
    html += liquidRow('Total IRPF a pagar a Hacienda', s.irpfDavid + s.irpfPsicologa, { strong: true, color: 'var(--stamp-red)' });
  } else {
    html += liquidRow('Facturado (bruto)', s.facturado, { strong: true });
    if (s.alquiler > 0) html += liquidRow('Alquiler a David descontado', -s.alquiler, { sub: true });
    html += liquidRow(`Tu parte bruta (${Math.round(PSICOLOGA_PCT * 100)}%)`, s.brutoPsicologa);
    html += liquidRow(`IRPF retenido (${Math.round(PSICOLOGA_IRPF * 100)}%)`, -s.irpfPsicologa, { sub: true });
    html += liquidRow('Neto a cobrar', s.netoPsicologa, { strong: true, color: 'var(--sage)' });
  }

  el.innerHTML = html;
}

function renderFilters() {
  const months = [...new Set(sessions.map((s) => monthLabel(s.fecha_sesion)))];
  const estadoSel = document.getElementById('estadoFilter');
  const monthSel = document.getElementById('monthFilter');
  estadoSel.innerHTML = ['Todos', ...ESTADOS].map((e) => `<option ${e === estadoFilter ? 'selected' : ''}>${e}</option>`).join('');
  monthSel.innerHTML = ['Todos', ...months].map((m) => `<option ${m === monthFilter ? 'selected' : ''}>${m}</option>`).join('');
}

function renderTable() {
  const filtered = getFiltered().sort((a, b) => (b.fecha_sesion || '').localeCompare(a.fecha_sesion || ''));
  const container = document.getElementById('tableContainer');

  if (sessions.length === 0) {
    container.innerHTML = `<div class="card" style="text-align:center; padding:60px 20px; border-style:dashed;">
      <p class="serif" style="font-size:18px; margin:0;">Aún no hay sesiones registradas</p>
      <p style="font-size:13px; color:var(--ink-soft); margin:6px 0 0;">Pulsa "+ Nueva sesión" para añadir la primera</p>
    </div>`;
    return;
  }

  const grouped = {};
  filtered.forEach((s) => {
    const key = monthLabel(s.fecha_sesion);
    (grouped[key] = grouped[key] || []).push(s);
  });

  const estadoStyles = {
    Pagado: 'color:var(--sage); background:#E3F3F0; border-color:var(--sage);',
    Pendiente: 'color:var(--ochre); background:var(--ochre-bg); border-color:var(--ochre);',
    Parcial: 'color:var(--blue); background:#E7ECF1; border-color:var(--blue);',
  };

  const isabelView = currentUserEmail === ISABEL_EMAIL;
  const headers = ['Fecha', 'Paciente', 'Responsable', 'Psicóloga', 'Centro', 'Modalidad', 'Servicio', 'Precio', 'Forma pago', 'Ingreso banco', 'Estado', 'Quipu', ''];
  if (isabelView) headers.splice(3, 0, 'Introducido por');

  container.innerHTML = Object.entries(grouped).map(([month, rows]) => `
    <div style="margin-bottom:28px;">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid var(--sage-deep); padding-bottom:6px; margin-bottom:8px;">
        <h2 class="serif" style="font-size:18px; color:var(--sage-deep); margin:0;">${month}</h2>
        <span class="mono" style="font-size:12px; color:var(--ink-soft);">${rows.length} sesiones</span>
      </div>
      <div class="card table-scroll">
        <table>
          <thead><tr>
            ${headers.map((h) => `<th>${h}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${rows.map((s) => `
              <tr>
                <td class="mono" style="white-space:nowrap;">${s.fecha_sesion}</td>
                <td style="font-weight:500;">${esc(s.paciente)}</td>
                <td>${esc(s.responsable_pago)}</td>
                ${isabelView ? `<td style="font-size:12px; color:var(--ink-soft);">${esc(s.creado_por || '')}</td>` : ''}
                <td>${esc(s.psicologa)}</td>
                <td>${esc(s.centro)}${alquilerDavid(s) ? `<br><span class="stamp" style="color:var(--blue); background:#E7ECF1; border-color:var(--blue); font-size:9px; margin-top:2px;">+${DAVID_ALQUILER}€ David</span>` : ''}</td>
                <td>${esc(s.modalidad)}</td>
                <td>${esc(s.tipo_servicio)}</td>
                <td class="mono" style="white-space:nowrap;">${eur(s.precio)}</td>
                <td>${esc(s.forma_pago)}</td>
                <td class="mono" style="white-space:nowrap;">${s.fecha_ingreso_banco || '—'}</td>
                <td><span class="stamp" style="${estadoStyles[s.estado_pago] || estadoStyles.Pendiente}">${s.estado_pago}</span></td>
                <td style="text-align:center;">
                  <span class="quipu-mark ${s.quipu ? 'on' : ''}" data-toggle-quipu="${s.id}">${s.quipu ? '✓' : ''}</span>
                </td>
                <td style="white-space:nowrap;">
                  <button data-edit="${s.id}" style="background:none; color:var(--sage-deep); padding:2px 4px;">✎</button>
                  <button data-delete="${s.id}" style="background:none; color:var(--stamp-red); padding:2px 4px;">✕</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-toggle-quipu]').forEach((el) => {
    el.addEventListener('click', () => {
      const s = sessions.find((x) => x.id === el.dataset.toggleQuipu);
      if (s) toggleQuipu(s);
    });
  });
  container.querySelectorAll('[data-edit]').forEach((el) => {
    el.addEventListener('click', () => {
      const s = sessions.find((x) => x.id === el.dataset.edit);
      if (s) openModal(s);
    });
  });
  container.querySelectorAll('[data-delete]').forEach((el) => {
    el.addEventListener('click', () => deleteSession(el.dataset.delete));
  });
}

// ---------- Modal form ----------
function fieldHtml(label, inputHtml) {
  return `<div class="field">${`<label>${label}</label>`}${inputHtml}</div>`;
}

function openModal(existing) {
  form = existing ? { ...existing, precio: String(existing.precio ?? '') } : { ...EMPTY_FORM };
  modalOpen = true;
  renderModal();
}

function closeModal() {
  modalOpen = false;
  document.getElementById('modalRoot').innerHTML = '';
}

function renderModal() {
  if (!modalOpen) { document.getElementById('modalRoot').innerHTML = ''; return; }
  const o = getOptions();
  const dl = (id, arr) => `<datalist id="${id}">${arr.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;

  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-overlay" id="overlay">
      <form class="modal" id="sessionForm">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
          <h3 class="serif" style="font-size:20px; color:var(--sage-deep); margin:0;">${form.id ? 'Editar sesión' : 'Nueva sesión'}</h3>
          <button type="button" id="closeModalBtn" style="background:none; font-size:18px; line-height:1;">✕</button>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          ${fieldHtml('Fecha sesión', `<input type="date" name="fecha_sesion" required value="${esc(form.fecha_sesion)}" />`)}
          ${fieldHtml('Nombre paciente', `<input name="paciente" list="dl_pacientes" required placeholder="Nombre y apellidos" value="${esc(form.paciente)}" />${dl('dl_pacientes', o.pacientes)}<span style="font-size:11px; color:var(--ink-soft); display:block; margin-top:2px;">Usa nombre y apellidos para no confundir a pacientes con el mismo nombre de pila</span>`)}
          ${fieldHtml('Responsable de pago', `<input name="responsable_pago" value="${esc(form.responsable_pago)}" />`)}
          ${fieldHtml('Psicóloga', `<input name="psicologa" list="dl_psicologas" value="${esc(form.psicologa)}" />${dl('dl_psicologas', [...new Set([...PSICOLOGAS, ...o.psicologas])])}`)}
          ${fieldHtml('Centro', `<input name="centro" list="dl_centros" value="${esc(form.centro)}" />${dl('dl_centros', [...new Set([DAVID_CENTRO, 'Online', ...o.centros])])}`)}
          ${fieldHtml('Modalidad', `<select name="modalidad"><option value="">—</option>${MODALIDADES.map((m) => `<option ${m === form.modalidad ? 'selected' : ''}>${m}</option>`).join('')}</select>`)}
          ${fieldHtml('Tipo de servicio', `<input name="tipo_servicio" list="dl_tipos" value="${esc(form.tipo_servicio)}" placeholder="Individual / Pareja / otro" />${dl('dl_tipos', [...new Set(['Individual', 'Pareja', ...o.tipos])])}<span style="font-size:11px; color:var(--ink-soft); display:block; margin-top:2px;">Individual 65€ · Pareja 70€ (autocompleta el precio)</span>`)}
          ${fieldHtml('Precio (€)', `<input type="number" step="0.01" min="0" name="precio" value="${esc(form.precio)}" />`)}
          ${fieldHtml('Forma de pago', `<select name="forma_pago"><option value="">—</option>${FORMAS_PAGO.map((f) => `<option ${f === form.forma_pago ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}
          ${fieldHtml('Fecha ingreso banco', `<input type="date" name="fecha_ingreso_banco" value="${esc(form.fecha_ingreso_banco || '')}" />`)}
          ${fieldHtml('Estado pago', `<select name="estado_pago">${ESTADOS.map((f) => `<option ${f === form.estado_pago ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}
          <div class="field">
            <label>Contabilizado en Quipu</label>
            <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
              <input type="checkbox" name="quipu" style="width:auto;" ${form.quipu ? 'checked' : ''} />
              <span style="font-size:14px;">${form.quipu ? 'Sí' : 'No'}</span>
            </label>
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
          <button type="button" class="btn-secondary" id="cancelBtn">Cancelar</button>
          <button type="submit" class="btn-primary" id="saveBtn">${form.id ? 'Guardar cambios' : 'Añadir sesión'}</button>
        </div>
      </form>
    </div>
  `;

  const formEl = document.getElementById('sessionForm');

  formEl.paciente.addEventListener('blur', () => {
    if (!formEl.responsable_pago.value) formEl.responsable_pago.value = formEl.paciente.value;
  });
  formEl.tipo_servicio.addEventListener('blur', () => {
    const key = formEl.tipo_servicio.value.trim().toLowerCase();
    if (PRECIOS_SERVICIO[key] != null) formEl.precio.value = PRECIOS_SERVICIO[key];
  });
  formEl.fecha_ingreso_banco.addEventListener('change', () => {
    if (formEl.fecha_ingreso_banco.value && formEl.estado_pago.value === 'Pendiente') {
      formEl.estado_pago.value = 'Pagado';
    }
  });

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    form = {
      ...form,
      fecha_sesion: formEl.fecha_sesion.value,
      paciente: formEl.paciente.value,
      responsable_pago: formEl.responsable_pago.value,
      psicologa: formEl.psicologa.value,
      centro: formEl.centro.value,
      modalidad: formEl.modalidad.value,
      tipo_servicio: formEl.tipo_servicio.value,
      precio: formEl.precio.value,
      forma_pago: formEl.forma_pago.value,
      fecha_ingreso_banco: formEl.fecha_ingreso_banco.value,
      estado_pago: formEl.estado_pago.value,
      quipu: formEl.quipu.checked,
    };
    saveForm(e);
  });

  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
}

// ---------- Excel export ----------
function exportExcel() {
  const filtered = getFiltered();
  const f = sumFinance(filtered);
  const isabelView = currentUserEmail === ISABEL_EMAIL;

  const headers = ['Fecha sesión', 'Paciente', 'Responsable pago', 'Psicóloga', 'Centro', 'Modalidad', 'Tipo servicio', 'Precio', 'Alquiler David', 'Bruto psicóloga (60%)', 'IRPF psicóloga (7%)', 'Neto psicóloga', 'Forma de pago', 'Fecha ingreso banco', 'Estado pago', 'Contabilizado Quipu', 'Introducido por'];
  const dataRows = filtered.map((s) => {
    const sf = sessionFinance(s);
    return [
      s.fecha_sesion, s.paciente, s.responsable_pago, s.psicologa, s.centro, s.modalidad, s.tipo_servicio,
      sf.precio, sf.alquiler, sf.brutoPsicologa, sf.irpfPsicologa, sf.netoPsicologa,
      s.forma_pago, s.fecha_ingreso_banco || '', s.estado_pago, s.quipu ? 'Sí' : 'No', s.creado_por || '',
    ];
  });

  const summary = [
    ['Resumen', ''],
    ['Total facturado (bruto)', f.facturado],
    ['Alquiler a David (bruto)', f.alquiler],
    [`IRPF David (${Math.round(DAVID_IRPF * 100)}%)`, -f.irpfDavid],
    ['Neto a pagar a David', f.netoDavid],
    [`Bruto psicólogas (${Math.round(PSICOLOGA_PCT * 100)}%)`, f.brutoPsicologa],
    [`IRPF psicólogas (${Math.round(PSICOLOGA_IRPF * 100)}%)`, -f.irpfPsicologa],
    ['Neto a cobrar psicólogas', f.netoPsicologa],
  ];
  if (isabelView) {
    summary.push([`Parte directora (${Math.round(DIRECTORA_PCT * 100)}%)`, f.brutoDirectora]);
    summary.push(['Total IRPF a pagar a Hacienda', f.irpfDavid + f.irpfPsicologa]);
  }
  summary.push([], headers, ...dataRows);

  const ws = XLSX.utils.aoa_to_sheet(summary);
  ws['!cols'] = [{ wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registro');
  XLSX.writeFile(wb, `registro-pagos-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------- Event bindings ----------
document.getElementById('searchInput').addEventListener('input', (e) => { search = e.target.value; renderTable(); });
document.getElementById('searchScope').addEventListener('change', (e) => { searchScope = e.target.value; renderTable(); });
document.getElementById('estadoFilter').addEventListener('change', (e) => { estadoFilter = e.target.value; renderTable(); });
document.getElementById('monthFilter').addEventListener('change', (e) => { monthFilter = e.target.value; renderTable(); });
document.getElementById('newBtn').addEventListener('click', () => openModal(null));
document.getElementById('exportBtn').addEventListener('click', exportExcel);

// ---------- Boot ----------
(async function boot() {
  const session = await initAuth();
  if (!session) return;
  await loadSessions();
  subscribeRealtime();
})();
