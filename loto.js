// ════════════════════════════════════════════════════
//  LOTO ANALİZ MOTORU v3 — Sayısal, Süper, Şans Topu
//  LOTO_CONFIG ile parametrize
// ════════════════════════════════════════════════════

function loadUserDraws() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOTO_CONFIG.storageKey) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    localStorage.removeItem(LOTO_CONFIG.storageKey);
    return [];
  }
}

let userDraws = loadUserDraws();
function saveUser() { localStorage.setItem(LOTO_CONFIG.storageKey, JSON.stringify(userDraws)); }
function drawDateKey(draw) {
  const [day, month, year] = String(draw[1] || '').split('/').map(Number);
  return year * 10000 + month * 100 + day;
}

const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

function drawToDate(draw) {
  const [day, month, year] = String(draw[1] || '').split('/').map(Number);
  if (!day || !month || !year) return null;
  return new Date(year, month - 1, day);
}

function toDateOnly(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatLongDate(date) {
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatShortDate(date) {
  return date.toLocaleDateString('tr-TR');
}

function drawDayLabels(drawDays) {
  return drawDays.map(day => TR_DAYS[day]).join(', ');
}

function countDueDrawDays(lastDate, today, drawDays) {
  let count = 0;
  for (let d = addDays(lastDate, 1); d <= today; d = addDays(d, 1)) {
    if (drawDays.includes(d.getDay())) count++;
  }
  return count;
}

function nextDrawDate(today, drawDays) {
  for (let i = 0; i <= 7; i++) {
    const candidate = addDays(today, i);
    if (drawDays.includes(candidate.getDay())) return candidate;
  }
  return null;
}

function renderDrawStatus(draws) {
  const el = document.getElementById('drawStatus');
  if (!el) return;
  const drawDays = LOTO_CONFIG.drawDays || [];
  const latest = draws[draws.length - 1];
  const lastDate = latest ? drawToDate(latest) : null;
  if (!latest || !lastDate || !drawDays.length) {
    el.className = 'draw-status warn';
    el.textContent = 'Güncellik kontrolü için yeterli çekiliş bilgisi yok.';
    return;
  }

  const today = toDateOnly();
  const due = countDueDrawDays(lastDate, today, drawDays);
  const next = nextDrawDate(today, drawDays);
  const todayIsDrawDay = drawDays.includes(today.getDay());
  const dayInfo = `Çekiliş günleri: ${drawDayLabels(drawDays)}.`;
  const dateInfo = `Bugün ${formatLongDate(today)} ${TR_DAYS[today.getDay()]}; son ekli sonuç ${latest[1]}.`;

  if (due === 0) {
    const nextInfo = next ? `Sıradaki çekiliş ${formatShortDate(next)} ${TR_DAYS[next.getDay()]}.` : '';
    el.className = 'draw-status ok';
    el.textContent = `${dateInfo} Veri güncel görünüyor. ${dayInfo} ${nextInfo}`.trim();
    return;
  }

  const missingText = due === 1 ? '1 çekiliş sonucu' : `${due} çekiliş sonucu`;
  const todayText = todayIsDrawDay ? ' Bugün de çekiliş günü olduğu için sonuç henüz yayınlanmadıysa beklemede olabilir.' : '';
  el.className = due >= 2 ? 'draw-status due' : 'draw-status warn';
  el.textContent = `${dateInfo} ${missingText} eksik olabilir. ${dayInfo}${todayText}`;
}

function allDraws() {
  const byDate = new Map();
  for (const draw of LOTO_CONFIG.data) byDate.set(draw[1], draw);
  for (const draw of userDraws) byDate.set(draw[1], draw);
  return [...byDate.values()].sort((a, b) => drawDateKey(a) - drawDateKey(b));
}

// ── Frekans ──────────────────────────────────────────
function freq(draws) {
  const f = {};
  for (let i = 1; i <= LOTO_CONFIG.maxNum; i++) f[i] = 0;
  for (const d of draws) {
    for (const n of d[2]) {
      if (n >= 1 && n <= LOTO_CONFIG.maxNum) f[n]++;
    }
  }
  return f;
}

function resultCount() {
  return LOTO_CONFIG.drawCount || LOTO_CONFIG.pickCount || 6;
}

function freqBonus(draws) {
  const f = {};
  const bn = LOTO_CONFIG.bonusMax;
  if (!bn) return f;
  for (let i = 1; i <= bn; i++) f[i] = 0;
  for (const d of draws) {
    if (d[3] >= 1 && d[3] <= bn) f[d[3]]++;
  }
  return f;
}

// ── Gecikmiş sayılar ─────────────────────────────────
function recentMissing(draws, n) {
  const recent = draws.slice(-n);
  const seen = new Set(recent.flatMap(d => d[2]));
  return Array.from({length: LOTO_CONFIG.maxNum}, (_, i) => i + 1).filter(x => !seen.has(x));
}

// ── Renk sınıfı ──────────────────────────────────────
function colorClass(c, max) {
  const p = max > 0 ? c / max : 0;
  if (p >= .85) return ['c5', '#2ecc8a'];
  if (p >= .65) return ['c4', '#1dc7bb'];
  if (p >= .45) return ['c3', '#8888b0'];
  if (p >= .25) return ['c2', '#f09030'];
  return ['c1', '#e85555'];
}

// ── Trend analizi ─────────────────────────────────────
function analyzeTrends(draws, windowSize = 30) {
  const recent = draws.slice(-windowSize);
  const recentFreq = freq(recent);
  const denom = recent.length || 1;
  const hotThreshold = (resultCount() / LOTO_CONFIG.maxNum) * 1.25;
  const trend = {};
  for (let i = 1; i <= LOTO_CONFIG.maxNum; i++) {
    trend[i] = {
      freq: recentFreq[i],
      pct: recentFreq[i] / denom,
      isHot: recentFreq[i] / denom >= hotThreshold,
      isCold: recentFreq[i] === 0
    };
  }
  return trend;
}

// ── Altın sayılar ─────────────────────────────────────
function goldNumbers(draws) {
  const gold = LOTO_CONFIG.goldNumbers;
  const f = freq(draws);
  const total = draws.length || 1;
  return gold.map(n => ({
    num: n,
    freq: f[n] || 0,
    pct: (f[n] || 0) / total,
    trend: f[n] > 0 ? 'aktif' : 'gecikme'
  })).sort((a, b) => b.freq - a.freq);
}

// ── Ağırlıklı pick ───────────────────────────────────
function weightedPick(pool, freqMap, count, opts = {}) {
  const boost = opts.boost || 1;
  const items = [...new Set(pool)].filter(n => n >= 1 && n <= LOTO_CONFIG.maxNum)
    .map(n => ({ n, w: Math.max((freqMap[n] || 0) * boost, 0.1) }));
  const picked = [];
  while (picked.length < count && items.length) {
    const total = items.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < items.length - 1; idx++) { r -= items[idx].w; if (r <= 0) break; }
    picked.push(items[idx].n);
    items.splice(idx, 1);
  }
  return picked.sort((a, b) => a - b);
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function avg(arr) {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
}

function drawsSinceSeen(draws, num) {
  for (let i = draws.length - 1, gap = 0; i >= 0; i--, gap++) {
    if (draws[i][2].includes(num)) return gap;
  }
  return draws.length;
}

function buildNumberScores(draws, profile = 'balanced') {
  const pickCount = LOTO_CONFIG.pickCount || 6;
  const drawnCount = resultCount();
  const recentSize = Math.min(120, draws.length);
  const hotSize = Math.min(30, draws.length);
  const recentDraws = draws.slice(-recentSize);
  const hotDraws = draws.slice(-hotSize);
  const allFreq = freq(draws);
  const recentFreq = freq(recentDraws);
  const hotFreq = freq(hotDraws);
  const expectedAll = Math.max(1, draws.length * drawnCount / LOTO_CONFIG.maxNum);
  const expectedRecent = Math.max(1, recentDraws.length * drawnCount / LOTO_CONFIG.maxNum);
  const expectedHot = Math.max(1, hotDraws.length * drawnCount / LOTO_CONFIG.maxNum);
  const maxGap = Math.max(1, draws.length);

  const weights = {
    balanced: { all: 0.34, recent: 0.28, hot: 0.16, overdue: 0.22 },
    trend: { all: 0.22, recent: 0.38, hot: 0.28, overdue: 0.12 },
    overdue: { all: 0.24, recent: 0.16, hot: 0.10, overdue: 0.50 },
  }[profile] || { all: 0.34, recent: 0.28, hot: 0.16, overdue: 0.22 };

  const scores = {};
  for (let n = 1; n <= LOTO_CONFIG.maxNum; n++) {
    const allRatio = clamp(allFreq[n] / expectedAll, 0.35, 1.75);
    const recentRatio = clamp(recentFreq[n] / expectedRecent, 0.25, 2.10);
    const hotRatio = clamp(hotFreq[n] / expectedHot, 0.20, 2.35);
    const overdueRatio = clamp(drawsSinceSeen(draws, n) / Math.min(maxGap, 80), 0, 1.85);
    scores[n] = Math.max(
      0.05,
      weights.all * allRatio +
      weights.recent * recentRatio +
      weights.hot * hotRatio +
      weights.overdue * (0.55 + overdueRatio)
    );
  }
  return scores;
}

function randomWeighted(items) {
  const total = items.reduce((s, item) => s + item.w, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.w;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function candidateQuality(nums) {
  const count = nums.length;
  const max = LOTO_CONFIG.maxNum;
  const sum = nums.reduce((s, n) => s + n, 0);
  const idealSum = count * (max + 1) / 2;
  const sumScore = 1 - clamp(Math.abs(sum - idealSum) / idealSum, 0, 1);
  const odd = nums.filter(n => n % 2).length;
  const oddScore = 1 - clamp(Math.abs(odd - count / 2) / count, 0, 1);
  const low = nums.filter(n => n <= max / 2).length;
  const lowScore = 1 - clamp(Math.abs(low - count / 2) / count, 0, 1);
  let consecutive = 0;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] - nums[i - 1] === 1) consecutive++;
  }
  const consecutiveScore = 1 - clamp(consecutive / Math.max(1, count - 1), 0, 1);
  const decades = new Set(nums.map(n => Math.floor((n - 1) / 10))).size;
  const spreadScore = clamp(decades / Math.min(count, Math.ceil(max / 10)), 0, 1);
  return (sumScore * 0.25) + (oddScore * 0.25) + (lowScore * 0.20) + (consecutiveScore * 0.15) + (spreadScore * 0.15);
}

function generateCandidate(scoreMap, profile = 'balanced') {
  const count = LOTO_CONFIG.pickCount || 6;
  const items = Object.entries(scoreMap).map(([n, w]) => ({ n: +n, w }));
  let best = null;

  for (let attempt = 0; attempt < 260; attempt++) {
    const remaining = items.map(item => ({...item}));
    const picked = [];

    while (picked.length < count && remaining.length) {
      const chosen = randomWeighted(remaining);
      picked.push(chosen.n);
      const idx = remaining.findIndex(item => item.n === chosen.n);
      remaining.splice(idx, 1);
    }

    const nums = picked.sort((a, b) => a - b);
    const statScore = avg(nums.map(n => scoreMap[n] || 0));
    const quality = candidateQuality(nums);
    const noise = Math.random() * (profile === 'trend' ? 0.16 : 0.11);
    const score = (statScore * 0.68) + (quality * 0.32) + noise;
    if (!best || score > best.score) best = { nums, score };
  }

  return best.nums;
}

function buildBonusScores(draws) {
  const max = LOTO_CONFIG.bonusMax;
  const scores = {};
  if (!max) return scores;
  const all = freqBonus(draws);
  const recent = freqBonus(draws.slice(-Math.min(80, draws.length)));
  const expectedAll = Math.max(1, draws.length / max);
  const expectedRecent = Math.max(1, Math.min(80, draws.length) / max);

  for (let n = 1; n <= max; n++) {
    let gap = draws.length;
    for (let i = draws.length - 1, g = 0; i >= 0; i--, g++) {
      if (draws[i][3] === n) { gap = g; break; }
    }
    scores[n] =
      clamp((all[n] || 0) / expectedAll, 0.35, 1.80) * 0.42 +
      clamp((recent[n] || 0) / expectedRecent, 0.20, 2.10) * 0.35 +
      clamp(gap / Math.min(draws.length || 1, 60), 0, 1.7) * 0.23;
  }
  return scores;
}

function pickBonus(draws) {
  const scoreMap = buildBonusScores(draws);
  const items = Object.entries(scoreMap).map(([n, w]) => ({ n: +n, w: Math.max(w, 0.05) }));
  return randomWeighted(items).n;
}

// ── Ball styles ───────────────────────────────────────
const ballStyles = [
  {bg:'rgba(240,192,64,.18)',bc:'#f0c040',c:'#f0c040'},
  {bg:'rgba(46,204,138,.15)',bc:'#2ecc8a',c:'#2ecc8a'},
  {bg:'rgba(29,199,187,.14)',bc:'#1dc7bb',c:'#1dc7bb'},
  {bg:'rgba(124,107,255,.14)',bc:'#7c6bff',c:'#7c6bff'},
  {bg:'rgba(240,144,48,.13)',bc:'#f09030',c:'#f09030'},
  {bg:'rgba(176,111,255,.13)',bc:'#b06fff',c:'#b06fff'},
];
const bonusStyle = {bg:'rgba(255,80,80,.18)',bc:'#ff6060',c:'#ff6060'};

function ballsHtml(nums, bonusNum) {
  let h = nums.map((n, i) =>
    `<div class="ball" style="background:${ballStyles[i%6].bg};border-color:${ballStyles[i%6].bc};color:${ballStyles[i%6].c}">${n}</div>`
  ).join('');
  if (bonusNum !== undefined) {
    h += `<div class="ball-sep">+</div><div class="ball bonus-ball" style="background:${bonusStyle.bg};border-color:${bonusStyle.bc};color:${bonusStyle.c}">${bonusNum}</div>`;
  }
  return h;
}

function pickFromTop(sorted, fallbackMax, topCount, offset = 0) {
  const pool = sorted.slice(offset, offset + topCount).map(([n]) => n);
  const fallback = Array.from({length: fallbackMax}, (_, i) => i + 1);
  const source = pool.length ? pool : fallback;
  return source[Math.floor(Math.random() * source.length)];
}

// ── Render Öneri ─────────────────────────────────────
function renderOneri(f, sorted, miss20) {
  const draws = allDraws();
  const balancedScores = buildNumberScores(draws, 'balanced');
  const trendScores = buildNumberScores(draws, 'trend');
  const overdueScores = buildNumberScores(draws, 'overdue');
  const final1 = generateCandidate(balancedScores, 'balanced');
  const final2 = generateCandidate(
    Object.fromEntries(Object.keys(trendScores).map(n => [
      n,
      (trendScores[n] * 0.58) + (overdueScores[n] * 0.42)
    ])),
    'trend'
  );
  const scorePct1 = Math.round(avg(final1.map(n => balancedScores[n])) * 100);
  const scorePct2 = Math.round(avg(final2.map(n => ((trendScores[n] * 0.58) + (overdueScores[n] * 0.42)))) * 100);

  // Şans Topu bonusu
  let bonusHtml1 = '', bonusHtml2 = '';
  if (LOTO_CONFIG.bonusMax) {
    const b1 = pickBonus(draws);
    let b2 = pickBonus(draws);
    if (LOTO_CONFIG.bonusMax > 1 && b2 === b1) b2 = pickBonus(draws);
    bonusHtml1 = `<div class="bonus-hint">🎯 Şans Topu önerisi: <span style="color:#ff6060;font-weight:700">${b1}</span></div>`;
    bonusHtml2 = `<div class="bonus-hint">🎯 Şans Topu önerisi: <span style="color:#ff6060;font-weight:700">${b2}</span></div>`;
  }

  document.getElementById('oGrid').innerHTML = `
    <div class="oneri-card">
      <h3>Kolon 1 — Dengeli İstatistik</h3>
      <p>Genel frekans, yakın dönem trendi, gecikme ve sayı dağılımı birlikte skorlanır. Skor: ${scorePct1}</p>
      <div class="balls">${ballsHtml(final1)}</div>
      ${bonusHtml1}
    </div>
    <div class="oneri-card">
      <h3>Kolon 2 — Trend + Gecikme</h3>
      <p>Son dönem hareketi ve gecikmiş sayı baskısı daha yüksek ağırlıkla hesaplanır. Skor: ${scorePct2}</p>
      <div class="balls">${ballsHtml(final2)}</div>
      ${bonusHtml2}
    </div>`;
}

// ── Ana render ────────────────────────────────────────
function render() {
  const draws = allDraws();
  const f = freq(draws);
  const sorted = Object.entries(f).map(([k, v]) => [+k, v]).sort((a, b) => b[1] - a[1]);
  const max = sorted[0][1];
  const miss30 = recentMissing(draws, 30);
  const miss20 = recentMissing(draws, 20);
  const trends = analyzeTrends(draws, 30);
  const hotNums = Object.entries(trends).filter(([, t]) => t.isHot).map(([n]) => +n);

  // Stats
  document.getElementById('sTotal').textContent = draws.length;
  document.getElementById('sTop').textContent = `${sorted[0][0]} (${sorted[0][1]}x)`;
  document.getElementById('sBot').textContent = `${sorted[sorted.length-1][0]} (${sorted[sorted.length-1][1]}x)`;
  document.getElementById('sMiss').textContent = miss30.length;
  document.getElementById('sHot').textContent = hotNums.length;
  document.getElementById('sGold').textContent = LOTO_CONFIG.goldNumbers.length;
  document.getElementById('hSub').textContent = `${draws.length} çekiliş · 1-${LOTO_CONFIG.maxNum} ${LOTO_CONFIG.gameName} · ${LOTO_CONFIG.sinceLabel}`;
  const allHfts = draws.map(d => d[0]);
  document.getElementById('iHft').value = (allHfts.length ? Math.max(...allHfts) : 0) + 1;
  document.getElementById('hBadge').textContent = `Son: ${draws[draws.length-1][1]}`;
  renderDrawStatus(draws);

  // Harita
  const grid = document.getElementById('gGrid');
  grid.innerHTML = '';
  for (let n = 1; n <= LOTO_CONFIG.maxNum; n++) {
    const c = f[n];
    const [cls] = colorClass(c, max);
    const d = document.createElement('div');
    d.className = 'gc ' + cls;
    d.title = `${n} → ${c} kez`;
    d.innerHTML = `<span class="gn">${n}</span><span class="gv">${c}</span>`;
    grid.appendChild(d);
  }

  // Sıralama
  const topEl = document.getElementById('rTop');
  const botEl = document.getElementById('rBot');
  topEl.innerHTML = '';
  botEl.innerHTML = '';
  sorted.slice(0, 20).forEach(([n, c]) => {
    const [, col] = colorClass(c, max);
    const pct = Math.round(c / max * 100);
    const row = `<div class="ri"><div class="rball" style="background:${col}18;border-color:${col};color:${col}">${n}</div><div class="rb-wrap"><div class="rb" style="width:${pct}%;background:${col}"></div></div><span class="rc">${c}x</span></div>`;
    topEl.innerHTML += row;
  });
  [...sorted].sort((a, b) => a[1] - b[1]).slice(0, 20).forEach(([n, c]) => {
    const [, col] = colorClass(c, max);
    const pct = Math.round(c / max * 100);
    botEl.innerHTML += `<div class="ri"><div class="rball" style="background:${col}18;border-color:${col};color:${col}">${n}</div><div class="rb-wrap"><div class="rb" style="width:${pct}%;background:${col}"></div></div><span class="rc">${c}x</span></div>`;
  });

  // Gecikmiş
  const mc = document.getElementById('cMiss');
  mc.innerHTML = miss30.sort((a, b) => f[b] - f[a]).map(n => {
    const [, col] = colorClass(f[n], max);
    return `<span class="chip" style="background:${col}15;border-color:${col};color:${col}">${n} <span style="opacity:.6;font-size:0.75rem">(${f[n]}x)</span></span>`;
  }).join('');

  // Hot numbers
  const hotEl = document.getElementById('gHot');
  hotEl.innerHTML = '';
  for (let n = 1; n <= LOTO_CONFIG.maxNum; n++) {
    const t = trends[n];
    const [cls] = colorClass(t.freq, max);
    const d2 = document.createElement('div');
    d2.className = 'gc ' + cls;
    d2.style.opacity = t.isHot ? '1' : '0.46';
    d2.title = `${n}: ${t.freq}x son 30`;
    d2.innerHTML = `<span class="gn">${n}</span><span class="gv">${t.freq}</span>`;
    hotEl.appendChild(d2);
  }

  // Gold
  const goldEl = document.getElementById('rGold');
  const goldStats = goldNumbers(draws);
  goldEl.innerHTML = goldStats.map(g => {
    const [, col] = colorClass(g.freq, max);
    const pct = Math.round(g.freq / max * 100);
    return `<div class="ri"><div class="rball" style="background:${col}18;border-color:${col};color:${col}">${g.num}</div><div class="rb-wrap"><div class="rb" style="width:${pct}%;background:${col}"></div></div><span class="rc">${g.freq}x</span></div>`;
  }).join('');

  // Çekiliş tablosu
  const cols2 = ['#2ecc8a','#1dc7bb','#8888b0','#f09030','#e85555','#7c6bff'];
  const tb = document.getElementById('tBody');
  const userKeys = new Set(userDraws.map(d => `${d[0]}_${d[1]}`));
  tb.innerHTML = [...draws].reverse().slice(0, 80).map(([hft, tarih, nums, bonus]) => {
    const isNew = userKeys.has(`${hft}_${tarih}`);
    const balls = nums.map((n, i) =>
      `<span class="mb" style="background:${cols2[i%6]}18;border-color:${cols2[i%6]};color:${cols2[i%6]}">${n}</span>`
    ).join('') + (bonus ? `<span class="mb bonus-mb" style="background:#ff606020;border-color:#ff6060;color:#ff6060">+${bonus}</span>` : '');
    const del = isNew ? `<button class="del" onclick="deleteDraw(${hft},'${tarih}')">✕</button>` : '';
    return `<tr${isNew?' class="newrow"':''}><td style="color:var(--text3);font-size:0.8rem">${hft}</td><td>${tarih}</td><td>${balls}</td><td>${del}</td></tr>`;
  }).join('');

  // Öneri
  renderOneri(f, sorted, miss20);
}

// ── Form ─────────────────────────────────────────────
function addDraw() {
  const errEl = document.getElementById('fErr');
  errEl.style.display = 'none';
  const hft = parseInt(document.getElementById('iHft').value);
  const date = document.getElementById('iDate').value.trim();
  const raw = document.getElementById('iNums').value.trim();
  const bonusRaw = document.getElementById('iBonus') ? document.getElementById('iBonus').value.trim() : '';

  if (!hft || hft < 1) return showErr('Hafta numarası gerekli.');
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) return showErr('Tarih: GG/AA/YYYY');
  if (allDraws().some(d => d[1] === date)) return showErr('Bu tarih zaten kayıtlı.');
  const parts = raw.split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
  const cnt = resultCount();
  if (parts.length !== cnt) return showErr(`Tam ${cnt} sayı giriniz.`);
  if (parts.some(n => n < 1 || n > LOTO_CONFIG.maxNum)) return showErr(`Sayılar 1-${LOTO_CONFIG.maxNum} arasında olmalı.`);
  if (new Set(parts).size !== cnt) return showErr('Tekrarsız sayılar giriniz.');

  let bonus = undefined;
  if (LOTO_CONFIG.bonusMax) {
    if (!bonusRaw) return showErr(`Şans Topu 1-${LOTO_CONFIG.bonusMax} arası girilmeli.`);
    bonus = parseInt(bonusRaw);
    if (isNaN(bonus) || bonus < 1 || bonus > LOTO_CONFIG.bonusMax) return showErr(`Şans Topu 1-${LOTO_CONFIG.bonusMax} arası.`);
  }

  userDraws.push([hft, date, parts.sort((a, b) => a - b), bonus]);
  saveUser();
  render();
  document.getElementById('iNums').value = '';
  document.getElementById('iDate').value = '';
  if (document.getElementById('iBonus')) document.getElementById('iBonus').value = '';
  toast('✓ Çekiliş eklendi');
}

function nextWeekForDate(draws, date) {
  const year = Number(String(date).slice(-4));
  const sameYear = draws.filter(d => String(d[1]).endsWith(`/${year}`));
  if (!sameYear.length) return 1;
  return Math.max(...sameYear.map(d => Number(d[0]) || 0)) + 1;
}

function normalizeImportDate(raw) {
  const txt = String(raw || '').trim().replace(/\./g, '/');
  const m = txt.replace(/-/g, '/').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
}

function importNumbersFromText(text) {
  return (String(text).match(/\d+/g) || []).map(Number).filter(n => Number.isInteger(n));
}

function parseImportBlock(lines, index) {
  const line = lines[index] || '';
  const clean = line.trim();
  if (!clean || /^\d{4}$/.test(clean) || clean.toLowerCase().startsWith('tarih')) return null;

  const dateMatch = clean.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b/);
  if (!dateMatch) return null;

  const date = normalizeImportDate(dateMatch[0]);
  const numsAfterDate = importNumbersFromText(clean.slice(dateMatch.index + dateMatch[0].length));
  let nextIndex = index;
  const needed = resultCount() + (LOTO_CONFIG.bonusMax ? 1 : 0);

  while (numsAfterDate.length < needed && nextIndex + 1 < lines.length) {
    const nextLine = (lines[nextIndex + 1] || '').trim();
    if (!nextLine || /^\d{4}$/.test(nextLine) || nextLine.toLowerCase().startsWith('tarih')) {
      nextIndex++;
      continue;
    }
    if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b/.test(nextLine)) break;
    numsAfterDate.push(...importNumbersFromText(nextLine));
    nextIndex++;
  }

  if (!date || numsAfterDate.length < resultCount()) return { error: 'Eksik sayı' };

  const hasWeek = numsAfterDate.length >= resultCount() + (LOTO_CONFIG.bonusMax ? 2 : 1);
  const week = hasWeek ? numsAfterDate[0] : undefined;
  const start = hasWeek ? 1 : 0;
  const count = resultCount();
  const nums = numsAfterDate.slice(start, start + count).sort((a, b) => a - b);
  const bonus = LOTO_CONFIG.bonusMax ? numsAfterDate[start + count] : undefined;

  if (nums.length !== count) return { error: 'Eksik sayı' };
  if (nums.some(n => n < 1 || n > LOTO_CONFIG.maxNum)) return { error: 'Sayı aralığı' };
  if (new Set(nums).size !== count) return { error: 'Tekrarlı sayı' };
  if (LOTO_CONFIG.bonusMax && (!Number.isInteger(bonus) || bonus < 1 || bonus > LOTO_CONFIG.bonusMax)) {
    return { error: 'Bonus aralığı' };
  }

  return { parsed: [week, date, nums, bonus], nextIndex };
}

function parseImportLine(line) {
  const result = parseImportBlock([line], 0);
  return result && result.parsed ? result.parsed : result;
}

function importDrawsFromText(text) {
  const current = allDraws();
  const existingDates = new Set(current.map(d => d[1]));
  const parsedDates = new Set();
  const additions = [];
  let skipped = 0;
  let invalid = 0;

  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const result = parseImportBlock(lines, i);
    if (!result) continue;
    if (result.error) { invalid++; continue; }
    i = result.nextIndex;
    const parsed = result.parsed;

    const [, date, nums, bonus] = parsed;
    if (existingDates.has(date) || parsedDates.has(date)) { skipped++; continue; }

    const week = Number.isInteger(parsed[0]) && parsed[0] > 0
      ? parsed[0]
      : nextWeekForDate([...current, ...additions], date);
    const draw = LOTO_CONFIG.bonusMax ? [week, date, nums, bonus] : [week, date, nums];
    additions.push(draw);
    parsedDates.add(date);
  }

  additions.sort((a, b) => drawDateKey(a) - drawDateKey(b));
  userDraws = [...userDraws, ...additions];
  saveUser();
  render();

  return { added: additions.length, skipped, invalid };
}

function importTxt() {
  const input = document.getElementById('iImportTxt');
  if (!input || !input.files || !input.files[0]) return showErr('TXT dosyası seçiniz.');

  const reader = new FileReader();
  reader.onload = () => {
    const result = importDrawsFromText(reader.result || '');
    const info = document.getElementById('importInfo');
    const msg = `${result.added} kayıt eklendi · ${result.skipped} mevcut · ${result.invalid} hatalı`;
    if (info) info.textContent = msg;
    input.value = '';
    toast(msg);
  };
  reader.onerror = () => showErr('TXT dosyası okunamadı.');
  reader.readAsText(input.files[0], 'UTF-8');
}

function deleteDraw(hft, tarih) {
  userDraws = userDraws.filter(d => !(d[0] === hft && d[1] === tarih));
  saveUser();
  render();
  toast('Silindi');
}

function regenerateOneri() {
  const draws = allDraws();
  const f = freq(draws);
  const sorted = Object.entries(f).map(([k, v]) => [+k, v]).sort((a, b) => b[1] - a[1]);
  const miss20 = recentMissing(draws, 20);
  renderOneri(f, sorted, miss20);
  toast('🔄 Yeni öneri üretildi');
}

function showErr(msg) {
  const e = document.getElementById('fErr');
  e.textContent = msg;
  e.style.display = 'block';
}

let _toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}

function exportCSV() {
  const numberHeaders = Array.from({length: resultCount()}, (_, i) => `S${i + 1}`);
  const rows = [['Hafta','Tarih', ...numberHeaders, 'Bonus']];
  for (const [h, t, n, b] of allDraws()) rows.push([h, t, ...n, b||'']);
  const csv = rows.map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = LOTO_CONFIG.csvName;
  a.click();
}

function dataFileMeta() {
  if (LOTO_CONFIG.storageKey === 'slUserDraws') return { file: 'data-sayisal.js', variable: 'SAYISAL_DATA' };
  if (LOTO_CONFIG.storageKey === 'superUserDraws') return { file: 'data-super.js', variable: 'SUPER_DATA' };
  if (LOTO_CONFIG.storageKey === 'sansUserDraws') return { file: 'data-sans.js', variable: 'SANS_DATA' };
  if (LOTO_CONFIG.storageKey === 'onNumaraUserDraws') return { file: 'data-onnumara.js', variable: 'ONNUMARA_DATA' };
  return { file: LOTO_CONFIG.csvName.replace(/\.csv$/i, '.js'), variable: 'LOTO_DATA' };
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/javascript;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function downloadDataFile() {
  const meta = dataFileMeta();
  const rows = allDraws().map(draw => JSON.stringify(draw)).join(',\n');
  downloadTextFile(meta.file, `var ${meta.variable} = [\n${rows}\n];\n`);
  toast(`${meta.file} indirildi`);
}

let _activeTab = 'harita';
function tab(id, btn) {
  document.getElementById('t-' + _activeTab).style.display = 'none';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  _activeTab = id;
  document.getElementById('t-' + id).style.display = '';
  btn.classList.add('on');
}

// Auto-format tarih
document.addEventListener('DOMContentLoaded', () => {
  const di = document.getElementById('iDate');
  if (di) di.addEventListener('input', function() {
    let v = this.value.replace(/\D/g,'');
    if (v.length >= 3) v = v.slice(0,2)+'/'+v.slice(2);
    if (v.length >= 6) v = v.slice(0,5)+'/'+v.slice(5);
    this.value = v.slice(0,10);
  });
  const ni = document.getElementById('iNums');
  if (ni) ni.addEventListener('keydown', e => { if(e.key==='Enter') addDraw(); });
  render();
});
