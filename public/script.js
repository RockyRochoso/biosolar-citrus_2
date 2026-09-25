/* ═══════════════════════════════════════════════════════════
   BioSolar Citrus — Dashboard Industrial v3 (Client Logic)
   Pomar & Irrigação + Suficiência Energética & Retificadoras (NOC)
   ═══════════════════════════════════════════════════════════ */

const POLL_MS = 2000;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 66; // ≈ 414.69

// ── DOM Refs ──────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Views & Navigation
const tabBtnPomar    = $('#tab-btn-pomar');
const tabBtnEnergia  = $('#tab-btn-energia');
const viewPomar      = $('#view-pomar');
const viewEnergia    = $('#view-energia');

// Agro Elements
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

// NOC Elements
const selectRetificadora = $('#select-retificadora');
const btnToggleFalha     = $('#btn-toggle-falha');
const zabbixListEl       = $('#zabbix-problems-list');
const zabbixCountBadge   = $('#zabbix-count-badge');

// Topbar Actions
const btnCenarios   = $('#btn-cenarios');
const btnRelatorio  = $('#btn-relatorio');

// ── State ─────────────────────────────────────────────────
let bloqueioAtivo       = false;
let pending             = new Set();
let isOnline            = false;
let firstLoad           = true;
let currentRetificadora = 'CPN-RTF-SMU02B';
let latestTelemetria    = null;

// ═══════════════════════════════════════════════════════════
//  SECURITY & COMPRESSION HELPERS
// ═══════════════════════════════════════════════════════════
function escapeHTML(str) {
  return String(str || '').replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function compressImage(file, maxWidth = 700, maxHeight = 500, quality = 0.82) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > maxWidth || h > maxHeight) {
          if (w / h > maxWidth / maxHeight) {
            h = Math.round((h * maxWidth) / w);
            w = maxWidth;
          } else {
            w = Math.round((w * maxHeight) / h);
            h = maxHeight;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════════════════
//  TAB NAVIGATION
// ═══════════════════════════════════════════════════════════
tabBtnPomar.addEventListener('click', () => {
  tabBtnPomar.classList.add('active');
  tabBtnEnergia.classList.remove('active');
  viewPomar.classList.add('active');
  viewEnergia.classList.remove('active');
});

tabBtnEnergia.addEventListener('click', () => {
  tabBtnEnergia.classList.add('active');
  tabBtnPomar.classList.remove('active');
  viewEnergia.classList.add('active');
  viewPomar.classList.remove('active');
  if (latestTelemetria) renderNOC(latestTelemetria);
});

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
//  COLOR & FORMAT HELPERS
// ═══════════════════════════════════════════════════════════
function levelColor(pct) {
  if (pct < 15) return '#ef4444'; // red
  if (pct < 40) return '#f59e0b'; // yellow
  return '#10b981';               // green
}

function fruitEmoji(nome) {
  const n = (nome || '').toLowerCase();
  if (n.includes('limão') || n.includes('limao')) return '🍋';
  if (n.includes('tangerina') || n.includes('mexerica') || n.includes('ponkan')) return '🍊';
  return '🍊';
}

function updateGauge(pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = GAUGE_CIRCUMFERENCE * (1 - clamped / 100);
  gaugeArc.style.strokeDashoffset = offset;
  gaugeArc.style.stroke = levelColor(clamped);
  gaugeText.textContent = `${clamped.toFixed(1)}%`;
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
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ═══════════════════════════════════════════════════════════
//  NOC INDUSTRIAL CHARTS (Grafana/Zabbix Style)
// ═══════════════════════════════════════════════════════════
function drawNOCChart(canvasId, series, color = '#22c55e', unit = '', minY = null, maxY = null) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 360;
  const h = canvas.clientHeight || 110;

  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Background Grid Lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  // Horizontal grid
  const gridRows = 4;
  for (let i = 1; i < gridRows; i++) {
    const y = (h / gridRows) * i;
    ctx.beginPath();
    ctx.moveTo(30, y);
    ctx.lineTo(w - 10, y);
    ctx.stroke();
  }
  // Vertical grid
  const gridCols = 5;
  for (let i = 1; i < gridCols; i++) {
    const x = 30 + ((w - 40) / gridCols) * i;
    ctx.beginPath();
    ctx.moveTo(x, 10);
    ctx.lineTo(x, h - 18);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Data series calculation
  const data = (series && series.length >= 2) ? series : [0, 0, 0, 0, 0];
  const autoMin = minY !== null ? minY : Math.min(...data) * 0.95;
  const autoMax = maxY !== null ? maxY : Math.max(...data) * 1.05;
  const range = (autoMax - autoMin) || 1;

  const padLeft = 32;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 20;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  // Y-axis Labels
  ctx.fillStyle = '#6e7681';
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(autoMax.toFixed(0) + unit, padLeft - 4, padTop + 8);
  ctx.fillText(autoMin.toFixed(0) + unit, padLeft - 4, padTop + plotH);

  // X-axis Time Labels
  ctx.textAlign = 'center';
  ctx.fillText('09:00', padLeft + 10, h - 4);
  ctx.fillText('10:30', padLeft + plotW / 2, h - 4);
  ctx.fillText('11:30', padLeft + plotW - 10, h - 4);

  // Points
  const stepX = plotW / (data.length - 1);
  const pts = data.map((v, i) => ({
    x: padLeft + i * stepX,
    y: padTop + (1 - (v - autoMin) / range) * plotH,
  }));

  // Line
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const xm = (pts[i - 1].x + pts[i].x) / 2;
    const ym = (pts[i - 1].y + pts[i].y) / 2;
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, xm, ym);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Highlight last point
  const lastPt = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(lastPt.x, lastPt.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ═══════════════════════════════════════════════════════════
//  TALHÕES CARDS (Com Excluir & Trocar Imagem)
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
    let badgeClass, badgeLabel;
    if (t.critico) {
      badgeClass = 'critico'; badgeLabel = 'Irrigação Crítica (auto)';
    } else if (t.bomba) {
      badgeClass = 'bomba-on'; badgeLabel = 'Irrigando';
    } else {
      badgeClass = 'normal'; badgeLabel = 'Normal';
    }

    // NDVI color effect
    const lossPct = Math.max(0, 100 - t.umidade);
    const hueDeg = -140 * (lossPct / 100);
    const satBoost = 100 + (lossPct / 100) * 100;

    const imgSrc = t.imagem || `talhao_${id}.png`;
    const safeNome = escapeHTML(t.nome);

    card.innerHTML = `
      <div class="talhao-header">
        <div class="talhao-title-wrap">
          <span class="talhao-fruit">${fruitEmoji(t.nome)}</span>
          <span class="talhao-name">${safeNome}</span>
        </div>
        <div class="talhao-actions">
          <button class="btn-talhao-action btn-edit-img" data-id="${id}" data-nome="${safeNome}" data-img="${imgSrc}" title="Alterar imagem/planta satélite">
            🛰️ Foto
          </button>
          <button class="btn-talhao-action delete btn-del-talhao" data-id="${id}" data-nome="${safeNome}" title="Excluir este talhão">
            🗑️
          </button>
        </div>
      </div>

      <div class="talhao-image-wrap">
        <img src="${imgSrc}" class="talhao-img" alt="NDVI do ${safeNome}" style="filter: hue-rotate(${hueDeg}deg) saturate(${satBoost}%)" onerror="this.src='talhao_1.png'">
        <button class="talhao-img-overlay-btn btn-edit-img" data-id="${id}" data-nome="${safeNome}" data-img="${imgSrc}">
          📷 Trocar Imagem
        </button>
      </div>

      <div class="talhao-umidade" style="color:${levelColor(t.umidade)}" data-current="${t.umidade}">
        ${t.umidade.toFixed(1)}%
      </div>
      <canvas class="talhao-sparkline" data-talhao="${id}" width="260" height="38"></canvas>
      <span class="badge ${badgeClass}"><span class="dot"></span>${badgeLabel}</span>

      <div class="switch-row">
        <span class="switch-label">Aspersor</span>
        <button class="switch ${t.bomba ? 'on' : ''} ${bloqueioAtivo ? 'disabled' : ''}"
                data-id="${id}" data-estado="${t.bomba}"
                aria-label="Alternar bomba do ${safeNome}"></button>
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

  // Attach delete handlers
  talhoesEl.querySelectorAll('.btn-del-talhao').forEach(btn => {
    btn.addEventListener('click', onDeleteTalhao);
  });

  // Attach edit image handlers
  talhoesEl.querySelectorAll('.btn-edit-img').forEach(btn => {
    btn.addEventListener('click', onOpenImageModal);
  });
}

// ═══════════════════════════════════════════════════════════
//  DELETE TALHÃO HANDLER
// ═══════════════════════════════════════════════════════════
async function onDeleteTalhao(e) {
  e.stopPropagation();
  const id = e.currentTarget.dataset.id;
  const nome = e.currentTarget.dataset.nome || `Talhão ${id}`;

  if (!confirm(`Tem certeza que deseja excluir o "${nome}"?`)) return;

  try {
    const res = await fetch('/talhao_delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ talhao: id })
    });
    if (res.ok) {
      showToast(`"${nome}" excluído com sucesso.`, 'success');
      fetchTelemetria();
    } else {
      const err = await res.json();
      showToast(err.erro || 'Erro ao excluir talhão.', 'error');
    }
  } catch (err) {
    showToast('Falha na comunicação com o servidor.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
//  UPDATE IMAGE MODAL & HANDLER (Com Compressão Automática)
// ═══════════════════════════════════════════════════════════
const modalImagemTalhao   = $('#modal-imagem-talhao');
const modalImgTalhaoNome  = $('#modal-img-talhao-nome');
const modalImgTalhaoId    = $('#modal-img-talhao-id');
const inputUpdateFile     = $('#input-update-file');
const inputUpdateUrl      = $('#input-update-url');
const imgPreview          = $('#img-preview');
const btnSaveImagemTalhao = $('#btn-save-imagem-talhao');

function onOpenImageModal(e) {
  e.stopPropagation();
  const id = e.currentTarget.dataset.id;
  const nome = e.currentTarget.dataset.nome;
  const currentImg = e.currentTarget.dataset.img;

  modalImgTalhaoId.value = id;
  modalImgTalhaoNome.textContent = `Talhão: ${nome}`;
  imgPreview.src = currentImg || 'talhao_1.png';
  inputUpdateUrl.value = currentImg && currentImg.startsWith('http') ? currentImg : '';
  inputUpdateFile.value = '';

  modalOverlay.classList.remove('hidden');
  modalImagemTalhao.classList.remove('hidden');
}

// Live preview & compression
inputUpdateFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    const compressed = await compressImage(file);
    imgPreview.src = compressed;
  }
});

inputUpdateUrl.addEventListener('input', (e) => {
  const url = e.target.value.trim();
  if (url) {
    imgPreview.src = url;
  }
});

btnSaveImagemTalhao.addEventListener('click', async () => {
  const id = modalImgTalhaoId.value;
  let finalImg = imgPreview.src;

  if (!finalImg) {
    showToast('Selecione uma imagem ou informe uma URL.', 'warning');
    return;
  }

  try {
    const res = await fetch('/talhao_update_image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ talhao: id, imagem: finalImg })
    });
    if (res.ok) {
      showToast('Imagem do talhão atualizada com sucesso!', 'success');
      closeModals();
      fetchTelemetria();
    } else {
      const err = await res.json();
      showToast(err.erro || 'Erro ao atualizar imagem.', 'error');
    }
  } catch (err) {
    showToast('Falha na comunicação com o servidor.', 'error');
  }
});

// ═══════════════════════════════════════════════════════════
//  TOGGLE PUMP HANDLER
// ═══════════════════════════════════════════════════════════
async function onToggle(e) {
  if (bloqueioAtivo) {
    showToast('Bloqueio de emergência ativo — acionamento manual desabilitado (HTTP 423).', 'error');
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
//  NOC RENDERING (Suficiência Energética & Retificadoras)
// ═══════════════════════════════════════════════════════════
function renderNOC(data) {
  const retificadoras = data.retificadoras || {};
  const rtf = retificadoras[currentRetificadora] || Object.values(retificadoras)[0];
  if (!rtf) return;

  const isUp = rtf.status === 'UP';
  const color = isUp ? '#22c55e' : '#ef4444';

  // Rectifiers Operational Status
  const r1 = $('#val-rectifier1');
  const r2 = $('#val-rectifier2');
  const r3 = $('#val-rectifier3');
  const c1 = $('#card-rectifier1');
  const c2 = $('#card-rectifier2');
  const c3 = $('#card-rectifier3');

  const st1 = rtf.modulos?.rectifier1 || rtf.status || 'UP';
  const st2 = rtf.modulos?.rectifier2 || rtf.status || 'UP';
  const st3 = rtf.modulos?.rectifier3 || rtf.status || 'UP';

  r1.textContent = st1;
  c1.className = `noc-status-card ${st1 === 'OFF' ? 'off' : ''}`;

  r2.textContent = st2;
  c2.className = `noc-status-card ${st2 === 'OFF' ? 'off' : ''}`;

  if (r3 && c3) {
    r3.textContent = st3;
    c3.className = `noc-status-card ${st3 === 'OFF' ? 'off' : ''}`;
  }

  // Metrics
  $('#noc-temp-media').textContent = `${(rtf.temp_media || 38).toFixed(0)} °C`;
  $('#noc-uptime-weeks').textContent = rtf.tempo_operacao || '14.3 weeks';
  $('#noc-latency').textContent = rtf.latencia || '946 µs';

  // Labels
  $('#val-last-tensao-ac-a').textContent = `${rtf.tensao_ac_a?.toFixed(0) || 0} V`;
  $('#leg-tensao-ac-a').textContent = `${rtf.tensao_ac_a?.toFixed(0) || 0} V`;

  $('#val-last-corrente-dc-a').textContent = `${rtf.corrente_dc_a?.toFixed(2) || '0.00'} A`;
  $('#leg-corrente-dc-a').textContent = `${rtf.corrente_dc_a?.toFixed(2) || '0.00'} A`;

  $('#val-last-tensao-ac-b').textContent = `${rtf.tensao_ac_b?.toFixed(0) || 0} V`;
  $('#leg-tensao-ac-b').textContent = `${rtf.tensao_ac_b?.toFixed(0) || 0} V`;

  $('#val-last-corrente-dc-b').textContent = `${rtf.corrente_dc_b?.toFixed(2) || '0.00'} A`;
  $('#leg-corrente-dc-b').textContent = `${rtf.corrente_dc_b?.toFixed(2) || '0.00'} A`;

  $('#val-last-bateria').textContent = `${rtf.bateria_pct?.toFixed(0) || 100}%`;
  $('#leg-bateria').textContent = `${rtf.bateria_pct?.toFixed(0) || 100}%`;

  $('#val-last-consumo').textContent = `${rtf.consumo_w?.toFixed(0) || 0} W`;
  $('#leg-consumo').textContent = `${rtf.consumo_w?.toFixed(0) || 0} W`;

  $('#val-last-tensao-dc').textContent = `${rtf.tensao_dc?.toFixed(1) || '54.6'} V`;
  $('#leg-tensao-dc').textContent = `${rtf.tensao_dc?.toFixed(1) || '54.6'} V`;

  $('#val-last-corrente-dc-tot').textContent = `${rtf.corrente_dc_total?.toFixed(2) || '4.80'} A`;
  $('#leg-corrente-dc-tot').textContent = `${rtf.corrente_dc_total?.toFixed(2) || '4.80'} A`;

  // Draw 8 Charts
  const hEnergia = data.historico?.energia || {};
  drawNOCChart('chart-tensao-ac-a', hEnergia.tensao_ac_a || [218, 222, 224, 220, 224], color, 'V', 200, 240);
  drawNOCChart('chart-corrente-dc-a', hEnergia.corrente_dc_a || [3.0, 3.15, 3.3, 3.2, 3.3], color, 'A', 2.8, 3.6);
  drawNOCChart('chart-tensao-ac-b', hEnergia.tensao_ac_b || [218, 221, 225, 219, 224], color, 'V', 200, 240);
  drawNOCChart('chart-corrente-dc-b', hEnergia.corrente_dc_b || [3.0, 3.2, 3.1, 3.15, 3.1], color, 'A', 2.8, 3.6);
  drawNOCChart('chart-bateria', hEnergia.bateria || [100, 100, 99, 99, 100], color, '%', 0, 100);
  drawNOCChart('chart-consumo-w', hEnergia.consumo_w || [517, 517, 518, 517, 517], color, 'W', 0, 3000);
  drawNOCChart('chart-tensao-dc', hEnergia.tensao_dc || [54.6, 54.6, 54.5, 54.6, 54.6], color, 'V', 45, 60);
  drawNOCChart('chart-corrente-dc-tot', hEnergia.corrente_dc || [4.8, 4.85, 4.8, 4.82, 4.8], color, 'A', 4.0, 6.0);

  // Render Zabbix Problems List
  renderZabbixProblems(data.zabbix_problems || []);
}

function renderZabbixProblems(problems) {
  zabbixListEl.innerHTML = '';
  zabbixCountBadge.textContent = `${problems.length} ativos`;

  problems.forEach(p => {
    const card = document.createElement('div');
    card.className = `zabbix-card ${p.tipo || 'info'}`;
    const icon = p.icon === 'heart-crack' ? '💔' : (p.icon === 'battery-charging' ? '🔋' : '💙');

    card.innerHTML = `
      <div class="zabbix-icon-wrap">${icon}</div>
      <div class="zabbix-info">
        <div class="zabbix-title">${escapeHTML(p.titulo)}</div>
        <div class="zabbix-eq">${escapeHTML(p.equipamento)}</div>
        <div class="zabbix-time">${escapeHTML(p.tempo)}</div>
      </div>
    `;
    zabbixListEl.appendChild(card);
  });
}

// Retificadora selector change
selectRetificadora.addEventListener('change', (e) => {
  currentRetificadora = e.target.value;
  if (latestTelemetria) renderNOC(latestTelemetria);
});

// Toggle Fault / Status
btnToggleFalha.addEventListener('click', async () => {
  const currentRtf = latestTelemetria?.retificadoras?.[currentRetificadora];
  const newStatus = (currentRtf?.status === 'UP') ? 'OFF' : 'UP';
  try {
    const res = await fetch('/retificadora_toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retificadora: currentRetificadora, status: newStatus })
    });
    if (res.ok) {
      showToast(`Status da ${currentRetificadora} alterado para ${newStatus}`, 'info');
      fetchTelemetria();
    }
  } catch (e) {
    showToast('Erro ao alternar status da retificadora.', 'error');
  }
});

// ═══════════════════════════════════════════════════════════
//  KPIs & ESG METRICS
// ═══════════════════════════════════════════════════════════
function renderKPIs(data) {
  let bombasAtivas = 0;
  if (data.talhoes) {
    Object.values(data.talhoes).forEach(t => { if (t.bomba) bombasAtivas++; });
  }
  $('#kpi-bombas').textContent = bombasAtivas;

  if (data.energia) {
    $('#kpi-consumo').textContent = (data.energia.consumo_acumulado_kwh || 0).toFixed(2);
    
    // ESG Metrics
    if ($('#kpi-agua')) {
      const l = data.energia.agua_economizada_l || 0;
      $('#kpi-agua').textContent = l >= 1000 ? `${(l / 1000).toFixed(1)}k L` : `${l} L`;
    }
    if ($('#kpi-reais')) {
      $('#kpi-reais').textContent = `R$ ${(data.energia.economia_reais || 0).toFixed(2)}`;
    }
    if ($('#kpi-co2')) {
      $('#kpi-co2').textContent = `${(data.energia.co2_evitado_kg || 0).toFixed(2)} kg`;
    }

    const uptimeS = data.energia.uptime_s || 0;
    const m = Math.floor(uptimeS / 60);
    const s = Math.floor(uptimeS % 60);
    $('#kpi-uptime').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}

function renderWeather(clima) {
  if (!clima) return;
  const ICONS = { ensolarado: '☀️', nublado: '⛅', chuva: '🌧️', tempestade: '⛈️' };
  $('#weather-icon').textContent = ICONS[clima.condicao] || '☀️';
  $('#weather-condition').textContent = clima.condicao ? clima.condicao.toUpperCase() : 'ENSOLARADO';
  $('#w-temp').textContent = `${(clima.temperatura || 0).toFixed(1)}°C`;
  $('#w-vento').textContent = `${(clima.vento_kmh || 0).toFixed(1)} km/h`;
  $('#w-uv').textContent = clima.uv || 0;
  $('#w-chuva').textContent = `${Math.round(clima.chance_chuva || 0)}%`;
}

function renderEventLog(logs) {
  if (!logs || !logs.length) {
    eventLogEl.innerHTML = '<div class="log-empty">Aguardando eventos do sistema…</div>';
    logCountEl.textContent = '0 eventos';
    return;
  }
  logCountEl.textContent = `${logs.length} eventos`;
  eventLogEl.innerHTML = logs.map(l => `
    <div class="log-entry ${escapeHTML(l.tipo)}">
      <span class="log-ts">${escapeHTML(l.ts)}</span>
      <span class="log-msg">${escapeHTML(l.msg)}</span>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════
//  CENÁRIOS DEMO (Modo Apresentação para a Banca)
// ═══════════════════════════════════════════════════════════
const modalCenarios = $('#modal-cenarios');

btnCenarios.addEventListener('click', () => {
  modalOverlay.classList.remove('hidden');
  modalCenarios.classList.remove('hidden');
});

$$('.cenario-card').forEach(card => {
  card.addEventListener('click', async () => {
    const cenario = card.dataset.cenario;
    try {
      const res = await fetch('/cenario_aplicar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cenario })
      });
      if (res.ok) {
        showToast(`Cenário "${cenario.toUpperCase()}" aplicado com sucesso!`, 'success');
        closeModals();
        fetchTelemetria();
      }
    } catch(e) {
      showToast('Erro ao aplicar cenário.', 'error');
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  RELATÓRIO DE AUDITORIA TÉCNICA & ESG
// ═══════════════════════════════════════════════════════════
const modalRelatorio   = $('#modal-relatorio');
const relatorioBoxEl   = $('#relatorio-conteudo');
const btnDownloadCsv   = $('#btn-download-csv');
const btnPrintReport   = $('#btn-print-report');

btnRelatorio.addEventListener('click', () => {
  if (!latestTelemetria) {
    showToast('Aguardando sincronização de dados...', 'warning');
    return;
  }
  renderRelatorio(latestTelemetria);
  modalOverlay.classList.remove('hidden');
  modalRelatorio.classList.remove('hidden');
});

function renderRelatorio(d) {
  const dateStr = new Date().toLocaleString('pt-BR');
  let talhoesHtml = '';
  if (d.talhoes) {
    Object.entries(d.talhoes).forEach(([id, t]) => {
      talhoesHtml += `
        <div class="rel-item">
          <span class="rel-label">${escapeHTML(t.nome)}:</span>
          <span class="rel-val ${t.critico ? 'alert' : 'ok'}">${t.umidade.toFixed(1)}% | Bomba: ${t.bomba ? 'LIGADA' : 'DESLIGADA'} ${t.critico ? '(CRÍTICO)' : ''}</span>
        </div>
      `;
    });
  }

  relatorioBoxEl.innerHTML = `
    <h4>BIOSOLAR CITRUS — RELATÓRIO TÉCNICO DE AUDITORIA & ESG</h4>
    <div class="rel-item"><span class="rel-label">Data/Hora Emissão:</span><span class="rel-val">${dateStr}</span></div>
    <div class="rel-item"><span class="rel-label">Protocolo de Operação:</span><span class="rel-val">V JTI — Desafio Opção 03</span></div>

    <h4>1. RECURSOS HÍDRICOS</h4>
    <div class="rel-item"><span class="rel-label">Nível Reservatório Central:</span><span class="rel-val ${d.reservatorio < 15 ? 'alert' : 'ok'}">${d.reservatorio}%</span></div>
    <div class="rel-item"><span class="rel-label">Bloqueio de Emergência:</span><span class="rel-val ${d.bloqueio_emergencia ? 'alert' : 'ok'}">${d.bloqueio_emergencia ? 'ATIVADO (<15%)' : 'NORMAL'}</span></div>
    <div class="rel-item"><span class="rel-label">Água Poupada Estimada:</span><span class="rel-val ok">${d.energia?.agua_economizada_l || 0} Litros</span></div>

    <h4>2. MONITORAMENTO DOS TALHÕES</h4>
    ${talhoesHtml}

    <h4>3. SUFICIÊNCIA ENERGÉTICA & ESG</h4>
    <div class="rel-item"><span class="rel-label">Consumo Acumulado:</span><span class="rel-val">${d.energia?.consumo_acumulado_kwh || 0} kWh</span></div>
    <div class="rel-item"><span class="rel-label">Economia Financeira Gerada:</span><span class="rel-val ok">R$ ${(d.energia?.economia_reais || 0).toFixed(2)}</span></div>
    <div class="rel-item"><span class="rel-label">Redução de Emissões CO₂:</span><span class="rel-val ok">${(d.energia?.co2_evitado_kg || 0).toFixed(2)} kg CO₂</span></div>
    <div class="rel-item"><span class="rel-label">Tempo de Uptime:</span><span class="rel-val">${Math.floor((d.energia?.uptime_s || 0)/60)} minutos</span></div>
  `;
}

btnDownloadCsv.addEventListener('click', () => {
  if (!latestTelemetria) return;
  const d = latestTelemetria;
  const now = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  
  let csv = 'Categoria;Parametro;Valor;Unidade\n';
  csv += `Geral;DataHora;${new Date().toLocaleString('pt-BR')};-\n`;
  csv += `Hidrico;Reservatorio;${d.reservatorio};%\n`;
  csv += `Hidrico;BloqueioEmergencia;${d.bloqueio_emergencia ? 'SIM' : 'NAO'};-\n`;
  csv += `Hidrico;AguaEconomizada;${d.energia?.agua_economizada_l || 0};Litros\n`;
  csv += `Energia;ConsumoAcumulado;${d.energia?.consumo_acumulado_kwh || 0};kWh\n`;
  csv += `Energia;EconomiaReais;${d.energia?.economia_reais || 0};BRL\n`;
  csv += `ESG;CO2Evitado;${d.energia?.co2_evitado_kg || 0};kg\n`;

  if (d.talhoes) {
    Object.entries(d.talhoes).forEach(([id, t]) => {
      csv += `Talhao;${t.nome} Umidade;${t.umidade.toFixed(1)};%\n`;
      csv += `Talhao;${t.nome} Bomba;${t.bomba ? 'LIGADA' : 'DESLIGADA'};-\n`;
    });
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `biosolar_auditoria_${now}.csv`;
  link.click();
  showToast('Download do relatório CSV iniciado!', 'success');
});

btnPrintReport.addEventListener('click', () => {
  window.print();
});

// ═══════════════════════════════════════════════════════════
//  MAIN POLL
// ═══════════════════════════════════════════════════════════
async function fetchTelemetria() {
  try {
    const res = await fetch('/telemetria');
    const data = await res.json();
    latestTelemetria = data;

    setConnection(true);

    bloqueioAtivo = data.bloqueio_emergencia;
    banner.classList.toggle('hidden', !bloqueioAtivo);

    updateGauge(data.reservatorio);
    renderTalhoes(data.talhoes, data.historico);
    renderWeather(data.clima);
    renderKPIs(data);
    renderEventLog(data.log_eventos);

    // Sparkline reservatorio
    if (data.historico && data.historico.reservatorio) {
      drawSparkline(resSparkline, data.historico.reservatorio, levelColor(data.reservatorio));
    }

    // Render NOC dashboard
    renderNOC(data);

    // Populate modal energia inputs on first load
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

function setConnection(online) {
  if (online === isOnline && !firstLoad) return;
  isOnline = online;
  connStatus.className = 'conn-status ' + (online ? 'online' : 'offline');
  connTextEl.textContent = online ? 'Online' : 'Offline';
}

// ═══════════════════════════════════════════════════════════
//  MODALS & ACTIONS
// ═══════════════════════════════════════════════════════════
const modalOverlay = $('#modal-overlay');
const modalEnergia = $('#modal-energia');
const modalTalhao  = $('#modal-talhao');

const closeModals = () => {
  modalOverlay.classList.add('hidden');
  modalEnergia.classList.add('hidden');
  modalTalhao.classList.add('hidden');
  modalImagemTalhao.classList.add('hidden');
  modalCenarios.classList.add('hidden');
  modalRelatorio.classList.add('hidden');
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

// Save Energy Config
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

// Add New Talhão (with optional Image & compression)
$('#btn-save-talhao').addEventListener('click', async () => {
  const nome = $('#input-talhao-nome').value.trim() || 'Novo Talhão';
  const fileInput = $('#input-talhao-file');
  const urlInput = $('#input-talhao-img-url').value.trim();

  let imagem = urlInput || null;

  const sendAddRequest = async (imgData) => {
    try {
      const res = await fetch('/talhao_add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, imagem: imgData })
      });
      if (res.ok) {
        showToast('Novo talhão adicionado com sucesso!', 'success');
        $('#input-talhao-nome').value = '';
        $('#input-talhao-file').value = '';
        $('#input-talhao-img-url').value = '';
        closeModals();
        fetchTelemetria();
      }
    } catch(e) {
      showToast('Erro ao adicionar talhão.', 'error');
    }
  };

  if (fileInput.files && fileInput.files[0]) {
    const compressed = await compressImage(fileInput.files[0]);
    sendAddRequest(compressed);
  } else {
    sendAddRequest(imagem);
  }
});

// Reset simulation
$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('Reiniciar toda a simulação? Todos os dados serão restaurados para os padrões de fábrica.')) return;
  try {
    const res = await fetch('/reset', { method: 'POST' });
    if (res.ok) {
      showToast('Simulação reiniciada com sucesso.', 'success');
      fetchTelemetria();
    }
  } catch (err) {
    showToast('Erro ao reiniciar simulação.', 'error');
  }
});

function tickClock() {
  clockEl.textContent = new Date().toLocaleTimeString('pt-BR');
}

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
fetchTelemetria();
tickClock();
setInterval(fetchTelemetria, POLL_MS);
setInterval(tickClock, 1000);
