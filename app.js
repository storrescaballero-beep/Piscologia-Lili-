const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const FORMAS_PAGO = ['Efectivo', 'Tarjeta', 'Transferencia', 'Bizum'];
const ESTADOS = ['Pendiente', 'Pagado', 'Parcial'];
const MODALIDADES = ['Presencial', 'Online'];
const PSICOLOGAS = ['Isabel', 'Raquel', 'Te quiero mucho'];
const PRECIOS_SERVICIO = { individual: 65, pareja: 70 };

// ---------- Reglas fiscales verificadas (autónomos, IRPF, 2026) ----------
const CATEGORIAS_GASTO = ['Alquiler', 'Suministros', 'Material', 'Formación', 'Software', 'Dietas/Manutención', 'Regalos a pacientes', 'Kit Digital', 'Otros'];
const SUMINISTROS_PORCENTAJE = 0.30; // % fijo que aplica Hacienda sobre la parte de vivienda afecta
const DIETA_LIMITES = {
  Espana: { sinPernocta: 26.67, conPernocta: 53.34 },
  Extranjero: { sinPernocta: 48.08, conPernocta: 91.35 },
};
const REGALOS_LIMITE_PCT = 0.01; // 1% de la cifra de negocio anual (atenciones a clientes)

// Gastos de difícil justificación — OJO: son dos cifras distintas, no confundir
const GASTOS_DIFICIL_JUST_IRPF_PCT = 0.05; // para Modelo 130 / Renta, tope 2.000€/año
const GASTOS_DIFICIL_JUST_IRPF_TOPE = 2000;
const GASTOS_GENERICOS_RETA_PCT = 0.07; // para calcular el tramo de cotización (sin tope)

// Cuota de autónomos 2026 (RETA) — 15 tramos, cifras aproximadas de la base mínima + MEI 0,9%.
// Son orientativas: la cifra exacta puede variar, confirmar con la Seguridad Social o el gestor.
const RETA_TRAMOS = [
  { hasta: 670, cuota: 205.88 },
  { hasta: 900, cuota: 220.36 },
  { hasta: 1166.70, cuota: 260.24 },
  { hasta: 1300, cuota: 275.61 },
  { hasta: 1500, cuota: 291.66 },
  { hasta: 1700, cuota: 302.00 },
  { hasta: 1850, cuota: 320.02 },
  { hasta: 2030, cuota: 340.00 },
  { hasta: 2330, cuota: 380.00 },
  { hasta: 2760, cuota: 423.30 },
  { hasta: 3190, cuota: 463.00 },
  { hasta: 3620, cuota: 503.00 },
  { hasta: 4050, cuota: 544.00 },
  { hasta: 6000, cuota: 590.00 },
  { hasta: Infinity, cuota: 607.35 },
];

const AMORTIZACION_TIPOS = {
  'Equipo informático (25%/año, 4 años)': 0.25,
  'Mobiliario (10%/año, 10 años)': 0.10,
  'Personalizado': null,
};

const CALENDARIO_FISCAL = [
  { modelo: 'Modelo 130 (4º trim. año anterior)', mesInicio: 0, diaInicio: 1, mesFin: 0, diaFin: 30 },
  { modelo: 'Modelo 111 (4º trim. año anterior)', mesInicio: 0, diaInicio: 1, mesFin: 0, diaFin: 30 },
  { modelo: 'Modelo 190 (resumen anual)', mesInicio: 0, diaInicio: 1, mesFin: 0, diaFin: 31 },
  { modelo: 'Modelo 130 (1er trimestre)', mesInicio: 3, diaInicio: 1, mesFin: 3, diaFin: 20 },
  { modelo: 'Modelo 111 (1er trimestre)', mesInicio: 3, diaInicio: 1, mesFin: 3, diaFin: 20 },
  { modelo: 'Renta (IRPF anual)', mesInicio: 3, diaInicio: 1, mesFin: 5, diaFin: 30 },
  { modelo: 'Modelo 130 (2º trimestre)', mesInicio: 6, diaInicio: 1, mesFin: 6, diaFin: 20 },
  { modelo: 'Modelo 111 (2º trimestre)', mesInicio: 6, diaInicio: 1, mesFin: 6, diaFin: 20 },
  { modelo: 'Modelo 130 (3er trimestre)', mesInicio: 9, diaInicio: 1, mesFin: 9, diaFin: 20 },
  { modelo: 'Modelo 111 (3er trimestre)', mesInicio: 9, diaInicio: 1, mesFin: 9, diaFin: 20 },
];

const ISABEL_EMAIL = 'iperezfraile@gmail.com'; // Directora: ve todo, se lleva el 40% restante
const DAVID_CENTRO = 'Centro David';
const DAVID_ALQUILER = 10;     // € fijos por sesión presencial en el centro de David
const DAVID_IRPF = 0.15;       // retención a David
const PSICOLOGA_PCT = 0.60;    // parte de la psicóloga sobre el importe ya sin el alquiler de David
const DIRECTORA_PCT = 0.40;    // parte de Isabel (directora) sobre ese mismo importe
const PSICOLOGA_IRPF = 0.07;   // retención a las psicólogas

let currentUserEmail = '';
let periodoModo = 'mes'; // 'mes' | 'anio'
let periodoAnio = new Date().getFullYear();

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
  if (currentUserEmail === ISABEL_EMAIL) {
    document.getElementById('fiscalBtn').style.display = 'inline-block';
    document.getElementById('gastosBtn').style.display = 'inline-block';
    document.getElementById('asistenteBtn').style.display = 'inline-block';
  }
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

function getPeriodSessions() {
  const now = new Date();
  if (periodoModo === 'mes') {
    return sessions.filter((s) => {
      const d = new Date(s.fecha_sesion + 'T00:00:00');
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  }
  return sessions.filter((s) => new Date(s.fecha_sesion + 'T00:00:00').getFullYear() === periodoAnio);
}

function getPeriodGastos() {
  const now = new Date();
  if (periodoModo === 'mes') {
    return gastos.filter((g) => {
      const d = new Date(g.fecha_gasto + 'T00:00:00');
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  }
  return gastos.filter((g) => new Date(g.fecha_gasto + 'T00:00:00').getFullYear() === periodoAnio);
}

function periodoLabel() {
  if (periodoModo === 'mes') {
    const raw = new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return `Año ${periodoAnio}`;
}

function getStats() {
  const periodo = getPeriodSessions();
  const cobrado = periodo.filter((s) => s.estado_pago === 'Pagado').reduce((a, s) => a + (parseFloat(s.precio) || 0), 0);
  const pendiente = periodo.filter((s) => s.estado_pago !== 'Pagado').reduce((a, s) => a + (parseFloat(s.precio) || 0), 0);
  const sinQuipu = sessions.filter((s) => s.estado_pago === 'Pagado' && !s.quipu).length;
  const f = sumFinance(periodo);
  const totalGastos = getPeriodGastos().reduce((a, g) => a + (parseFloat(g.importe) || 0), 0);
  return { count: periodo.length, cobrado, pendiente, sinQuipu, label: periodoLabel(), thisMonthSessions: periodo, totalGastos, ...f };
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

function renderPeriodoSelector() {
  const el = document.getElementById('periodoSelector');
  if (!el) return;
  const anios = [...new Set([
    ...sessions.map((s) => new Date(s.fecha_sesion + 'T00:00:00').getFullYear()),
    ...gastos.map((g) => new Date(g.fecha_gasto + 'T00:00:00').getFullYear()),
  ])].sort((a, b) => b - a);
  if (anios.length === 0) anios.push(new Date().getFullYear());

  el.innerHTML = `
    <select id="periodoModoSel" style="width:auto;">
      <option value="mes" ${periodoModo === 'mes' ? 'selected' : ''}>Este mes</option>
      <option value="anio" ${periodoModo === 'anio' ? 'selected' : ''}>Año</option>
    </select>
    ${periodoModo === 'anio' ? `<select id="periodoAnioSel" style="width:auto;">${anios.map((y) => `<option value="${y}" ${y === periodoAnio ? 'selected' : ''}>${y}</option>`).join('')}</select>` : ''}
  `;
  document.getElementById('periodoModoSel').addEventListener('change', (e) => {
    periodoModo = e.target.value;
    render();
  });
  if (periodoModo === 'anio') {
    document.getElementById('periodoAnioSel').addEventListener('change', (e) => {
      periodoAnio = parseInt(e.target.value);
      render();
    });
  }
}


// ---------- Rendering ----------
function render() {
  renderPeriodoSelector();
  renderStats();
  renderFilters();
  renderTable();
}

function renderStats() {
  const s = getStats();
  const isabelView = currentUserEmail === ISABEL_EMAIL;
  const subPeriodo = periodoModo === 'mes' ? 'este mes' : `en ${periodoAnio}`;
  const cards = [
    { label: s.label, value: String(s.count), sub: 'sesiones', color: 'var(--blue)' },
    { label: 'Facturado', value: eur(s.facturado), sub: subPeriodo, color: 'var(--sage-deep)' },
    { label: 'Cobrado', value: eur(s.cobrado), sub: subPeriodo, color: 'var(--sage)' },
    { label: 'Pendiente', value: eur(s.pendiente), sub: `por cobrar ${subPeriodo}`, color: 'var(--ochre)' },
    { label: 'Sin Quipu', value: String(s.sinQuipu), sub: 'pagos sin contabilizar', color: 'var(--stamp-red)' },
  ];
  if (isabelView) {
    cards.push({ label: 'Gastos', value: eur(s.totalGastos), sub: subPeriodo, color: 'var(--stamp-red)' });
  }
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
    const netoTrasGastos = s.brutoDirectora - s.totalGastos;
    // Cifra destacada: lo que Isabel gana de verdad este mes, ya descontado todo
    html += `
      <div style="background:var(--sage-deep); border-radius:8px; padding:16px 18px; margin-bottom:16px; color:#fff;">
        <p class="mono" style="font-size:11px; text-transform:uppercase; letter-spacing:.04em; margin:0; opacity:.8;">Tu neto real — ya descontado David, las psicólogas y tus gastos</p>
        <p class="serif" style="font-size:32px; margin:6px 0 0;">${eur(netoTrasGastos)}</p>
      </div>`;

    html += splitBar([
      { label: 'David (alquiler)', value: s.alquiler, color: 'var(--blue)' },
      { label: 'Psicólogas (bruto)', value: s.brutoPsicologa, color: 'var(--ochre)' },
      { label: 'Tú (directora)', value: s.brutoDirectora, color: 'var(--sage-deep)' },
    ]);
    html += `<p style="font-size:11px; color:var(--ink-soft); margin:8px 0 18px;">Reparto del total facturado (${eur(s.facturado)})</p>`;

    html += liquidRow('Tu parte como directora (bruto)', s.brutoDirectora, { strong: true });
    html += liquidRow('Gastos del periodo', -s.totalGastos, { sub: true, color: 'var(--stamp-red)' });
    html += liquidRow('Tu neto tras gastos', netoTrasGastos, { strong: true, color: 'var(--sage)' });

    html += `<p class="mono" style="font-size:11px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.04em; margin:16px 0 8px;">Pago a cada psicóloga</p>`;
    const breakdown = getPsicologaBreakdown(s.thisMonthSessions);
    if (breakdown.length === 0) {
      html += `<p style="font-size:13px; color:var(--ink-soft);">Sin sesiones en este periodo.</p>`;
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

// ---------- Modelos fiscales (solo Isabel) ----------
let fiscalDatos = {}; // { persona: { nif, clave, subclave } }
let fiscalTab = 'config';
let fiscalYear = new Date().getFullYear();
let fiscalQuarter = Math.floor(new Date().getMonth() / 3) + 1;
let calc130YaPagado = 0;
let calc130Retenciones = 0;
let calcCuotaRendimiento = '';
let calcAmortImporte = '';
let calcAmortTipo = Object.keys(AMORTIZACION_TIPOS)[0];
let calcAmortPersonalizadoPct = '';

async function loadFiscalDatos() {
  try {
    const { data, error } = await sb.from('fiscal_datos').select('*');
    if (error) throw error;
    fiscalDatos = {};
    (data || []).forEach((row) => { fiscalDatos[row.persona] = row; });
  } catch (e) {
    console.error('Error cargando datos fiscales', e);
  }
}

async function saveFiscalDato(persona, patch) {
  const current = fiscalDatos[persona] || { persona, nif: '', clave: 'G', subclave: '01' };
  const next = { ...current, ...patch, persona };
  const { error } = await sb.from('fiscal_datos').upsert(next);
  if (error) { alert('Error guardando dato fiscal: ' + error.message); return; }
  fiscalDatos[persona] = next;
}

function getAllPersonas() {
  const psicologasEnUso = [...new Set(sessions.map((s) => (s.psicologa || '').trim()).filter(Boolean))];
  return ['David', ...psicologasEnUso.sort()];
}

function sessionQuarter(fechaStr) {
  const d = new Date(fechaStr + 'T00:00:00');
  return Math.floor(d.getMonth() / 3) + 1;
}

function getQuarterSessions(year, quarter) {
  return sessions.filter((s) => {
    const d = new Date(s.fecha_sesion + 'T00:00:00');
    return d.getFullYear() === year && sessionQuarter(s.fecha_sesion) === quarter;
  });
}

function getYearSessions(year) {
  return sessions.filter((s) => new Date(s.fecha_sesion + 'T00:00:00').getFullYear() === year);
}

function computeModelo111(list) {
  let davidBase = 0, davidRet = 0;
  const psicoMap = {}; // persona -> {base, ret}
  list.forEach((s) => {
    const f = sessionFinance(s);
    davidBase += f.alquiler;
    davidRet += f.irpfDavid;
    const nombre = (s.psicologa || '').trim();
    if (nombre) {
      if (!psicoMap[nombre]) psicoMap[nombre] = { base: 0, ret: 0 };
      psicoMap[nombre].base += f.brutoPsicologa;
      psicoMap[nombre].ret += f.irpfPsicologa;
    }
  });
  const psicoBaseTotal = Object.values(psicoMap).reduce((a, p) => a + p.base, 0);
  const psicoRetTotal = Object.values(psicoMap).reduce((a, p) => a + p.ret, 0);
  const nPerceptores = (davidBase > 0 ? 1 : 0) + Object.values(psicoMap).filter((p) => p.base > 0).length;
  return {
    casilla07: nPerceptores,
    casilla08: davidBase + psicoBaseTotal,
    casilla09: davidRet + psicoRetTotal,
    casilla28: davidRet + psicoRetTotal,
    davidBase, davidRet, psicoMap,
  };
}

function computeModelo190(list) {
  const m111 = computeModelo111(list);
  const rows = [];
  if (m111.davidBase > 0) {
    const fd = fiscalDatos['David'] || {};
    rows.push({ persona: 'David', nif: fd.nif || '', clave: fd.clave || 'G', subclave: fd.subclave || '01', base: m111.davidBase, retencion: m111.davidRet });
  }
  Object.entries(m111.psicoMap).forEach(([nombre, v]) => {
    if (v.base <= 0) return;
    const fd = fiscalDatos[nombre] || {};
    rows.push({ persona: nombre, nif: fd.nif || '', clave: fd.clave || 'G', subclave: fd.subclave || '03', base: v.base, retencion: v.ret });
  });
  return rows;
}

function openFiscalModal() {
  fiscalTab = 'config';
  renderFiscalModal();
}
function closeFiscalModal() {
  document.getElementById('fiscalModalRoot').innerHTML = '';
}

function fiscalRow(label, value) {
  return `<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--line);">
    <span style="font-size:13px; color:var(--ink-soft);">${label}</span>
    <span class="mono" style="font-size:14px; font-weight:600;">${value}</span>
  </div>`;
}

function renderFiscalModal() {
  const years = [...new Set(sessions.map((s) => new Date(s.fecha_sesion + 'T00:00:00').getFullYear()))].sort((a, b) => b - a);
  if (years.length === 0) years.push(fiscalYear);

  const tabs = [
    { id: 'config', label: 'Datos fiscales' },
    { id: '111', label: 'Modelo 111 (trimestral)' },
    { id: '190', label: 'Modelo 190 (anual)' },
    { id: 'calc', label: 'Calculadoras' },
  ];

  let body = '';

  if (fiscalTab === 'config') {
    const personas = getAllPersonas();
    const decl = fiscalDatos['__DECLARANTE__'] || { nif: '', nombre: '', porcentaje_vivienda: '' };
    body = `
      <div style="border:2px solid var(--sage-deep); border-radius:6px; padding:12px 14px; margin-bottom:18px;">
        <p style="font-weight:600; margin:0 0 8px; color:var(--sage-deep);">Tus datos como declarante (Isabel)</p>
        <p style="font-size:12px; color:var(--ink-soft); margin:0 0 10px;">Se usan para rellenar automáticamente el Modelo 190 y calcular deducciones.</p>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="field"><label>Tu NIF</label><input id="declaranteNif" value="${esc(decl.nif || '')}" /></div>
          <div class="field"><label>Nombre completo</label><input id="declaranteNombre" value="${esc(decl.nombre || '')}" /></div>
          <div class="field">
            <label>% de tu vivienda destinado a la actividad</label>
            <input id="declaranteVivienda" type="number" step="0.1" min="0" max="100" value="${esc(decl.porcentaje_vivienda ?? '')}" placeholder="ej: 20" />
            <span style="font-size:11px; color:var(--ink-soft); display:block; margin-top:2px;">Debe coincidir con lo declarado en tu modelo 036/037</span>
          </div>
        </div>
        <button id="saveDeclaranteBtn" class="btn-primary" style="margin-top:10px;">Guardar mis datos</button>
      </div>
    `;
    body += `<p style="font-size:13px; color:var(--ink-soft); margin:0 0 14px;">NIF y tipo de retención de cada persona. Se guarda una vez y se usa en los modelos.</p>`;
    body += personas.map((p) => {
      const fd = fiscalDatos[p] || { nif: '', clave: 'G', subclave: p === 'David' ? '01' : '03' };
      return `
        <div style="border:1px solid var(--line); border-radius:6px; padding:10px 14px; margin-bottom:8px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; align-items:end;">
          <div class="field"><label>${esc(p)}</label>
            <input value="${esc(fd.nif || '')}" placeholder="NIF" data-fiscal-nif="${esc(p)}" />
          </div>
          <div class="field"><label>Subclave (retención)</label>
            <select data-fiscal-subclave="${esc(p)}">
              <option value="01" ${fd.subclave === '01' ? 'selected' : ''}>G01 · General (15%)</option>
              <option value="03" ${fd.subclave === '03' ? 'selected' : ''}>G03 · Inicio actividad (7%)</option>
            </select>
          </div>
          <button data-fiscal-save="${esc(p)}" class="btn-primary" style="height:38px;">Guardar</button>
        </div>`;
    }).join('');
  }

  if (fiscalTab === '111') {
    const m = computeModelo111(getQuarterSessions(fiscalYear, fiscalQuarter));
    body = `
      <div class="no-print" style="display:flex; gap:10px; margin-bottom:16px;">
        <select id="fiscalYearSel111">${years.map((y) => `<option value="${y}" ${y === fiscalYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <select id="fiscalQuarterSel">${[1, 2, 3, 4].map((q) => `<option value="${q}" ${q === fiscalQuarter ? 'selected' : ''}>${q}º Trimestre</option>`).join('')}</select>
      </div>
      <p style="font-size:12px; color:var(--ink-soft); margin:0 0 10px;">II. Rendimientos de actividades económicas — apartado del Modelo 111</p>
      ${fiscalRow('Casilla 07 · Nº perceptores', m.casilla07)}
      ${fiscalRow('Casilla 08 · Base total', eur(m.casilla08))}
      ${fiscalRow('Casilla 09 · Retenciones', eur(m.casilla09))}
      ${fiscalRow('Casilla 28 · Total a ingresar', eur(m.casilla28))}
      <p style="font-size:11px; color:var(--ink-soft); margin:14px 0 6px;">Desglose (referencia interna, no va en el modelo):</p>
      ${m.davidBase > 0 ? fiscalRow('David — base / retención', `${eur(m.davidBase)} / ${eur(m.davidRet)}`) : ''}
      ${Object.entries(m.psicoMap).filter(([, v]) => v.base > 0).map(([n, v]) => fiscalRow(`${n} — base / retención`, `${eur(v.base)} / ${eur(v.ret)}`)).join('')}
    `;
  }

  if (fiscalTab === '190') {
    const rows190 = computeModelo190(getYearSessions(fiscalYear));
    const totalBase = rows190.reduce((a, r) => a + r.base, 0);
    const totalRet = rows190.reduce((a, r) => a + r.retencion, 0);
    body = `
      <div class="no-print" style="margin-bottom:16px;">
        <select id="fiscalYearSel190">${years.map((y) => `<option value="${y}" ${y === fiscalYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      <div class="card table-scroll">
        <table>
          <thead><tr><th>Perceptor</th><th>NIF</th><th>Clave</th><th>Base</th><th>Retención</th></tr></thead>
          <tbody>
            ${rows190.map((r) => `<tr>
              <td>${esc(r.persona)}</td>
              <td class="mono">${esc(r.nif) || '<span style="color:var(--stamp-red);">Falta NIF</span>'}</td>
              <td class="mono">${r.clave}${r.subclave}</td>
              <td class="mono">${eur(r.base)}</td>
              <td class="mono">${eur(r.retencion)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${fiscalRow('Total base anual', eur(totalBase))}
      ${fiscalRow('Total retenido anual', eur(totalRet))}
      <p style="font-size:11px; color:var(--ink-soft); margin-top:10px;">Esto debe coincidir con la suma de los 4 modelos 111 del año.</p>
      <button id="descargarModelo190Btn" class="btn-primary no-print" style="margin-top:14px;">Descargar Modelo 190 relleno (PDF editable)</button>
    `;
  }

  if (fiscalTab === 'calc') {
    const hastaMes = fiscalQuarter * 3 - 1; // último mes del trimestre seleccionado
    const m130 = calcularModelo130(fiscalYear, hastaMes, calc130YaPagado, calc130Retenciones);

    const rendimientoAnualActual = rendimientoNetoAcumulado(fiscalYear, 11).neto;
    if (calcCuotaRendimiento === '') calcCuotaRendimiento = rendimientoAnualActual.toFixed(0);
    const cuota = calcularCuotaAutonomo(parseFloat(calcCuotaRendimiento) || 0);

    const amortPct = calcAmortTipo === 'Personalizado' ? (parseFloat(calcAmortPersonalizadoPct) || 0) / 100 : AMORTIZACION_TIPOS[calcAmortTipo];
    const amortAnual = calcularAmortizacion(parseFloat(calcAmortImporte) || 0, amortPct || 0);

    const proximoPlazo = proximoPlazoFiscal();
    const diasRestantes = Math.ceil((proximoPlazo.fechaFin - new Date()) / (1000 * 60 * 60 * 24));

    body = `
      <div class="no-print" style="display:flex; gap:10px; margin-bottom:14px;">
        <select id="calcYearSel">${years.map((y) => `<option value="${y}" ${y === fiscalYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <select id="calcQuarterSel">${[1, 2, 3, 4].map((q) => `<option value="${q}" ${q === fiscalQuarter ? 'selected' : ''}>${q}º Trimestre</option>`).join('')}</select>
      </div>

      <div style="background:var(--sage-deep); color:#fff; border-radius:8px; padding:14px 18px; margin-bottom:18px;">
        <p class="mono" style="font-size:11px; text-transform:uppercase; letter-spacing:.04em; margin:0; opacity:.85;">Próximo plazo fiscal</p>
        <p class="serif" style="font-size:20px; margin:4px 0 0;">${proximoPlazo.modelo}</p>
        <p style="font-size:13px; margin:2px 0 0; opacity:.9;">Hasta el ${proximoPlazo.fechaFin.toLocaleDateString('es-ES')} — ${diasRestantes >= 0 ? `quedan ${diasRestantes} días` : 'plazo ya pasado, revisa fechas'}</p>
      </div>

      <div style="border:1px solid var(--line); border-radius:6px; padding:14px; margin-bottom:16px;">
        <p style="font-weight:600; margin:0 0 4px; color:var(--sage-deep);">Provisión Modelo 130 (${fiscalQuarter}º trimestre ${fiscalYear})</p>
        <p style="font-size:11px; color:var(--ink-soft); margin:0 0 10px;">Calculado con tus sesiones y gastos ya registrados hasta el fin de ese trimestre.</p>
        ${liquidRow('Rendimiento neto acumulado (facturado − gastos)', m130.neto)}
        ${liquidRow(`Gastos difícil justificación IRPF (5%, tope ${eur(GASTOS_DIFICIL_JUST_IRPF_TOPE)})`, -m130.gastosDificilJust, { sub: true })}
        ${liquidRow('Rendimiento neto reducido', m130.netoReducido, { sub: true })}
        ${liquidRow('Pago fraccionado (20%)', m130.pagoFraccionado, { strong: true })}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:10px 0;">
          <div class="field"><label>Ya pagado en trimestres anteriores</label><input type="number" step="0.01" id="calc130YaPagado" value="${calc130YaPagado}" /></div>
          <div class="field"><label>Retenciones ya soportadas este año</label><input type="number" step="0.01" id="calc130Retenciones" value="${calc130Retenciones}" /></div>
        </div>
        ${liquidRow('A ingresar este trimestre', m130.aIngresar, { strong: true, color: 'var(--stamp-red)' })}
        <button id="calc130RecalcularBtn" class="btn-secondary" style="margin-top:8px;">Recalcular</button>
      </div>

      <div style="border:1px solid var(--line); border-radius:6px; padding:14px; margin-bottom:16px;">
        <p style="font-weight:600; margin:0 0 4px; color:var(--sage-deep);">Simulador de cuota de autónomo (RETA 2026)</p>
        <p style="font-size:11px; color:var(--ink-soft); margin:0 0 10px;">⚠ Cifras orientativas — confirma la exacta con la Seguridad Social o tu gestor antes de cambiar tu base.</p>
        <div class="field"><label>Rendimiento neto anual previsto (€)</label><input type="number" step="1" id="calcCuotaRendimiento" value="${calcCuotaRendimiento}" /></div>
        ${liquidRow('Tras 7% gastos genéricos, / 12 meses', cuota.mensual, { sub: true })}
        ${liquidRow('Cuota mensual aproximada (con MEI)', cuota.cuota, { strong: true, color: 'var(--sage)' })}
        <button id="calcCuotaRecalcularBtn" class="btn-secondary" style="margin-top:8px;">Recalcular</button>
      </div>

      <div style="border:1px solid var(--line); border-radius:6px; padding:14px; margin-bottom:16px;">
        <p style="font-weight:600; margin:0 0 4px; color:var(--sage-deep);">Amortización de una compra (equipo, mobiliario)</p>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; align-items:end;">
          <div class="field"><label>Importe (€)</label><input type="number" step="0.01" id="calcAmortImporte" value="${calcAmortImporte}" /></div>
          <div class="field"><label>Tipo de bien</label>
            <select id="calcAmortTipo">${Object.keys(AMORTIZACION_TIPOS).map((t) => `<option ${t === calcAmortTipo ? 'selected' : ''}>${t}</option>`).join('')}</select>
          </div>
          ${calcAmortTipo === 'Personalizado' ? `<div class="field"><label>% anual</label><input type="number" step="0.1" id="calcAmortPct" value="${calcAmortPersonalizadoPct}" /></div>` : '<div></div>'}
        </div>
        ${liquidRow('Cuota deducible este año', amortAnual, { strong: true, color: 'var(--sage)' })}
        <button id="calcAmortRecalcularBtn" class="btn-secondary" style="margin-top:8px;">Recalcular</button>
      </div>

      <div style="border:1px solid var(--line); border-radius:6px; padding:14px;">
        <p style="font-weight:600; margin:0 0 8px; color:var(--sage-deep);">Calendario fiscal (plazos recurrentes)</p>
        ${CALENDARIO_FISCAL.map((e) => `<div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--line); font-size:13px;">
          <span>${e.modelo}</span>
          <span class="mono" style="color:var(--ink-soft);">${String(e.diaInicio).padStart(2, '0')}–${String(e.diaFin).padStart(2, '0')} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][e.mesFin]}</span>
        </div>`).join('')}
      </div>
    `;
  }

  document.getElementById('fiscalModalRoot').innerHTML = `
    <div class="modal-overlay" id="fiscalOverlay">
      <div class="modal" style="max-width:760px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h3 class="serif" style="font-size:20px; color:var(--sage-deep); margin:0;">Modelos fiscales</h3>
          <button type="button" id="fiscalCloseBtn" class="no-print" style="background:none; font-size:18px;">✕</button>
        </div>
        <div class="no-print" style="display:flex; gap:6px; margin-bottom:16px; border-bottom:1px solid var(--line);">
          ${tabs.map((t) => `<button data-fiscal-tab="${t.id}" style="background:none; padding:8px 12px; border-bottom:2px solid ${fiscalTab === t.id ? 'var(--sage-deep)' : 'transparent'}; font-weight:${fiscalTab === t.id ? '600' : '400'}; color:var(--ink);">${t.label}</button>`).join('')}
        </div>
        <div>${body}</div>
        <div class="no-print" style="display:flex; justify-content:flex-end; gap:8px; margin-top:18px;">
          <button type="button" class="btn-secondary" onclick="window.print()">Imprimir / Guardar PDF</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('fiscalCloseBtn').addEventListener('click', closeFiscalModal);
  document.getElementById('fiscalOverlay').addEventListener('click', (e) => { if (e.target.id === 'fiscalOverlay') closeFiscalModal(); });
  document.querySelectorAll('[data-fiscal-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { fiscalTab = btn.dataset.fiscalTab; renderFiscalModal(); });
  });

  if (fiscalTab === 'config') {
    document.getElementById('saveDeclaranteBtn').addEventListener('click', async () => {
      const nif = document.getElementById('declaranteNif').value.trim();
      const nombre = document.getElementById('declaranteNombre').value.trim();
      const porcentaje_vivienda = parseFloat(document.getElementById('declaranteVivienda').value) || null;
      const btn = document.getElementById('saveDeclaranteBtn');
      btn.textContent = 'Guardando…';
      await saveFiscalDato('__DECLARANTE__', { nif, nombre, porcentaje_vivienda });
      btn.textContent = 'Guardado ✓';
      setTimeout(() => { btn.textContent = 'Guardar mis datos'; }, 1500);
    });
    document.querySelectorAll('[data-fiscal-save]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const persona = btn.dataset.fiscalSave;
        const nif = document.querySelector(`[data-fiscal-nif="${persona}"]`).value.trim();
        const subclave = document.querySelector(`[data-fiscal-subclave="${persona}"]`).value;
        btn.textContent = 'Guardando…';
        await saveFiscalDato(persona, { nif, clave: 'G', subclave });
        btn.textContent = 'Guardado ✓';
        setTimeout(() => { btn.textContent = 'Guardar'; }, 1500);
      });
    });
  }
  if (fiscalTab === '111') {
    document.getElementById('fiscalYearSel111').addEventListener('change', (e) => { fiscalYear = parseInt(e.target.value); renderFiscalModal(); });
    document.getElementById('fiscalQuarterSel').addEventListener('change', (e) => { fiscalQuarter = parseInt(e.target.value); renderFiscalModal(); });
  }
  if (fiscalTab === '190') {
    document.getElementById('fiscalYearSel190').addEventListener('change', (e) => { fiscalYear = parseInt(e.target.value); renderFiscalModal(); });
    document.getElementById('descargarModelo190Btn').addEventListener('click', () => generarModelo190PDF(fiscalYear));
  }
  if (fiscalTab === 'calc') {
    document.getElementById('calcYearSel').addEventListener('change', (e) => { fiscalYear = parseInt(e.target.value); renderFiscalModal(); });
    document.getElementById('calcQuarterSel').addEventListener('change', (e) => { fiscalQuarter = parseInt(e.target.value); renderFiscalModal(); });
    document.getElementById('calc130RecalcularBtn').addEventListener('click', () => {
      calc130YaPagado = parseFloat(document.getElementById('calc130YaPagado').value) || 0;
      calc130Retenciones = parseFloat(document.getElementById('calc130Retenciones').value) || 0;
      renderFiscalModal();
    });
    document.getElementById('calcCuotaRecalcularBtn').addEventListener('click', () => {
      calcCuotaRendimiento = document.getElementById('calcCuotaRendimiento').value;
      renderFiscalModal();
    });
    document.getElementById('calcAmortTipo').addEventListener('change', (e) => {
      calcAmortImporte = document.getElementById('calcAmortImporte').value;
      calcAmortTipo = e.target.value;
      renderFiscalModal();
    });
    document.getElementById('calcAmortRecalcularBtn').addEventListener('click', () => {
      calcAmortImporte = document.getElementById('calcAmortImporte').value;
      calcAmortTipo = document.getElementById('calcAmortTipo').value;
      const pctInput = document.getElementById('calcAmortPct');
      if (pctInput) calcAmortPersonalizadoPct = pctInput.value;
      renderFiscalModal();
    });
  }
}

async function generarModelo190PDF(year) {
  const decl = fiscalDatos['__DECLARANTE__'] || {};
  if (!decl.nif || !decl.nombre) {
    alert('Antes de descargar, rellena tus datos como declarante en la pestaña "Datos fiscales".');
    return;
  }
  const rows190 = computeModelo190(getYearSessions(year));
  const totalBase = rows190.reduce((a, r) => a + r.base, 0);
  const totalRet = rows190.reduce((a, r) => a + r.retencion, 0);
  const nPerceptores = rows190.length;

  const btn = document.getElementById('descargarModelo190Btn');
  btn.disabled = true;
  btn.textContent = 'Generando…';

  try {
    const templateBytes = await fetch('assets/modelo-190.pdf').then((res) => {
      if (!res.ok) throw new Error('No se pudo cargar la plantilla del Modelo 190');
      return res.arrayBuffer();
    });
    const pdfDoc = await PDFLib.PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    form.getTextField('dato.1').setText(String(year));
    form.getTextField('dato.a.nif.1').setText(decl.nif);
    form.getTextField('dato.2').setText(decl.nombre);
    form.getTextField('dato.8').setText(String(nPerceptores));
    form.getTextField('dato.9').setText(totalBase.toFixed(2).replace('.', ','));
    form.getTextField('dato.10').setText(totalRet.toFixed(2).replace('.', ','));
    // No se aplana (no flatten): el PDF sigue siendo editable para que Isabel pueda ajustar algo si hace falta.

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modelo-190-${year}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Error generando el PDF: ' + e.message);
  }

  btn.disabled = false;
  btn.textContent = 'Descargar Modelo 190 relleno (PDF editable)';
}

document.getElementById('fiscalBtn').addEventListener('click', async () => {
  await loadFiscalDatos();
  openFiscalModal();
});

// ---------- Gastos (solo Isabel) ----------
let gastos = [];
let gastoDraft = null; // datos extraídos pendientes de confirmar
let gastoImagenFile = null;

// ---------- Calculadoras de deducciones ----------

// Suministros: (importe del gasto) x % vivienda afecta x 30%
function calcularDeducibleSuministro(gasto, porcentajeVivienda) {
  if (gasto.categoria !== 'Suministros' || !porcentajeVivienda) return null;
  const importe = parseFloat(gasto.importe) || 0;
  return importe * (porcentajeVivienda / 100) * SUMINISTROS_PORCENTAJE;
}

// Dietas: valida los 3 requisitos (pago electrónico, fuera de municipio, dentro de límite)
function evaluarDieta(gasto) {
  if (gasto.categoria !== 'Dietas/Manutención') return null;
  const importe = parseFloat(gasto.importe) || 0;
  const pais = gasto.pais === 'Extranjero' ? 'Extranjero' : 'Espana';
  const limite = gasto.pernocta ? DIETA_LIMITES[pais].conPernocta : DIETA_LIMITES[pais].sinPernocta;

  const problemas = [];
  if (gasto.forma_pago === 'Efectivo') problemas.push('Pagado en efectivo (no deducible, debe ser pago electrónico)');
  if (!gasto.fuera_municipio) problemas.push('No marcado como fuera de tu municipio habitual');
  if (importe > limite) problemas.push(`Supera el límite diario de ${eur(limite)}`);

  return {
    limite,
    excede: importe > limite,
    valido: problemas.length === 0,
    problemas,
    deducible: problemas.length === 0 ? importe : Math.min(importe, limite),
  };
}

// Regalos a pacientes: acumulado anual vs 1% de la facturación del año
function calcularRegalosAnual(gastosLista, sesionesLista, anio) {
  const totalRegalos = gastosLista
    .filter((g) => g.categoria === 'Regalos a pacientes' && new Date(g.fecha_gasto + 'T00:00:00').getFullYear() === anio)
    .reduce((a, g) => a + (parseFloat(g.importe) || 0), 0);
  const facturadoAnual = sesionesLista
    .filter((s) => new Date(s.fecha_sesion + 'T00:00:00').getFullYear() === anio)
    .reduce((a, s) => a + (parseFloat(s.precio) || 0), 0);
  const limite = facturadoAnual * REGALOS_LIMITE_PCT;
  return { totalRegalos, facturadoAnual, limite, excede: totalRegalos > limite, pct: limite > 0 ? (totalRegalos / limite) * 100 : 0 };
}

// Rendimiento neto acumulado del año hasta una fecha límite (facturado - gastos)
function rendimientoNetoAcumulado(anio, hastaMes) {
  const facturado = sessions
    .filter((s) => {
      const d = new Date(s.fecha_sesion + 'T00:00:00');
      return d.getFullYear() === anio && d.getMonth() <= hastaMes;
    })
    .reduce((a, s) => a + (parseFloat(s.precio) || 0), 0);
  const gastado = gastos
    .filter((g) => {
      const d = new Date(g.fecha_gasto + 'T00:00:00');
      return d.getFullYear() === anio && d.getMonth() <= hastaMes;
    })
    .reduce((a, g) => a + (parseFloat(g.importe) || 0), 0);
  return { facturado, gastado, neto: facturado - gastado };
}

// Modelo 130: 20% del rendimiento neto acumulado (tras el 5% de gastos de difícil justificación), menos lo ya pagado/retenido
function calcularModelo130(anio, hastaMes, yaPagado, retencionesSoportadas) {
  const { neto } = rendimientoNetoAcumulado(anio, hastaMes);
  const gastosDificilJust = Math.min(Math.max(neto, 0) * GASTOS_DIFICIL_JUST_IRPF_PCT, GASTOS_DIFICIL_JUST_IRPF_TOPE);
  const netoReducido = neto - gastosDificilJust;
  const pagoFraccionado = Math.max(netoReducido, 0) * 0.20;
  const aIngresar = pagoFraccionado - (yaPagado || 0) - (retencionesSoportadas || 0);
  return { neto, gastosDificilJust, netoReducido, pagoFraccionado, aIngresar };
}

// Cuota de autónomo (RETA): rendimiento neto anual -> tramo -> cuota aproximada + MEI
function calcularCuotaAutonomo(rendimientoNetoAnual) {
  const netoTrasGenericos = rendimientoNetoAnual * (1 - GASTOS_GENERICOS_RETA_PCT);
  const mensual = netoTrasGenericos / 12;
  const tramo = RETA_TRAMOS.find((t) => mensual <= t.hasta) || RETA_TRAMOS[RETA_TRAMOS.length - 1];
  return { mensual, cuota: tramo.cuota };
}

function calcularAmortizacion(importe, porcentaje) {
  return importe * porcentaje;
}

function proximoPlazoFiscal() {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const eventos = CALENDARIO_FISCAL.map((e) => ({
    ...e,
    fechaFin: new Date(anio, e.mesFin, e.diaFin),
  })).sort((a, b) => a.fechaFin - b.fechaFin);
  const futuro = eventos.find((e) => e.fechaFin >= hoy);
  return futuro || eventos[0];
}

async function loadGastos() {
  try {
    const { data, error } = await sb.from('gastos').select('*').order('fecha_gasto', { ascending: false });
    if (error) throw error;
    gastos = data || [];
  } catch (e) {
    console.error('Error cargando gastos', e);
    gastos = [];
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function analizarRecibo(file) {
  const base64 = await fileToBase64(file);
  const res = await fetch('/api/analizar-recibo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: base64, mediaType: file.type || 'image/jpeg' }),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Respuesta inesperada del servidor (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(data.error || 'Error analizando el recibo');
  return data;
}

async function guardarGasto() {
  if (!gastoDraft) return;
  const btn = document.getElementById('guardarGastoBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  let imagen_path = null;
  try {
    if (gastoImagenFile) {
      const ext = (gastoImagenFile.name || 'jpg').split('.').pop();
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await sb.storage.from('recibos').upload(path, gastoImagenFile);
      if (upErr) throw upErr;
      imagen_path = path;
    }

    const payload = {
      fecha_gasto: gastoDraft.fecha_gasto,
      proveedor: gastoDraft.proveedor,
      concepto: gastoDraft.concepto,
      importe: parseFloat(gastoDraft.importe) || 0,
      iva: gastoDraft.iva !== '' && gastoDraft.iva != null ? parseFloat(gastoDraft.iva) : null,
      categoria: gastoDraft.categoria,
      forma_pago: gastoDraft.forma_pago || null,
      fuera_municipio: gastoDraft.fuera_municipio ?? null,
      pernocta: gastoDraft.pernocta ?? null,
      pais: gastoDraft.pais || 'España',
      imagen_path,
      creado_por: currentUserEmail,
    };
    const { error } = await sb.from('gastos').insert(payload);
    if (error) throw error;

    gastoDraft = null;
    gastoImagenFile = null;
    await loadGastos();
    renderGastosModal();
  } catch (e) {
    alert('Error guardando el gasto: ' + e.message);
  }
  btn.disabled = false;
}

async function eliminarGasto(id) {
  if (!confirm('¿Eliminar este gasto?')) return;
  const { error } = await sb.from('gastos').delete().eq('id', id);
  if (error) { alert('Error eliminando: ' + error.message); return; }
  await loadGastos();
  renderGastosModal();
}

function openGastosModal() {
  gastoDraft = null;
  gastoImagenFile = null;
  renderGastosModal();
}
function closeGastosModal() {
  document.getElementById('gastosModalRoot').innerHTML = '';
}

function renderGastosModal() {
  const totalImporte = gastos.reduce((a, g) => a + (parseFloat(g.importe) || 0), 0);
  const decl = fiscalDatos['__DECLARANTE__'] || {};
  const porcentajeVivienda = decl.porcentaje_vivienda;
  const anioActual = new Date().getFullYear();
  const regalos = calcularRegalosAnual(gastos, sessions, anioActual);

  let formHtml = '';
  if (gastoDraft) {
    const esDieta = gastoDraft.categoria === 'Dietas/Manutención';
    formHtml = `
      <div style="border:2px solid var(--sage-deep); border-radius:6px; padding:14px; margin-bottom:16px;">
        <p style="font-weight:600; margin:0 0 10px; color:var(--sage-deep);">Revisa los datos antes de guardar</p>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="field"><label>Fecha del gasto</label><input type="date" id="gd_fecha" value="${esc(gastoDraft.fecha_gasto || '')}" /></div>
          <div class="field"><label>Proveedor</label><input id="gd_proveedor" value="${esc(gastoDraft.proveedor || '')}" /></div>
          <div class="field"><label>Concepto</label><input id="gd_concepto" value="${esc(gastoDraft.concepto || '')}" /></div>
          <div class="field"><label>Importe (€)</label><input type="number" step="0.01" id="gd_importe" value="${esc(gastoDraft.importe ?? '')}" /></div>
          <div class="field"><label>IVA (€, opcional)</label><input type="number" step="0.01" id="gd_iva" value="${esc(gastoDraft.iva ?? '')}" /></div>
          <div class="field"><label>Categoría</label>
            <select id="gd_categoria">${CATEGORIAS_GASTO.map((c) => `<option ${c === gastoDraft.categoria ? 'selected' : ''}>${c}</option>`).join('')}</select>
          </div>
        </div>
        ${esDieta ? `
          <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--line); display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
            <div class="field"><label>Forma de pago</label>
              <select id="gd_forma_pago">
                <option value="Tarjeta" ${gastoDraft.forma_pago === 'Tarjeta' ? 'selected' : ''}>Tarjeta</option>
                <option value="Transferencia" ${gastoDraft.forma_pago === 'Transferencia' ? 'selected' : ''}>Transferencia</option>
                <option value="Efectivo" ${gastoDraft.forma_pago === 'Efectivo' ? 'selected' : ''}>Efectivo (no deducible)</option>
              </select>
            </div>
            <div class="field"><label>País</label>
              <select id="gd_pais">
                <option value="España" ${gastoDraft.pais !== 'Extranjero' ? 'selected' : ''}>España</option>
                <option value="Extranjero" ${gastoDraft.pais === 'Extranjero' ? 'selected' : ''}>Extranjero</option>
              </select>
            </div>
            <div class="field"><label>&nbsp;</label>
              <label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:13px;">
                <input type="checkbox" id="gd_pernocta" style="width:auto;" ${gastoDraft.pernocta ? 'checked' : ''} /> Con pernocta
              </label>
            </div>
            <div class="field" style="grid-column:1/-1;">
              <label style="display:flex; align-items:center; gap:6px; font-size:13px;">
                <input type="checkbox" id="gd_fuera_municipio" style="width:auto;" ${gastoDraft.fuera_municipio ? 'checked' : ''} /> Fuera de mi municipio habitual (requisito para que sea deducible)
              </label>
            </div>
          </div>
        ` : ''}
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button id="guardarGastoBtn" class="btn-primary">Guardar gasto</button>
          <button id="cancelarGastoBtn" class="btn-secondary">Cancelar</button>
        </div>
      </div>`;
  }

  const filaExtra = (g) => {
    if (g.categoria === 'Suministros') {
      if (!porcentajeVivienda) return `<span style="font-size:11px; color:var(--ochre);">Configura tu % de vivienda</span>`;
      const ded = calcularDeducibleSuministro(g, porcentajeVivienda);
      return `<span class="mono" style="font-size:12px; color:var(--sage);">${eur(ded)} deducible</span>`;
    }
    if (g.categoria === 'Dietas/Manutención') {
      const ev = evaluarDieta(g);
      if (ev.valido) return `<span class="mono" style="font-size:12px; color:var(--sage);">${eur(ev.deducible)} deducible ✓</span>`;
      return `<span style="font-size:11px; color:var(--stamp-red);">⚠ ${ev.problemas.join(' · ')}</span>`;
    }
    return '';
  };

  document.getElementById('gastosModalRoot').innerHTML = `
    <div class="modal-overlay" id="gastosOverlay">
      <div class="modal" style="max-width:820px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h3 class="serif" style="font-size:20px; color:var(--sage-deep); margin:0;">Gastos</h3>
          <button type="button" id="gastosCloseBtn" style="background:none; font-size:18px;">✕</button>
        </div>

        ${!porcentajeVivienda ? `<div style="background:var(--ochre-bg); border-radius:6px; padding:10px 14px; margin-bottom:14px; font-size:13px;">
          💡 Para que se calculen solos los suministros de casa, configura tu % de vivienda afecta en <b>Modelos fiscales → Datos fiscales</b>.
        </div>` : ''}

        <div style="border:1px solid var(--line); border-radius:6px; padding:10px 14px; margin-bottom:14px; ${regalos.excede ? 'background:var(--stamp-red-bg);' : ''}">
          <div style="display:flex; justify-content:space-between; font-size:13px;">
            <span>Regalos a pacientes ${anioActual} — límite deducible (1% facturación)</span>
            <span class="mono" style="font-weight:600; color:${regalos.excede ? 'var(--stamp-red)' : 'var(--sage)'};">${eur(regalos.totalRegalos)} / ${eur(regalos.limite)}</span>
          </div>
          ${regalos.excede ? `<p style="font-size:12px; color:var(--stamp-red); margin:4px 0 0;">Te has pasado del límite — lo que exceda no es deducible.</p>` : ''}
        </div>

        <div style="margin-bottom:14px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <label class="btn-primary" style="display:inline-block; cursor:pointer;">
            📷 Foto o subir ticket/factura
            <input type="file" id="gastoFileInput" accept="image/*" capture="environment" style="display:none;" />
          </label>
          <button id="gastoManualBtn" class="btn-secondary">+ Añadir manualmente</button>
          <span id="gastoAnalizandoMsg" style="font-size:13px; color:var(--ink-soft);"></span>
        </div>

        ${formHtml}

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <p class="mono" style="font-size:12px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.04em; margin:0;">Gastos registrados</p>
          <button id="exportGastosBtn" class="btn-secondary" style="padding:6px 12px; font-size:12px;">Exportar (Excel + fotos, ZIP)</button>
        </div>
        <div class="card table-scroll">
          <table>
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>Concepto</th><th>Importe</th><th>IVA</th><th>Categoría</th><th>Deducible</th><th></th></tr></thead>
            <tbody>
              ${gastos.map((g) => `<tr>
                <td class="mono" style="white-space:nowrap;">${g.fecha_gasto}</td>
                <td>${esc(g.proveedor)}</td>
                <td>${esc(g.concepto)}</td>
                <td class="mono">${eur(g.importe)}</td>
                <td class="mono">${g.iva != null ? eur(g.iva) : '—'}</td>
                <td>${esc(g.categoria)}</td>
                <td>${filaExtra(g)}</td>
                <td><button data-del-gasto="${g.id}" style="background:none; color:var(--stamp-red);">✕</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${fiscalRow('Total gastos', eur(totalImporte))}
      </div>
    </div>
  `;

  document.getElementById('gastosCloseBtn').addEventListener('click', closeGastosModal);
  document.getElementById('gastosOverlay').addEventListener('click', (e) => { if (e.target.id === 'gastosOverlay') closeGastosModal(); });

  document.getElementById('gastoManualBtn').addEventListener('click', () => {
    gastoImagenFile = null;
    gastoDraft = {
      fecha_gasto: new Date().toISOString().slice(0, 10),
      proveedor: '',
      concepto: '',
      importe: '',
      iva: '',
      categoria: 'Otros',
      forma_pago: 'Tarjeta',
      pais: 'España',
      pernocta: false,
      fuera_municipio: false,
    };
    renderGastosModal();
  });

  document.getElementById('gastoFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    gastoImagenFile = file;
    const msg = document.getElementById('gastoAnalizandoMsg');
    msg.textContent = 'Analizando con IA…';
    try {
      const extraido = await analizarRecibo(file);
      gastoDraft = {
        fecha_gasto: extraido.fecha_gasto || new Date().toISOString().slice(0, 10),
        proveedor: extraido.proveedor || '',
        concepto: extraido.concepto || '',
        importe: extraido.importe ?? '',
        iva: extraido.iva ?? '',
        categoria: extraido.categoria || 'Otros',
        forma_pago: 'Tarjeta',
        pais: 'España',
        pernocta: false,
        fuera_municipio: false,
      };
      renderGastosModal();
    } catch (err) {
      msg.textContent = '';
      alert('Error analizando el recibo: ' + err.message);
    }
  });

  function capturarCamposDraft() {
    if (!gastoDraft) return;
    gastoDraft.fecha_gasto = document.getElementById('gd_fecha').value;
    gastoDraft.proveedor = document.getElementById('gd_proveedor').value;
    gastoDraft.concepto = document.getElementById('gd_concepto').value;
    gastoDraft.importe = document.getElementById('gd_importe').value;
    gastoDraft.iva = document.getElementById('gd_iva').value;
    gastoDraft.categoria = document.getElementById('gd_categoria').value;
    const fp = document.getElementById('gd_forma_pago');
    if (fp) gastoDraft.forma_pago = fp.value;
    const pais = document.getElementById('gd_pais');
    if (pais) gastoDraft.pais = pais.value;
    const pernocta = document.getElementById('gd_pernocta');
    if (pernocta) gastoDraft.pernocta = pernocta.checked;
    const fuera = document.getElementById('gd_fuera_municipio');
    if (fuera) gastoDraft.fuera_municipio = fuera.checked;
  }

  if (gastoDraft) {
    document.getElementById('gd_categoria').addEventListener('change', () => {
      capturarCamposDraft();
      renderGastosModal();
    });
    document.getElementById('guardarGastoBtn').addEventListener('click', () => {
      capturarCamposDraft();
      guardarGasto();
    });
    document.getElementById('cancelarGastoBtn').addEventListener('click', () => {
      gastoDraft = null;
      gastoImagenFile = null;
      renderGastosModal();
    });
  }

  document.querySelectorAll('[data-del-gasto]').forEach((btn) => {
    btn.addEventListener('click', () => eliminarGasto(btn.dataset.delGasto));
  });

  document.getElementById('exportGastosBtn').addEventListener('click', exportGastosZip);
}

function nombreArchivoSeguro(s) {
  return String(s || 'sin-nombre')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
}

async function exportGastosZip() {
  const btn = document.getElementById('exportGastosBtn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparando…';

  const UN_ANIO_SEGUNDOS = 60 * 60 * 24 * 365;

  try {
    // 1. Generar el nombre de archivo y el enlace firmado (válido ~1 año) de cada foto
    const nombreArchivo = {};
    const enlaceFoto = {};
    const conFoto = gastos.filter((g) => g.imagen_path);
    let i = 0;
    for (const g of conFoto) {
      i++;
      btn.textContent = `Preparando enlaces… (${i}/${conFoto.length})`;
      const ext = g.imagen_path.split('.').pop();
      nombreArchivo[g.id] = `${nombreArchivoSeguro(g.fecha_gasto)}-${nombreArchivoSeguro(g.proveedor)}.${ext}`;
      const { data, error } = await sb.storage.from('recibos').createSignedUrl(g.imagen_path, UN_ANIO_SEGUNDOS);
      if (!error && data) enlaceFoto[g.id] = data.signedUrl;
    }

    // 2. Construir el Excel con columnas de nombre de archivo y enlace a la foto
    const porcentajeVivienda = (fiscalDatos['__DECLARANTE__'] || {}).porcentaje_vivienda;
    const rows = gastos.map((g) => {
      let deducible = '';
      let nota = '';
      if (g.categoria === 'Suministros' && porcentajeVivienda) {
        deducible = calcularDeducibleSuministro(g, porcentajeVivienda);
      } else if (g.categoria === 'Dietas/Manutención') {
        const ev = evaluarDieta(g);
        deducible = ev.deducible;
        nota = ev.valido ? '' : ev.problemas.join(' · ');
      }
      return {
        'Fecha': g.fecha_gasto,
        'Proveedor': g.proveedor,
        'Concepto': g.concepto,
        'Importe': parseFloat(g.importe) || 0,
        'IVA': g.iva != null ? parseFloat(g.iva) : '',
        'Categoría': g.categoria,
        'Deducible': deducible,
        'Nota': nota,
        'Nombre archivo (dentro del ZIP)': nombreArchivo[g.id] ? `tickets/${nombreArchivo[g.id]}` : '',
        'Enlace foto': enlaceFoto[g.id] ? 'Ver foto' : '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 26 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 30 }, { wch: 36 }, { wch: 12 }];

    // Convertir la columna "Enlace foto" (índice 9, 0-based) en hipervínculos reales
    gastos.forEach((g, idx) => {
      if (!enlaceFoto[g.id]) return;
      const cellRef = XLSX.utils.encode_cell({ r: idx + 1, c: 9 });
      ws[cellRef] = { t: 's', v: 'Ver foto', l: { Target: enlaceFoto[g.id], Tooltip: 'Abrir foto del ticket (enlace válido ~1 año)' } };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
    const excelArrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    // 3. Crear el ZIP con el Excel + una carpeta "tickets" con cada foto
    const zip = new JSZip();
    zip.file(`gastos-${new Date().toISOString().slice(0, 10)}.xlsx`, excelArrayBuffer);
    const carpetaTickets = zip.folder('tickets');

    i = 0;
    for (const g of conFoto) {
      i++;
      btn.textContent = `Descargando fotos… (${i}/${conFoto.length})`;
      const { data, error } = await sb.storage.from('recibos').download(g.imagen_path);
      if (error) { console.error('No se pudo descargar', g.imagen_path, error); continue; }
      carpetaTickets.file(nombreArchivo[g.id], data);
    }

    // 4. Generar y descargar el ZIP
    btn.textContent = 'Generando ZIP…';
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gastos-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Error generando el ZIP: ' + e.message);
  }

  btn.disabled = false;
  btn.textContent = original;
}

document.getElementById('gastosBtn').addEventListener('click', async () => {
  await loadGastos();
  await loadFiscalDatos();
  openGastosModal();
});

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
// ---------- Asistente fiscal (solo Isabel) ----------
let asistenteHistorial = [];

function openAsistenteModal() {
  if (asistenteHistorial.length === 0) {
    asistenteHistorial.push({
      role: 'assistant',
      content: 'Hola, soy tu asistente de orientación fiscal. Puedo ayudarte con dudas sobre suministros de casa, dietas, regalos a pacientes y el Kit Digital. Para todo lo demás, o casos que no tenga claros, te diré que lo consultes con tu gestor. ¿En qué te ayudo?',
    });
  }
  renderAsistenteModal();
}
function closeAsistenteModal() {
  document.getElementById('asistenteModalRoot').innerHTML = '';
}

async function enviarPreguntaAsistente(texto) {
  asistenteHistorial.push({ role: 'user', content: texto });
  renderAsistenteModal();

  try {
    const res = await fetch('/api/asistente-fiscal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: asistenteHistorial.map((m) => ({ role: m.role, content: m.content })) }),
    });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error(`Respuesta inesperada (${res.status}): ${raw.slice(0, 200)}`); }
    if (!res.ok) throw new Error(data.error || 'Error del asistente');
    asistenteHistorial.push({ role: 'assistant', content: data.reply });
  } catch (e) {
    asistenteHistorial.push({ role: 'assistant', content: `⚠ Hubo un error: ${e.message}` });
  }
  renderAsistenteModal();
}

function renderAsistenteModal() {
  const burbujas = asistenteHistorial.map((m) => {
    const esUser = m.role === 'user';
    return `
      <div style="display:flex; justify-content:${esUser ? 'flex-end' : 'flex-start'}; margin-bottom:10px;">
        <div style="max-width:80%; padding:10px 14px; border-radius:10px; font-size:14px; line-height:1.4;
          background:${esUser ? 'var(--sage-deep)' : 'var(--paper)'}; color:${esUser ? '#fff' : 'var(--ink)'};">
          ${esc(m.content).replace(/\n/g, '<br>')}
        </div>
      </div>`;
  }).join('');

  document.getElementById('asistenteModalRoot').innerHTML = `
    <div class="modal-overlay" id="asistenteOverlay">
      <div class="modal" style="max-width:640px; display:flex; flex-direction:column; max-height:85vh;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 class="serif" style="font-size:20px; color:var(--sage-deep); margin:0;">Asistente fiscal</h3>
          <button type="button" id="asistenteCloseBtn" style="background:none; font-size:18px;">✕</button>
        </div>
        <p style="font-size:12px; color:var(--ink-soft); margin:0 0 12px; background:var(--ochre-bg); padding:8px 12px; border-radius:6px;">
          Orientación general, no sustituye a tu gestor. Para casos que no encajen en sus reglas, te lo dirá.
        </p>
        <div id="asistenteChatBody" style="flex:1; overflow-y:auto; padding:4px; margin-bottom:12px; min-height:200px;">
          ${burbujas}
          <div id="asistenteTyping" style="display:none; font-size:13px; color:var(--ink-soft); padding:4px 14px;">Escribiendo…</div>
        </div>
        <div style="display:flex; gap:8px;">
          <input id="asistenteInput" placeholder="Escribe tu duda…" style="flex:1;" />
          <button id="asistenteSendBtn" class="btn-primary">Enviar</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('asistenteCloseBtn').addEventListener('click', closeAsistenteModal);
  document.getElementById('asistenteOverlay').addEventListener('click', (e) => { if (e.target.id === 'asistenteOverlay') closeAsistenteModal(); });

  const chatBody = document.getElementById('asistenteChatBody');
  chatBody.scrollTop = chatBody.scrollHeight;

  const input = document.getElementById('asistenteInput');
  const sendBtn = document.getElementById('asistenteSendBtn');

  const enviar = async () => {
    const texto = input.value.trim();
    if (!texto) return;
    input.value = '';
    sendBtn.disabled = true;
    input.disabled = true;
    await enviarPreguntaAsistente(texto);
    sendBtn.disabled = false;
    input.disabled = false;
    document.getElementById('asistenteInput')?.focus();
  };

  sendBtn.addEventListener('click', enviar);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
  input.focus();
}

document.getElementById('asistenteBtn').addEventListener('click', openAsistenteModal);

(async function boot() {
  const session = await initAuth();
  if (!session) return;
  await loadSessions();
  await loadGastos();
  render();
  subscribeRealtime();
})();
