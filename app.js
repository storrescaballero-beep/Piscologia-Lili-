const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const FORMAS_PAGO = ['Efectivo', 'Tarjeta', 'Transferencia', 'Bizum'];
const ESTADOS = ['Pendiente', 'Pagado', 'Parcial'];
const MODALIDADES = ['Presencial', 'Online'];
const ISABEL_EMAIL = 'iperezfraile@gmail.com';
const DAVID_CENTRO = 'Centro David';
const DAVID_ALQUILER = 30;
const PORCENTAJE_SERGIO = 0.6;
let currentUserEmail = '';

function alquilerDavid(s) {
  return (s.centro === DAVID_CENTRO && s.modalidad === 'Presencial') ? DAVID_ALQUILER : 0;
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
      const hay = `${s.paciente} ${s.responsable_pago} ${s.psicologa}`.toLowerCase();
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
  const facturado = thisMonth.reduce((a, s) => a + (parseFloat(s.precio) || 0), 0);
  const alquiler = thisMonth.reduce((a, s) => a + alquilerDavid(s), 0);
  const aSergio = facturado * PORCENTAJE_SERGIO;
  return { count: thisMonth.length, cobrado, pendiente, sinQuipu, label: thisMonthLabel, facturado, alquiler, aSergio };
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
    { label: 'Alquiler David', value: eur(s.alquiler), sub: 'centro presencial, este mes', color: 'var(--blue)' },
    { label: `A facturar a Sergio (${Math.round(PORCENTAJE_SERGIO * 100)}%)`, value: eur(s.aSergio), sub: 'sobre el total facturado', color: 'var(--sage-deep)' },
  ];
  document.getElementById('stats').innerHTML = cards.map((c) => `
    <div class="stat-card" style="border-left-color:${c.color};">
      <p class="mono" style="font-size:11px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.04em; margin:0;">${c.label}</p>
      <p class="serif" style="font-size:24px; margin:4px 0 0;">${c.value}</p>
      <p style="font-size:12px; color:var(--ink-soft); margin:2px 0 0;">${c.sub}</p>
    </div>
  `).join('');
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
    Pagado: 'color:var(--sage); background:#EAF0EA; border-color:var(--sage);',
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
          ${fieldHtml('Nombre paciente', `<input name="paciente" list="dl_pacientes" required value="${esc(form.paciente)}" />${dl('dl_pacientes', o.pacientes)}`)}
          ${fieldHtml('Responsable de pago', `<input name="responsable_pago" value="${esc(form.responsable_pago)}" />`)}
          ${fieldHtml('Psicóloga', `<input name="psicologa" list="dl_psicologas" value="${esc(form.psicologa)}" />${dl('dl_psicologas', o.psicologas)}`)}
          ${fieldHtml('Centro', `<input name="centro" list="dl_centros" value="${esc(form.centro)}" />${dl('dl_centros', [...new Set([DAVID_CENTRO, 'Online', ...o.centros])])}`)}
          ${fieldHtml('Modalidad', `<select name="modalidad"><option value="">—</option>${MODALIDADES.map((m) => `<option ${m === form.modalidad ? 'selected' : ''}>${m}</option>`).join('')}</select>`)}
          ${fieldHtml('Tipo de servicio', `<input name="tipo_servicio" list="dl_tipos" value="${esc(form.tipo_servicio)}" />${dl('dl_tipos', o.tipos)}`)}
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
  const totalFacturado = filtered.reduce((a, s) => a + (parseFloat(s.precio) || 0), 0);
  const totalAlquilerDavid = filtered.reduce((a, s) => a + alquilerDavid(s), 0);
  const totalASergio = totalFacturado * PORCENTAJE_SERGIO;

  const headers = ['Fecha sesión', 'Paciente', 'Responsable pago', 'Psicóloga', 'Centro', 'Modalidad', 'Tipo servicio', 'Precio', 'Alquiler David', 'Forma de pago', 'Fecha ingreso banco', 'Estado pago', 'Contabilizado Quipu', 'Introducido por'];
  const dataRows = filtered.map((s) => [
    s.fecha_sesion, s.paciente, s.responsable_pago, s.psicologa, s.centro, s.modalidad, s.tipo_servicio,
    parseFloat(s.precio) || 0, alquilerDavid(s), s.forma_pago, s.fecha_ingreso_banco || '', s.estado_pago,
    s.quipu ? 'Sí' : 'No', s.creado_por || '',
  ]);

  const summary = [
    ['Resumen', ''],
    ['Total facturado', totalFacturado],
    ['Alquiler a David (centro presencial)', totalAlquilerDavid],
    [`A facturar a Sergio (${Math.round(PORCENTAJE_SERGIO * 100)}%)`, totalASergio],
    [],
    headers,
    ...dataRows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(summary);
  ws['!cols'] = [{ wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registro');
  XLSX.writeFile(wb, `registro-pagos-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------- Event bindings ----------
document.getElementById('searchInput').addEventListener('input', (e) => { search = e.target.value; renderTable(); });
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
