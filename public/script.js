/* ═══════════════════════════════════════════════════════════
   BioSolar Citrus — Dashboard v2 · Client Logic
   Sparklines · Animated counters · Toast · Event log
   ═══════════════════════════════════════════════════════════ */

const POLL_MS = 2000;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 66; // ≈ 414.69

// ── DOM Refs ──────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const talhoesEl     = $('#talhoes');
const banner        = $('#emergency-banner');
const clockEl       = $('#clock');
const gaugeArc      = $('#gauge-arc');
const gaugeText     = $('#gauge-text');
const toastBox      = $('#toast-container');
const eventLogEl    = $('#event-log');
const logCountEl    = $('#log-count');
const connStatus    = $('#conn-status');
const connTextEl    = connStatus.querySelector('.conn-text');
const resSparkline  = $('#reservoir-sparkline');

// ── State ─────────────────────────────────────────────────
let bloqueioAtivo   = false;
let pending         = new Set();
let prevValues      = {};
let lastLogLength   = 0;
let isOnline        = false;
let firstLoad       = true;

// ═══════════════════════════════════════════════════════════
//  TOAST NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════
const TOAST_ICONS = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };

function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || 'ℹ️'}</span><span>${msg}</span>`;
  toastBox.appendChild(toast);
  requestAnimationFrame(() => { requestAnimationFrame(() => toast.classList.add('show')); });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 4500);
}

// ═══════════════════════════════════════════════════════════
//  ANIMATED NUMBER TRANSITION
// ═══════════════════════════════════════════════════════════
function animateValue(el, to, duration = 600, decimals = 1, suffix = '') {
  const from = parseFloat(el.dataset.current || '0') || 0;
  if (Math.abs(from - to) < 0.05) { el.textContent = to.toFixed(decimals) + suffix; el.dataset.current = to; return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    const val = from + (to - from) * eased;
    el.textContent = val.toFixed(decimals) + suffix;
    if (t < 1) requestAnimationFrame(step);
    else el.dataset.current = to;
  };
  requestAnimationFrame(step);
}

// ═══════════════════════════════════════════════════════════
//  SPARKLINE (Canvas)
// ═══════════════════════════════════════════════════════════
function drawSparkline(canvas, data, color, fillAlpha = '30') {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  // Adjust for DPR only once or on resize
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!data || data.length < 2) return;

  const pad = 4;
  const minV = Math.min(...data) - 2;
  const maxV = Math.max(...data) + 2;
  const range = maxV - minV || 1;
  const stepX = (w - pad * 2) / (data.length - 1);

  const pts = data.map((v, i) => ({
    x: pad + i * stepX,
    y: pad + (1 - (v - minV) / range) * (h - pad * 2),
  }));

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + fillAlpha);
  grad.addColorStop(1, color + '05');

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const xm = (pts[i - 1].x + pts[i].x) / 2;
    const ym = (pts[i - 1].y + pts[i].y) / 2;
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, xm, ym);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  // Close fill path
  ctx.lineTo(pts[pts.length - 1].x, h);
  ctx.lineTo(pts[0].x, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const xm = (pts[i - 1].x + pts[i].x) / 2;
    const ym = (pts[i - 1].y + pts[i].y) / 2;
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, xm, ym);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // End dot
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(last.x, last.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = color + '25';
  ctx.fill();
}

// ═══════════════════════════════════════════════════════════
//  COLOR HELPERS
// ═══════════════════════════════════════════════════════════
function levelColor(pct) {
  if (pct < 25) return '#ef4444';
  if (pct < 50) return '#f59e0b';
  return '#10b981';
}

function fruitEmoji(nome) {
  if (nome.includes('Limão') || nome.includes('Lima')) return '🍋';
  return '🍊';
}

const WEATHER_MAP = {
  ensolarado: { icon: '☀️', label: 'Ensolarado' },
  nublado:    { icon: '⛅', label: 'Parcialmente Nublado' },
  chuva:      { icon: '🌧️', label: 'Chuva' },
  tempestade: { icon: '⛈️', label: 'Tempestade' },
};

// ═══════════════════════════════════════════════════════════
//  CIRCULAR GAUGE
// ═══════════════════════════════════════════════════════════
function updateGauge(pct) {
  const offset = GAUGE_CIRCUMFERENCE * (1 - pct / 100);
  gaugeArc.style.strokeDashoffset = offset;
  // Color transition based on level
  const color = levelColor(pct);
  gaugeArc.style.stroke = color;
  gaugeText.textContent = pct.toFixed(0) + '%';
  gaugeText.style.fill = color;
}

// ═══════════════════════════════════════════════════════════
//  WEATHER
// ═══════════════════════════════════════════════════════════
function renderWeather(clima) {
  const w = WEATHER_MAP[clima.condicao] || WEATHER_MAP.ensolarado;
  $('#weather-icon').textContent = w.icon;
  $('#weather-condition').textContent = w.label;
  $('#w-temp').textContent = clima.temperatura.toFixed(1) + '°C';
  $('#w-vento').textContent = clima.vento_kmh.toFixed(0) + ' km/h';
  $('#w-uv').textContent = clima.uv;
  $('#w-chuva').textContent = clima.chance_chuva.toFixed(0) + '%';
}

// ═══════════════════════════════════════════════════════════
//  KPIs
// ═══════════════════════════════════════════════════════════
function renderKPIs(data) {
  // Bombas ativas
  let bombas = 0;
  Object.values(data.talhoes).forEach(t => { if (t.bomba) bombas++; });
  const kpiBombas = $('#kpi-bombas');
  kpiBombas.textContent = bombas;
  kpiBombas.style.color = bombas > 0 ? '#22d3ee' : '#64748b';

  // Consumo
  animateValue($('#kpi-consumo'), data.energia.consumo_acumulado_kwh, 500, 2, '');

  // Economia
  const econEl = $('#kpi-economia');
  econEl.textContent = data.energia.economia_estimada_pct.toFixed(0) + '%';
  econEl.style.color = data.energia.economia_estimada_pct > 30 ? '#10b981' : '#f59e0b';

  // Uptime
  const secs = data.energia.uptime_s;
  const hrs = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const ss = Math.floor(secs % 60);
  $('#kpi-uptime').textContent =
    hrs > 0 ? `${hrs}h${String(mins).padStart(2,'0')}m` : `${mins}:${String(ss).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════════
//  EVENT LOG
// ═══════════════════════════════════════════════════════════
function renderEventLog(logs) {
  if (!logs || logs.length === 0) {
    logCountEl.textContent = '0 eventos';
    eventLogEl.innerHTML = '<div class="log-empty">Aguardando eventos do sistema…</div>';
    lastLogLength = 0;
    return;
  }

  // Notify for new events (skip first load)
  if (!firstLoad && logs.length > 0 && logs.length !== lastLogLength) {
    const newest = logs[0];
    const isError = ['emergencia', 'critico'].includes(newest.tipo);
    showToast(newest.msg, isError ? 'warning' : 'info');
  }
  lastLogLength = logs.length;

  logCountEl.textContent = logs.length + ' evento' + (logs.length !== 1 ? 's' : '');

  eventLogEl.innerHTML = logs.map(ev =>
    `<div class="log-entry ${ev.tipo}">
      <span class="log-ts">${ev.ts}</span>
      <span class="log-msg">${ev.msg}</span>
    </div>`
  ).join('');
}

// ═══════════════════════════════════════════════════════════
//  CONNECTION STATUS
// ═══════════════════════════════════════════════════════════
function setConnection(online) {
  if (online === isOnline && !firstLoad) return;
  isOnline = online;
  connStatus.className = 'conn-status ' + (online ? 'online' : 'offline');
  connTextEl.textContent = online ? 'Online' : 'Offline';
  if (!firstLoad) {
    showToast(
      online ? 'Conexão restabelecida' : 'Conexão perdida com o servidor',
      online ? 'success' : 'error'
    );
  }
}

// ═══════════════════════════════════════════════════════════
//  TALHÕES CARDS
// ═══════════════════════════════════════════════════════════
function renderTalhoes(talhoes, historico) {
  talhoesEl.innerHTML = '';

  Object.entries(talhoes).forEach(([id, t]) => {
    if (pending.has(id)) return;

    const card = document.createElement('div');
    const isIrrigating = t.bomba && !t.critico;
    card.className = 'talhao-card'
      + (t.critico ? ' critico' : '')
      + (isIrrigating ? ' irrigating' : '');

    // Badge
    let badgeClass, badgeLabel, dotColor;
    if (t.critico) {
      badgeClass = 'critico'; badgeLabel = 'Irrigação Crítica (auto)';
    } else if (t.bomba) {
      badgeClass = 'bomba-on'; badgeLabel = 'Irrigando';
    } else {
      badgeClass = 'normal'; badgeLabel = 'Normal';
    }

    // Calculate hue rotation based on humidity for NDVI effect:
    // If umidade is high (e.g. > 80%), rotation is 0 (stays green).
    // If umidade is low (e.g. < 30%), rotation is ~-120deg (turns red).
    const lossPct = Math.max(0, 100 - t.umidade);
    // Exponential or linear mapping. Let's do linear mapped to -130deg.
    const hueDeg = -140 * (lossPct / 100);
    // Add some saturation boost as it gets drier to make the red pop.
    const satBoost = 100 + (lossPct / 100) * 100;

    card.innerHTML = `
      <div class="talhao-header">
        <span class="talhao-name">${t.nome}</span>
        <span class="talhao-fruit">${fruitEmoji(t.nome)}</span>
      </div>
      <div class="talhao-image-wrap">
        <img src="talhao_${id}.png" class="talhao-img" alt="NDVI do ${t.nome}" style="filter: hue-rotate(${hueDeg}deg) saturate(${satBoost}%)">
      </div>
      <div class="talhao-umidade" style="color:${levelColor(t.umidade)}" data-current="${t.umidade}">
        ${t.umidade.toFixed(1)}%
      </div>
      <canvas class="talhao-sparkline" data-talhao="${id}" width="260" height="40"></canvas>
      <span class="badge ${badgeClass}"><span class="dot"></span>${badgeLabel}</span>
      <div class="switch-row">
        <span class="switch-label">Aspersor</span>
        <button class="switch ${t.bomba ? 'on' : ''} ${bloqueioAtivo ? 'disabled' : ''}"
                data-id="${id}" data-estado="${t.bomba}"
                aria-label="Alternar bomba do ${t.nome}"></button>
      </div>
    `;
    talhoesEl.appendChild(card);

    // Draw sparkline
    if (historico && historico.talhoes && historico.talhoes[id]) {
      const canvas = card.querySelector('.talhao-sparkline');
      drawSparkline(canvas, historico.talhoes[id], levelColor(t.umidade));
    }
  });

  // Attach switch handlers
  talhoesEl.querySelectorAll('.switch').forEach(btn => {
    btn.addEventListener('click', onToggle);
  });
}

// ═══════════════════════════════════════════════════════════
//  TOGGLE HANDLER
// ═══════════════════════════════════════════════════════════
async function onToggle(e) {
  if (bloqueioAtivo) {
    showToast('Bloqueio de emergência ativo — acionamento manual desabilitado.', 'error');
    return;
  }
  const btn = e.currentTarget;
  const id = btn.dataset.id;
  const novoEstado = btn.dataset.estado !== 'true';

  pending.add(id);
  btn.classList.toggle('on', novoEstado);

  try {
    const res = await fetch('/bombas/acionar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ talhao: id, estado: novoEstado }),
    });
    if (res.ok) {
      showToast(
        `Bomba do Talhão ${id} ${novoEstado ? 'ligada' : 'desligada'} com sucesso.`,
        'success'
      );
    } else {
      const err = await res.json();
      showToast(err.erro || 'Erro ao acionar a bomba.', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Falha na comunicação com o servidor.', 'error');
  } finally {
    pending.delete(id);
    fetchTelemetria();
  }
}

// ═══════════════════════════════════════════════════════════
//  MAIN POLL
// ═══════════════════════════════════════════════════════════
async function fetchTelemetria() {
  try {
    const res = await fetch('/telemetria');
    const data = await res.json();

    setConnection(true);

    bloqueioAtivo = data.bloqueio_emergencia;
    banner.classList.toggle('hidden', !bloqueioAtivo);

    updateGauge(data.reservatorio);
    renderTalhoes(data.talhoes, data.historico);
    renderWeather(data.clima);
    renderKPIs(data);
    renderEventLog(data.log_eventos);

    // Reservoir sparkline
    if (data.historico && data.historico.reservatorio) {
      drawSparkline(resSparkline, data.historico.reservatorio, levelColor(data.reservatorio));
    }

    // Atualizar inputs da modal com base no state (apenas se for primeira carga para não sobreescrever durante digitação)
    if (firstLoad && data.energia) {
      if (data.energia.baterias) $('#input-baterias').value = data.energia.baterias;
      if (data.energia.tempo_descarga) $('#input-descarga').value = data.energia.tempo_descarga;
      if (data.energia.consumo_bomba) $('#input-consumo').value = data.energia.consumo_bomba;
    }

    firstLoad = false;
  } catch (err) {
    console.error('Falha ao consultar telemetria:', err);
    setConnection(false);
  }
}

// ═══════════════════════════════════════════════════════════
//  RESET
// ═══════════════════════════════════════════════════════════
$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('Reiniciar toda a simulação? Todos os dados serão perdidos.')) return;
  try {
    const res = await fetch('/reset', { method: 'POST' });
    if (res.ok) {
      showToast('Simulação reiniciada com sucesso.', 'success');
      lastLogLength = 0;
      fetchTelemetria();
    }
  } catch (err) {
    showToast('Erro ao reiniciar simulação.', 'error');
  }
});

// ═══════════════════════════════════════════════════════════
//  CLOCK
// ═══════════════════════════════════════════════════════════
function tickClock() {
  clockEl.textContent = new Date().toLocaleTimeString('pt-BR');
}

// ═══════════════════════════════════════════════════════════
//  MODALS E EVENTOS NOVOS
// ═══════════════════════════════════════════════════════════
const modalOverlay = $('#modal-overlay');
const modalEnergia = $('#modal-energia');
const modalTalhao = $('#modal-talhao');

const closeModals = () => {
  modalOverlay.classList.add('hidden');
  modalEnergia.classList.add('hidden');
  modalTalhao.classList.add('hidden');
};

$$('.modal-close').forEach(btn => btn.addEventListener('click', closeModals));
modalOverlay.addEventListener('click', closeModals);

$('#kpi-energia-btn').addEventListener('click', () => {
  modalOverlay.classList.remove('hidden');
  modalEnergia.classList.remove('hidden');
});

$('#btn-add-talhao').addEventListener('click', () => {
  modalOverlay.classList.remove('hidden');
  modalTalhao.classList.remove('hidden');
});

$('#btn-save-energia').addEventListener('click', async () => {
  const data = {
    baterias: parseInt($('#input-baterias').value),
    tempo_descarga: parseInt($('#input-descarga').value),
    consumo_bomba: parseFloat($('#input-consumo').value)
  };
  try {
    const res = await fetch('/energia_config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (res.ok) {
      showToast('Configurações de energia salvas.', 'success');
      closeModals();
      fetchTelemetria();
    }
  } catch(e) {
    showToast('Erro ao salvar configurações.', 'error');
  }
});

$('#btn-save-talhao').addEventListener('click', async () => {
  const nome = $('#input-talhao-nome').value.trim() || 'Novo Talhão';
  try {
    const res = await fetch('/talhao_add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome })
    });
    if (res.ok) {
      showToast('Talhão adicionado com sucesso!', 'success');
      $('#input-talhao-nome').value = '';
      closeModals();
      fetchTelemetria();
    }
  } catch(e) {
    showToast('Erro ao adicionar talhão.', 'error');
  }
});

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
fetchTelemetria();
tickClock();
setInterval(fetchTelemetria, POLL_MS);
setInterval(tickClock, 1000);
