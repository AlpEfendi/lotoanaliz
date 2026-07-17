// ════════════════════════════════════════════════════
//  LOTO ANALİZ MOTORU v3 — Sayısal, Süper, Şans Topu
//  LOTO_CONFIG ile parametrize
// ════════════════════════════════════════════════════

function parseDisplayDate(value) {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1900 || year > 9999) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function formatInputDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

function isFutureDisplayDate(value, today = toDateOnly()) {
  const date = parseDisplayDate(value);
  return Boolean(date && date > today);
}

function normalizeDraw(draw) {
  if (!Array.isArray(draw) || draw.length < 3) return null;
  const week = Number(draw[0]);
  const date = String(draw[1] || '');
  const numbers = Array.isArray(draw[2]) ? draw[2].map(Number) : [];
  const count = resultCount();

  if (!Number.isInteger(week) || week < 1 || week > 9999 || !parseDisplayDate(date) || isFutureDisplayDate(date)) return null;
  if (numbers.length !== count || numbers.some(n => !Number.isInteger(n) || n < 1 || n > LOTO_CONFIG.maxNum)) return null;
  if (new Set(numbers).size !== count) return null;

  if (LOTO_CONFIG.bonusMax) {
    const bonus = Number(draw[3]);
    if (!Number.isInteger(bonus) || bonus < 1 || bonus > LOTO_CONFIG.bonusMax) return null;
    return [week, date, numbers.sort((a, b) => a - b), bonus];
  }
  return [week, date, numbers.sort((a, b) => a - b)];
}

function loadUserDraws() {
  try {
    const raw = localStorage.getItem(LOTO_CONFIG.storageKey);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) throw new Error('Yerel kayıt dizisi geçersiz');
    const valid = parsed.map(normalizeDraw).filter(Boolean);
    if (valid.length !== parsed.length) localStorage.setItem(LOTO_CONFIG.storageKey, JSON.stringify(valid));
    return valid;
  } catch {
    try { localStorage.removeItem(LOTO_CONFIG.storageKey); } catch {}
    return [];
  }
}

let userDraws = loadUserDraws();
function saveUser() {
  try {
    localStorage.setItem(LOTO_CONFIG.storageKey, JSON.stringify(userDraws));
    return true;
  } catch {
    return false;
  }
}

function queueDrawsLocally(draws) {
  const previous = userDraws;
  const additions = [];
  for (const rawDraw of draws) {
    const draw = normalizeDraw(rawDraw);
    if (!draw) continue;
    if ([...userDraws, ...additions].some(existing => sameDrawPayload(existing, draw))) continue;
    additions.push(draw);
  }
  if (!additions.length) return true;
  userDraws = [...userDraws, ...additions];
  if (saveUser()) return true;
  userDraws = previous;
  return false;
}

let cloudDraws = [];
let cloudClient = null;
let cloudSession = null;
let cloudIsAdmin = false;

function gameId() {
  if (LOTO_CONFIG.storageKey === 'slUserDraws') return 'sayisal';
  if (LOTO_CONFIG.storageKey === 'superUserDraws') return 'super';
  if (LOTO_CONFIG.storageKey === 'sansUserDraws') return 'sans';
  return 'onnumara';
}

function isoToDisplayDate(value) {
  const [year, month, day] = String(value || '').split('-');
  const display = year && month && day ? `${day}/${month}/${year}` : '';
  return parseDisplayDate(display) ? display : '';
}

function displayToIsoDate(value) {
  const date = parseDisplayDate(value);
  if (!date) return '';
  const [day, month, year] = String(value).split('/');
  return `${year}-${month}-${day}`;
}

function rowToDraw(row = {}) {
  const numbers = Array.isArray(row.numbers) ? row.numbers.map(Number) : [];
  const draw = [row.week_no, isoToDisplayDate(row.draw_date), numbers];
  if (row.bonus !== null && row.bonus !== undefined) draw.push(Number(row.bonus));
  return draw;
}

function drawToRow(draw) {
  return {
    game: gameId(),
    draw_date: displayToIsoDate(draw[1]),
    week_no: Number(draw[0]),
    numbers: draw[2].map(Number),
    bonus: draw[3] === undefined ? null : Number(draw[3])
  };
}
function drawDateKey(draw) {
  const [day, month, year] = String(draw[1] || '').split('/').map(Number);
  return year * 10000 + month * 100 + day;
}

function sameDrawPayload(left, right) {
  if (!left || !right) return false;
  const leftNumbers = Array.isArray(left[2]) ? left[2].map(Number) : [];
  const rightNumbers = Array.isArray(right[2]) ? right[2].map(Number) : [];
  return Number(left[0]) === Number(right[0])
    && String(left[1]) === String(right[1])
    && leftNumbers.length === rightNumbers.length
    && leftNumbers.every((number, index) => number === rightNumbers[index])
    && (left[3] === undefined ? null : Number(left[3])) === (right[3] === undefined ? null : Number(right[3]));
}

let _staticArchiveInfo;
function staticArchiveInfo() {
  if (_staticArchiveInfo) return _staticArchiveInfo;
  const draws = LOTO_CONFIG.data.map(normalizeDraw).filter(Boolean)
    .sort((a, b) => drawDateKey(a) - drawDateKey(b));
  const byDate = new Map(draws.map(draw => [draw[1], draw]));
  _staticArchiveInfo = {
    draws,
    byDate,
    startKey: draws.length ? drawDateKey(draws[0]) : 0,
    endKey: draws.length ? drawDateKey(draws[draws.length - 1]) : 0,
    latest: draws.at(-1) || null
  };
  return _staticArchiveInfo;
}

function isClosedStaticArchiveDate(date) {
  const info = staticArchiveInfo();
  const key = drawDateKey([0, date]);
  return Boolean(info.draws.length && key <= info.endKey);
}

const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

function drawToDate(draw) {
  return parseDisplayDate(draw?.[1]);
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
  // Bugünkü çekiliş henüz yapılmamış/yayımlanmamış olabilir; yalnız geçmiş
  // takvim günlerini kesin eksik sayarız.
  for (let d = addDays(lastDate, 1); d < today; d = addDays(d, 1)) {
    if (drawDays.includes(d.getDay())) count++;
  }
  return count;
}

function nextDrawDate(today, drawDays, startOffset = 0) {
  for (let i = startOffset; i <= 7; i++) {
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
  const todayIsDrawDay = drawDays.includes(today.getDay());
  const latestIsToday = toDateOnly(lastDate).getTime() === today.getTime();
  const todayAwaitingResult = todayIsDrawDay && !latestIsToday;
  const next = nextDrawDate(today, drawDays, latestIsToday ? 1 : 0);
  const dayInfo = `Çekiliş günleri: ${drawDayLabels(drawDays)}.`;
  const dateInfo = `Bugün ${formatLongDate(today)} ${TR_DAYS[today.getDay()]}; son ekli sonuç ${latest[1]}.`;

  if (due === 0) {
    if (todayAwaitingResult) {
      el.className = 'draw-status warn';
      el.textContent = `${dateInfo} Önceki çekilişe kadar veri güncel görünüyor. ${dayInfo} Bugünkü çekiliş sonucu yayımlandıktan sonra arşive eklenmelidir.`;
      return;
    }
    const nextInfo = next ? `Sıradaki çekiliş ${formatShortDate(next)} ${TR_DAYS[next.getDay()]}.` : '';
    el.className = 'draw-status ok';
    el.textContent = `${dateInfo} Veri güncel görünüyor. ${dayInfo} ${nextInfo}`.trim();
    return;
  }

  const missingText = due === 1 ? '1 çekiliş sonucu' : `${due} çekiliş sonucu`;
  const todayText = todayAwaitingResult ? ' Bugünkü çekiliş henüz sonuçlanmamış olabileceği için eksik sayısına dahil edilmedi.' : '';
  el.className = due >= 2 ? 'draw-status due' : 'draw-status warn';
  el.textContent = `${dateInfo} ${missingText} eksik olabilir. ${dayInfo}${todayText}`;
}

function drawYearWeekKey(draw) {
  const date = parseDisplayDate(draw?.[1]);
  return date ? `${date.getFullYear()}_${Number(draw[0])}` : '';
}

function canonicalArchiveInfo() {
  const staticInfo = staticArchiveInfo();
  const byDate = new Map(staticInfo.draws.map(draw => [draw[1], draw]));
  const staticYearWeekKeys = new Set(staticInfo.draws.map(drawYearWeekKey).filter(Boolean));
  const cloudGroupsByDate = new Map();
  const cloudConflicts = [];

  // Bulut yalnız yeni tarihleri tamamlar; paketlenmiş, doğrulanmış arşiv aynı
  // tarihte eski bir bulut satırı varsa yetkili kaynak olarak onu ezer.
  for (const rawDraw of cloudDraws) {
    const draw = normalizeDraw(rawDraw);
    if (!draw || drawDateKey(draw) <= staticInfo.endKey) continue;
    if (!cloudGroupsByDate.has(draw[1])) cloudGroupsByDate.set(draw[1], []);
    cloudGroupsByDate.get(draw[1]).push(draw);
  }

  const cloudCandidates = [];
  for (const originals of cloudGroupsByDate.values()) {
    const variants = [];
    for (const draw of originals) {
      if (!variants.some(variant => sameDrawPayload(draw, variant))) variants.push(draw);
    }
    if (variants.length !== 1) cloudConflicts.push(...originals);
    else cloudCandidates.push({ draw: variants[0], originals });
  }

  const candidatesByYearWeek = new Map();
  for (const group of cloudCandidates) {
    const key = drawYearWeekKey(group.draw);
    if (staticYearWeekKeys.has(key)) {
      cloudConflicts.push(...group.originals);
      continue;
    }
    if (!candidatesByYearWeek.has(key)) candidatesByYearWeek.set(key, []);
    candidatesByYearWeek.get(key).push(group);
  }

  const acceptedCloud = [];
  for (const groups of candidatesByYearWeek.values()) {
    if (groups.length === 1) acceptedCloud.push(groups[0]);
    else groups.forEach(group => cloudConflicts.push(...group.originals));
  }
  acceptedCloud.sort((left, right) => drawDateKey(left.draw) - drawDateKey(right.draw));
  for (const group of acceptedCloud) byDate.set(group.draw[1], group.draw);

  const yearWeekKeys = new Set([...byDate.values()].map(drawYearWeekKey).filter(Boolean));
  return {
    byDate,
    yearWeekKeys,
    staticInfo,
    cloudConflicts,
    cloudConflictDates: new Set(cloudConflicts.map(draw => draw[1])),
    cloudConflictYearWeekKeys: new Set(cloudConflicts.map(drawYearWeekKey).filter(Boolean))
  };
}

function localDrawPlan(canonical = canonicalArchiveInfo()) {
  const groupsByDate = new Map();
  for (const rawDraw of userDraws) {
    const draw = normalizeDraw(rawDraw);
    if (!draw) continue;
    if (!groupsByDate.has(draw[1])) groupsByDate.set(draw[1], []);
    groupsByDate.get(draw[1]).push(draw);
  }

  const acceptedCandidates = [];
  const staticMatches = [];
  const cloudMatches = [];
  const conflicts = [];

  for (const originals of groupsByDate.values()) {
    const variants = [];
    for (const draw of originals) {
      if (!variants.some(variant => sameDrawPayload(draw, variant))) variants.push(draw);
    }
    if (variants.length !== 1) {
      conflicts.push(...originals);
      continue;
    }

    const draw = variants[0];
    if (isClosedStaticArchiveDate(draw[1])) {
      const official = canonical.staticInfo.byDate.get(draw[1]);
      if (official && sameDrawPayload(draw, official)) staticMatches.push({ draw: official, originals });
      else conflicts.push(...originals);
      continue;
    }

    if (canonical.cloudConflictDates.has(draw[1])
      || canonical.cloudConflictYearWeekKeys.has(drawYearWeekKey(draw))) {
      conflicts.push(...originals);
      continue;
    }

    const canonicalDraw = canonical.byDate.get(draw[1]);
    if (canonicalDraw) {
      if (sameDrawPayload(draw, canonicalDraw)) cloudMatches.push({ draw: canonicalDraw, originals });
      else conflicts.push(...originals);
      continue;
    }

    if (canonical.yearWeekKeys.has(drawYearWeekKey(draw))) {
      conflicts.push(...originals);
      continue;
    }
    acceptedCandidates.push({ draw, originals });
  }

  const candidatesByYearWeek = new Map();
  for (const group of acceptedCandidates) {
    const key = drawYearWeekKey(group.draw);
    if (!candidatesByYearWeek.has(key)) candidatesByYearWeek.set(key, []);
    candidatesByYearWeek.get(key).push(group);
  }

  const accepted = [];
  for (const groups of candidatesByYearWeek.values()) {
    if (groups.length === 1) accepted.push(groups[0]);
    else groups.forEach(group => conflicts.push(...group.originals));
  }

  return { accepted, staticMatches, cloudMatches, conflicts };
}

function allDraws() {
  const canonical = canonicalArchiveInfo();
  const plan = localDrawPlan(canonical);
  for (const group of plan.accepted) canonical.byDate.set(group.draw[1], group.draw);
  return [...canonical.byDate.values()].sort((a, b) => drawDateKey(a) - drawDateKey(b));
}

function cloudArchivePlan() {
  const canonical = canonicalArchiveInfo();
  const plan = localDrawPlan(canonical);
  for (const group of plan.accepted) canonical.byDate.set(group.draw[1], group.draw);
  return {
    draws: [...canonical.byDate.values()].sort((a, b) => drawDateKey(a) - drawDateKey(b)),
    conflicts: [...canonical.cloudConflicts, ...plan.conflicts],
    cloudConflicts: canonical.cloudConflicts
  };
}

function quarantinedUserDraws() {
  return localDrawPlan().conflicts;
}

function renderLocalQuarantine() {
  const quarantined = quarantinedUserDraws();
  let panel = document.getElementById('localConflictStatus');
  if (!quarantined.length) {
    panel?.remove();
    return;
  }

  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'localConflictStatus';
    panel.className = 'draw-status due local-quarantine';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-labelledby', 'localConflictTitle');

    const title = document.createElement('strong');
    title.id = 'localConflictTitle';
    title.setAttribute('role', 'status');
    const detail = document.createElement('p');
    detail.className = 'quarantine-detail';
    const actions = document.createElement('div');
    actions.className = 'quarantine-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', 'Karantinadaki yerel kayıtları silme işlemleri');
    const remainder = document.createElement('p');
    remainder.className = 'quarantine-remainder';
    remainder.hidden = true;
    panel.append(title, detail, actions, remainder);

    const anchor = document.getElementById('cloudPanel') || document.getElementById('drawStatus');
    anchor?.insertAdjacentElement('afterend', panel);
  }

  const signature = JSON.stringify(quarantined);
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;

  const title = panel.querySelector('#localConflictTitle');
  title.textContent = `${quarantined.length} yerel kayıt karantinada`;
  const detail = panel.querySelector('.quarantine-detail');
  detail.textContent = 'Doğrulanmış arşiv veya bulut kaynağıyla uyuşmadığı için bu kayıtlar analize ve eşitlemeye katılmıyor. İnceleyip silebilirsiniz.';
  const actions = panel.querySelector('.quarantine-actions');
  actions.replaceChildren();

  quarantined.slice(0, 12).forEach(draw => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-sm';
    const preview = `${draw[2].slice(0, 6).join(', ')}${draw[2].length > 6 ? '…' : ''}`;
    button.textContent = `${draw[1]} · ${draw[0]}. hafta · ${preview} — sil`;
    button.setAttribute('aria-label', `${draw[0]}. hafta, ${draw[1]} tarihli, ${draw[2].join(', ')} sonuçlu yerel kaydı sil`);
    button.addEventListener('click', async () => {
      if (!window.confirm(`${draw[1]} tarihli seçili yerel kayıt kalıcı olarak silinsin mi?`)) return;
      await deleteDraw(draw[0], draw[1], draw);
      if (button.isConnected) return button.focus();
      const next = document.querySelector('#localConflictStatus .quarantine-actions button');
      if (next) return next.focus();
      const status = document.getElementById('drawStatus');
      if (status) {
        status.tabIndex = -1;
        status.focus();
      }
    });
    actions.appendChild(button);
  });

  const remainder = panel.querySelector('.quarantine-remainder');
  remainder.hidden = quarantined.length <= 12;
  if (!remainder.hidden) {
    remainder.textContent = `İlk 12 kayıt gösteriliyor; ${quarantined.length - 12} kayıt daha var.`;
  } else remainder.textContent = '';
}

function analysisDraws(draws = allDraws()) {
  const start = parseDisplayDate(LOTO_CONFIG.analysisStartDate);
  if (!start) return draws;
  return draws.filter(draw => {
    const date = drawToDate(draw);
    return date && date >= start;
  });
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
  if (p >= .85) return ['c5', 'var(--freq-c5)'];
  if (p >= .65) return ['c4', 'var(--freq-c4)'];
  if (p >= .45) return ['c3', 'var(--freq-c3)'];
  if (p >= .25) return ['c2', 'var(--freq-c2)'];
  return ['c1', 'var(--freq-c1)'];
}

function translucentColor(color, percentage = 9) {
  return `color-mix(in srgb, ${color} ${percentage}%, transparent)`;
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
  {bg:translucentColor('var(--ball-1)', 14),bc:'var(--ball-1)',c:'var(--ball-1)'},
  {bg:translucentColor('var(--ball-2)', 12),bc:'var(--ball-2)',c:'var(--ball-2)'},
  {bg:translucentColor('var(--ball-3)', 12),bc:'var(--ball-3)',c:'var(--ball-3)'},
  {bg:translucentColor('var(--ball-4)', 12),bc:'var(--ball-4)',c:'var(--ball-4)'},
  {bg:translucentColor('var(--ball-5)', 11),bc:'var(--ball-5)',c:'var(--ball-5)'},
  {bg:translucentColor('var(--ball-6)', 11),bc:'var(--ball-6)',c:'var(--ball-6)'},
];
const bonusStyle = {bg:translucentColor('var(--ball-bonus)', 14),bc:'var(--ball-bonus)',c:'var(--ball-bonus)'};

function ballsHtml(nums, bonusNum) {
  let h = nums.map((n, i) =>
    `<div class="ball" style="background:${ballStyles[i%6].bg};border-color:${ballStyles[i%6].bc};color:${ballStyles[i%6].c}">${n}</div>`
  ).join('');
  if (bonusNum !== undefined) {
    h += `<div class="ball-sep">+</div><div class="ball bonus-ball" style="background:${bonusStyle.bg};border-color:${bonusStyle.bc};color:${bonusStyle.c}">${bonusNum}</div>`;
  }
  return h;
}

// ── Render Öneri ─────────────────────────────────────
function renderOneri(draws = analysisDraws()) {
  const grid = document.getElementById('oGrid');
  if (!draws.length) {
    grid.textContent = 'Öneri üretmek için geçerli analiz verisi bulunamadı.';
    return;
  }
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

  grid.innerHTML = `
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
  const archiveDraws = allDraws();
  const draws = analysisDraws(archiveDraws);
  renderLocalQuarantine();
  if (!draws.length) {
    renderDrawStatus(archiveDraws);
    document.getElementById('sTotal').textContent = '0';
    document.getElementById('hSub').textContent = 'Geçerli analiz verisi bulunamadı.';
    document.getElementById('hBadge').textContent = archiveDraws.length ? `Son: ${archiveDraws[archiveDraws.length - 1][1]}` : '—';
    renderOneri([]);
    return;
  }
  const f = freq(draws);
  const sorted = Object.entries(f).map(([k, v]) => [+k, v]).sort((a, b) => b[1] - a[1]);
  const max = sorted[0][1];
  const miss30 = recentMissing(draws, 30);
  const trends = analyzeTrends(draws, 30);
  const hotNums = Object.entries(trends).filter(([, t]) => t.isHot).map(([n]) => +n);

  // Stats
  document.getElementById('sTotal').textContent = draws.length;
  document.getElementById('sTop').textContent = `${sorted[0][0]} (${sorted[0][1]}x)`;
  document.getElementById('sBot').textContent = `${sorted[sorted.length-1][0]} (${sorted[sorted.length-1][1]}x)`;
  document.getElementById('sMiss').textContent = miss30.length;
  document.getElementById('sHot').textContent = hotNums.length;
  document.getElementById('sGold').textContent = LOTO_CONFIG.goldNumbers.length;
  document.getElementById('hSub').textContent = `${draws.length} analiz çekilişi · 1-${LOTO_CONFIG.maxNum} ${LOTO_CONFIG.gameName} · ${LOTO_CONFIG.sinceLabel}`;
  updateWeekSuggestion(archiveDraws);
  document.getElementById('hBadge').textContent = `Son: ${archiveDraws[archiveDraws.length-1][1]}`;
  renderDrawStatus(archiveDraws);

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
    const row = `<div class="ri"><div class="rball" style="background:${translucentColor(col)};border-color:${col};color:${col}">${n}</div><div class="rb-wrap"><div class="rb" style="width:${pct}%;background:${col}"></div></div><span class="rc">${c}x</span></div>`;
    topEl.innerHTML += row;
  });
  [...sorted].sort((a, b) => a[1] - b[1]).slice(0, 20).forEach(([n, c]) => {
    const [, col] = colorClass(c, max);
    const pct = Math.round(c / max * 100);
    botEl.innerHTML += `<div class="ri"><div class="rball" style="background:${translucentColor(col)};border-color:${col};color:${col}">${n}</div><div class="rb-wrap"><div class="rb" style="width:${pct}%;background:${col}"></div></div><span class="rc">${c}x</span></div>`;
  });

  // Gecikmiş
  const mc = document.getElementById('cMiss');
  mc.innerHTML = miss30.sort((a, b) => f[b] - f[a]).map(n => {
    const [, col] = colorClass(f[n], max);
    return `<span class="chip" style="background:${translucentColor(col)};border-color:${col};color:${col}">${n} <span style="opacity:.6;font-size:0.75rem">(${f[n]}x)</span></span>`;
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
    return `<div class="ri"><div class="rball" style="background:${translucentColor(col)};border-color:${col};color:${col}">${g.num}</div><div class="rb-wrap"><div class="rb" style="width:${pct}%;background:${col}"></div></div><span class="rc">${g.freq}x</span></div>`;
  }).join('');

  // Çekiliş tablosu
  const cols2 = ['var(--green)','var(--teal)','var(--text3)','var(--orange)','var(--red)','var(--accent)'];
  const tb = document.getElementById('tBody');
  const userKeys = new Set([...userDraws, ...(cloudIsAdmin ? cloudDraws : [])].map(d => `${d[0]}_${d[1]}`));
  tb.innerHTML = [...archiveDraws].reverse().slice(0, 80).map(([hft, tarih, nums, bonus]) => {
    const isNew = userKeys.has(`${hft}_${tarih}`);
    const balls = nums.map((n, i) =>
      `<span class="mb" style="background:${translucentColor(cols2[i%6])};border-color:${cols2[i%6]};color:${cols2[i%6]}">${n}</span>`
    ).join('') + (bonus ? `<span class="mb bonus-mb" style="background:${translucentColor('var(--red)', 12)};border-color:var(--red);color:var(--red)">+${bonus}</span>` : '');
    const del = isNew
      ? `<button type="button" class="del" data-delete-week="${hft}" data-delete-date="${tarih}" aria-label="${hft}. hafta, ${tarih} tarihli çekilişi sil">✕</button>`
      : '';
    return `<tr${isNew?' class="newrow"':''}><td style="color:var(--text3);font-size:0.8rem">${hft}</td><td>${tarih}</td><td>${balls}</td><td>${del}</td></tr>`;
  }).join('');

  // Öneri
  renderOneri(draws);
}

// ── Form ─────────────────────────────────────────────
async function addDraw() {
  clearFormError();
  const validation = validateNewDrawInput({
    week: document.getElementById('iHft').value,
    date: document.getElementById('iDate').value.trim(),
    numbers: document.getElementById('iNums').value.trim(),
    bonus: document.getElementById('iBonus')?.value.trim() || ''
  });
  if (validation.error) return showErr(validation.error, validation.fieldId);
  const draw = validation.draw;

  if (cloudSession && cloudIsAdmin && cloudClient) {
    const cloudResult = await insertNewCloudDraws([draw]);
    if (cloudResult.stored.length === 1) {
      clearAddForm();
      render();
      toast('Çekiliş tüm cihazlara eklendi');
    } else {
      const locallyPending = [...cloudResult.conflicts, ...cloudResult.pending];
      if (!locallyPending.length || !queueDrawsLocally(locallyPending)) {
        return showErr('Yerel depolamaya yazılamadı. Tarayıcı depolama iznini kontrol edin.');
      }
      clearAddForm();
      render();
      const message = cloudResult.conflicts.length
        ? 'Aynı tarihte farklı bulut kaydı bulundu; yerel sürüm çakışma kuyruğunda korundu.'
        : 'Buluta yazılamadı; yerel kaydedildi ve daha sonra yeniden denenecek.';
      toast(message, 'warn');
    }
  } else {
    if (!queueDrawsLocally([draw])) {
      return showErr('Yerel depolamaya yazılamadı. Tarayıcı depolama iznini kontrol edin.');
    }
    clearAddForm();
    render();
    const message = cloudSession && !cloudIsAdmin
      ? 'Yerel olarak eklendi (bu hesapta yönetici yetkisi yok)'
      : 'Yerel olarak eklendi (giriş yapınca buluta senkronize edilir)';
    toast(message, 'warn');
  }
}

function clearAddForm() {
  clearFormError();
  document.getElementById('iNums').value = '';
  document.getElementById('iDate').value = '';
  if (document.getElementById('iBonus')) document.getElementById('iBonus').value = '';
  const weekInput = document.getElementById('iHft');
  if (weekInput) weekInput.dataset.userEdited = 'false';
  updateWeekSuggestion(allDraws(), true);
}

function nextWeekForDate(draws, date) {
  const parsed = parseDisplayDate(date);
  if (!parsed) return null;
  const year = parsed.getFullYear();
  const sameYear = draws.filter(draw => drawToDate(draw)?.getFullYear() === year);
  if (!sameYear.length) return 1;
  return Math.max(...sameYear.map(d => Number(d[0]) || 0)) + 1;
}

function updateWeekSuggestion(draws = allDraws(), force = false) {
  const weekInput = document.getElementById('iHft');
  if (!weekInput || (!force && weekInput.dataset.userEdited === 'true')) return;
  const dateInput = document.getElementById('iDate');
  const date = parseDisplayDate(dateInput?.value) ? dateInput.value : formatInputDate(toDateOnly());
  const next = nextWeekForDate(draws, date);
  if (next !== null) weekInput.value = next;
}

function parseIntegerList(raw) {
  const text = String(raw || '').trim();
  if (!text) return { error: 'Sayılar gerekli.' };
  const tokens = text.split(/[\s,]+/);
  if (tokens.some(token => !/^\d+$/.test(token))) return { error: 'Yalnızca tam sayıları boşluk veya virgülle ayırın.' };
  return { values: tokens.map(Number) };
}

function validateNewDrawInput(input, draws = allDraws(), today = toDateOnly()) {
  const weekText = String(input.week || '').trim();
  if (!/^\d+$/.test(weekText) || !Number.isInteger(Number(weekText)) || Number(weekText) < 1 || Number(weekText) > 9999) {
    return { error: '1–9999 arasında geçerli bir hafta numarası giriniz.', fieldId: 'iHft' };
  }
  const week = Number(weekText);
  const date = String(input.date || '').trim();
  const parsedDate = parseDisplayDate(date);
  if (!parsedDate) return { error: 'Geçerli bir tarih giriniz: GG/AA/YYYY.', fieldId: 'iDate' };
  if (parsedDate > today) return { error: 'Gelecek tarihli çekiliş eklenemez.', fieldId: 'iDate' };
  if (draws.some(draw => draw[1] === date)) return { error: 'Bu tarih zaten kayıtlı.', fieldId: 'iDate' };
  if (isClosedStaticArchiveDate(date)) {
    return {
      error: `Doğrulanmış paket arşivi ${staticArchiveInfo().latest[1]} tarihine kadar kapalıdır; yalnız daha yeni sonuç ekleyin.`,
      fieldId: 'iDate'
    };
  }
  if (userDraws.some(draw => draw[1] === date)) {
    return { error: 'Bu tarih yerel bekleme veya çakışma kuyruğunda; önce mevcut yerel kaydı çözün.', fieldId: 'iDate' };
  }
  if (draws.some(draw => Number(draw[0]) === week && drawToDate(draw)?.getFullYear() === parsedDate.getFullYear())) {
    return { error: `${parsedDate.getFullYear()} yılı için ${week}. çekiliş numarası zaten kayıtlı.`, fieldId: 'iHft' };
  }
  if (userDraws.some(draw => Number(draw[0]) === week && drawToDate(draw)?.getFullYear() === parsedDate.getFullYear())) {
    return { error: `${parsedDate.getFullYear()} yılı için ${week}. çekiliş numarası yerel kuyrukta zaten var.`, fieldId: 'iHft' };
  }

  const parsedNumbers = parseIntegerList(input.numbers);
  if (parsedNumbers.error) return { error: parsedNumbers.error, fieldId: 'iNums' };
  const count = resultCount();
  const numbers = parsedNumbers.values;
  if (numbers.length !== count) return { error: `Tam ${count} sayı giriniz.`, fieldId: 'iNums' };
  if (numbers.some(n => !Number.isInteger(n) || n < 1 || n > LOTO_CONFIG.maxNum)) {
    return { error: `Sayılar 1-${LOTO_CONFIG.maxNum} arasında tam sayı olmalı.`, fieldId: 'iNums' };
  }
  if (new Set(numbers).size !== count) return { error: 'Tekrarsız sayılar giriniz.', fieldId: 'iNums' };

  if (LOTO_CONFIG.bonusMax) {
    const bonusText = String(input.bonus || '').trim();
    if (!/^\d+$/.test(bonusText)) {
      return { error: `Şans Topu 1-${LOTO_CONFIG.bonusMax} arasında tam sayı olmalı.`, fieldId: 'iBonus' };
    }
    const bonus = Number(bonusText);
    if (!Number.isInteger(bonus) || bonus < 1 || bonus > LOTO_CONFIG.bonusMax) {
      return { error: `Şans Topu 1-${LOTO_CONFIG.bonusMax} arasında olmalı.`, fieldId: 'iBonus' };
    }
    return { draw: [week, date, numbers.sort((a, b) => a - b), bonus] };
  }

  return { draw: [week, date, numbers.sort((a, b) => a - b)] };
}

function normalizeImportDate(raw) {
  const txt = String(raw || '').trim().replace(/\./g, '/');
  const m = txt.replace(/-/g, '/').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const normalized = `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
  return parseDisplayDate(normalized) ? normalized : '';
}

function importNumbersFromText(text) {
  const source = String(text || '');
  if (/(?:^|[^\p{L}\d])-\s*\d/u.test(source) || /(?:^|[^\p{L}\d])\d+\.\d+(?=$|[^\p{L}\d])/u.test(source)) {
    return { values: [], error: 'Yalnızca pozitif tam sayı' };
  }
  const values = [...source.matchAll(/(?:^|[^\p{L}\d-])\+?(\d+)(?=$|[^\p{L}\d])/gu)]
    .map(match => Number(match[1]));
  return { values, error: '' };
}

function parseImportBlock(lines, index) {
  const line = lines[index] || '';
  const clean = line.trim();
  if (!clean || /^\d{4}$/.test(clean) || clean.toLowerCase().startsWith('tarih')) return null;

  const dateMatch = clean.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b/);
  if (!dateMatch) return null;

  const date = normalizeImportDate(dateMatch[0]);
  const firstNumbers = importNumbersFromText(clean.slice(dateMatch.index + dateMatch[0].length));
  if (firstNumbers.error) return { error: firstNumbers.error };
  const numsAfterDate = firstNumbers.values;
  let nextIndex = index;
  const needed = resultCount() + (LOTO_CONFIG.bonusMax ? 1 : 0);
  const importWeekMode = LOTO_CONFIG.importWeekMode || 'preferred';
  const targetValues = needed + (importWeekMode === 'absent' ? 0 : 1);

  while (numsAfterDate.length < targetValues && nextIndex + 1 < lines.length) {
    const nextLine = (lines[nextIndex + 1] || '').trim();
    if (!nextLine || /^\d{4}$/.test(nextLine) || nextLine.toLowerCase().startsWith('tarih')) {
      nextIndex++;
      continue;
    }
    if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b/.test(nextLine)) break;
    const parsedContinuation = importNumbersFromText(nextLine);
    if (parsedContinuation.error) return { error: parsedContinuation.error };
    const continuation = parsedContinuation.values;
    if (!continuation.length) {
      if (numsAfterDate.length >= needed) break;
      nextIndex++;
      continue;
    }
    // Sonuç sayısı zaten tamamlandıysa yalnız salt sayı listesi gerçek bir
    // satır devamı sayılır; ikramiye/tanıtım metinlerindeki rakamlar yutulmaz.
    if (numsAfterDate.length >= needed && !/^[\d\s,;+|]+$/.test(nextLine)) break;
    if (numsAfterDate.length + continuation.length > targetValues) return { error: 'Fazla sayı' };
    numsAfterDate.push(...continuation);
    nextIndex++;
  }

  if (!date || numsAfterDate.length < needed) return { error: 'Eksik sayı' };
  if (numsAfterDate.length > targetValues) return { error: 'Fazla sayı' };
  if (importWeekMode === 'absent' && numsAfterDate.length !== needed) return { error: 'Fazla sayı' };
  if (importWeekMode !== 'absent' && numsAfterDate.length !== needed && numsAfterDate.length !== needed + 1) {
    return { error: 'Fazla sayı' };
  }

  const hasWeek = importWeekMode !== 'absent' && numsAfterDate.length === needed + 1;
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

async function importDrawsFromText(text) {
  const current = allDraws();
  const localCurrent = userDraws.map(normalizeDraw).filter(Boolean);
  const existingDates = new Set([...current, ...localCurrent].map(d => d[1]));
  const parsedDates = new Set();
  const parsedAdditions = [];
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
    if (isFutureDisplayDate(date)) { invalid++; continue; }
    if (isClosedStaticArchiveDate(date)) { invalid++; continue; }

    parsedAdditions.push({ week: parsed[0], date, nums, bonus });
    parsedDates.add(date);
  }

  parsedAdditions.sort((a, b) => drawDateKey([0, a.date]) - drawDateKey([0, b.date]));
  const additions = [];
  const usedWeekKeys = new Set([...current, ...localCurrent].map(draw => `${drawToDate(draw)?.getFullYear()}_${draw[0]}`));
  for (const parsed of parsedAdditions) {
    const year = parseDisplayDate(parsed.date).getFullYear();
    const hasExplicitWeek = parsed.week !== undefined;
    if (hasExplicitWeek && (!Number.isInteger(parsed.week) || parsed.week < 1 || parsed.week > 9999)) {
      invalid++;
      continue;
    }
    const week = hasExplicitWeek ? parsed.week : nextWeekForDate([...current, ...additions], parsed.date);
    const weekKey = `${year}_${week}`;
    if (usedWeekKeys.has(weekKey)) { invalid++; continue; }
    const draw = LOTO_CONFIG.bonusMax
      ? [week, parsed.date, parsed.nums, parsed.bonus]
      : [week, parsed.date, parsed.nums];
    additions.push(draw);
    usedWeekKeys.add(weekKey);
  }

  if (!additions.length) {
    render();
    return { added: 0, skipped, invalid };
  }

  if (cloudSession && cloudIsAdmin && cloudClient) {
    const cloudResult = await insertNewCloudDraws(additions);
    const locallyPending = [...cloudResult.conflicts, ...cloudResult.pending];
    if (locallyPending.length) {
      if (!queueDrawsLocally(locallyPending)) {
        return { added: 0, skipped, invalid, error: 'Yerel depolamaya yazılamadı.' };
      }
      render();
      const warning = cloudResult.conflicts.length
        ? `${cloudResult.conflicts.length} aynı tarihli farklı kayıt yerel çakışma kuyruğunda korundu.`
        : 'Buluta yazılamayan kayıtlar yerel kuyruğa alındı.';
      return { added: additions.length, skipped, invalid, warning };
    }
  } else {
    if (!queueDrawsLocally(additions)) {
      return { added: 0, skipped, invalid, error: 'Yerel depolamaya yazılamadı.' };
    }
    if (cloudSession && !cloudIsAdmin) {
      render();
      return { added: additions.length, skipped, invalid, warning: 'Yönetici yetkisi yok; yerel kaydedildi.' };
    }
  }
  render();

  return { added: additions.length, skipped, invalid };
}

function importTxt() {
  clearFormError();
  const input = document.getElementById('iImportTxt');
  if (!input || !input.files || !input.files[0]) return showErr('TXT dosyası seçiniz.', 'iImportTxt');

  const reader = new FileReader();
  reader.onload = async () => {
    const result = await importDrawsFromText(reader.result || '');
    const info = document.getElementById('importInfo');
    const msg = result.error || result.warning || `${result.added} kayıt eklendi · ${result.skipped} mevcut · ${result.invalid} hatalı`;
    if (info) info.textContent = msg;
    input.value = '';
    toast(msg);
  };
  reader.onerror = () => showErr('TXT dosyası okunamadı.');
  reader.readAsText(input.files[0], 'UTF-8');
}

async function deleteDraw(hft, tarih, targetLocalDraw = null) {
  clearFormError();
  const previous = [...userDraws];
  const localIndex = userDraws.findIndex(draw => targetLocalDraw
    ? sameDrawPayload(draw, targetLocalDraw)
    : Number(draw[0]) === Number(hft) && draw[1] === tarih);
  const hasLocalRecord = localIndex !== -1;
  const hasCloudRecord = cloudDraws.some(d => d[1] === tarih);

  // Yerel kuyruğu önce kalıcı olarak temizle; böylece başarılı bulut silmesi
  // sonrasında eski bir localStorage satırı kaydı yeniden diriltemez.
  if (hasLocalRecord) {
    userDraws = userDraws.filter((_, index) => index !== localIndex);
    if (!saveUser()) {
      userDraws = previous;
      return showErr('Yerel kayıt silinemedi. Tarayıcı depolama iznini kontrol edin.');
    }
    render();
    const message = hasCloudRecord
      ? 'Yerel kuyruk kaydı silindi; bulut sürümü korundu.'
      : 'Yerel kayıt silindi';
    return toast(message, 'warn');
  }

  if (hasCloudRecord) {
    if (!cloudSession || !cloudIsAdmin || !cloudClient) {
      return showErr('Bulut kaydını silmek için yetkili yönetici girişi gerekli.');
    }

    try {
      const { data, error } = await cloudClient.from('loto_draws')
        .delete()
        .eq('game', gameId())
        .eq('draw_date', displayToIsoDate(tarih))
        .select('draw_date');
      if (error || !Array.isArray(data) || data.length !== 1) {
        const reason = error?.message || 'Kayıt bulunamadı veya silme yetkisi reddedildi.';
        return showErr(`Silinemedi: ${reason}`);
      }
      cloudDraws = cloudDraws.filter(d => d[1] !== tarih);
    } catch (e) {
      return showErr(`Buluttan silinemedi: ${e.message || 'ağ hatası'}`);
    }
  }

  if (!hasLocalRecord && !hasCloudRecord) return showErr('Silinecek kayıt bulunamadı.');
  render();
  toast('Bulut kaydı silindi');
}

function regenerateOneri() {
  renderOneri(analysisDraws());
  toast('🔄 Yeni öneri üretildi');
}

function clearFormError() {
  const e = document.getElementById('fErr');
  if (!e) return;
  const fieldId = e.dataset.fieldId || '';
  const field = fieldId ? document.getElementById(fieldId) : null;
  if (field) {
    field.removeAttribute('aria-invalid');
    const describedBy = (field.getAttribute('aria-describedby') || '')
      .split(/\s+/).filter(Boolean).filter(id => id !== 'fErr');
    if (describedBy.length) field.setAttribute('aria-describedby', describedBy.join(' '));
    else field.removeAttribute('aria-describedby');
  }
  delete e.dataset.fieldId;
  e.textContent = '';
  e.style.display = 'none';
}

function showErr(msg, fieldId = '') {
  clearFormError();
  const e = document.getElementById('fErr');
  if (!e) return;
  e.textContent = msg;
  e.style.display = 'block';
  if (fieldId) {
    const field = document.getElementById(fieldId);
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      const describedBy = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      describedBy.add('fErr');
      field.setAttribute('aria-describedby', [...describedBy].join(' '));
      e.dataset.fieldId = fieldId;
      field.focus();
    }
  }
}

let _toastTimer;
function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('warn', 'err');
  if (kind === 'warn' || kind === 'err') t.classList.add(kind);
  t.classList.add('on');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    t.classList.remove('on', 'warn', 'err');
    t.textContent = '';
  }, 2400);
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

const TAB_IDS = ['harita', 'siralama', 'gecikme', 'hot', 'gold', 'tablo'];
let _activeTab = 'harita';

function buttonTabId(button) {
  const controlledPanel = button?.getAttribute?.('aria-controls') || '';
  return button?.dataset?.tabTarget || controlledPanel.replace(/^t-/, '');
}

// Global adı eski inline çağrılarla geriye uyumluluk için korunur.
function tab(id, btn, shouldFocus = false) {
  if (!TAB_IDS.includes(id)) return;
  const targetPanel = document.getElementById(`t-${id}`);
  if (!targetPanel) return;

  const buttons = Array.from(document.querySelectorAll('.tab'));
  const targetButton = btn || buttons.find(button => buttonTabId(button) === id);
  _activeTab = id;

  TAB_IDS.forEach(tabId => {
    const panel = document.getElementById(`t-${tabId}`);
    if (!panel) return;
    const isActive = tabId === id;
    panel.hidden = !isActive;
    // Eski HTML sürümlerindeki inline display değerleriyle de uyumlu kalır.
    panel.style.display = isActive ? '' : 'none';
  });

  buttons.forEach(button => {
    const isActive = button === targetButton;
    button.classList.toggle('on', isActive);
    button.setAttribute('aria-selected', String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });

  if (shouldFocus) targetButton?.focus();
}

function initTabs() {
  const buttons = Array.from(document.querySelectorAll('.tab[data-tab-target]'));
  if (!buttons.length) return;

  buttons.forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      tab(button.dataset.tabTarget, button);
    });

    button.addEventListener('keydown', event => {
      const currentIndex = buttons.indexOf(button);
      let nextIndex = null;

      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length;
      if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = buttons.length - 1;
      if (nextIndex === null) return;

      event.preventDefault();
      const nextButton = buttons[nextIndex];
      tab(nextButton.dataset.tabTarget, nextButton, true);
    });
  });

  const initialButton = buttons.find(button => button.getAttribute('aria-selected') === 'true')
    || buttons.find(button => button.classList.contains('on'))
    || buttons[0];
  tab(initialButton.dataset.tabTarget, initialButton);
}

function bindDataActions() {
  const handlers = {
    'import-txt': importTxt,
    'download-data': downloadDataFile,
    'export-csv': exportCSV,
    regenerate: regenerateOneri
  };

  document.querySelectorAll('[data-action]').forEach(button => {
    const handler = handlers[button.dataset.action];
    if (!handler) return;
    button.addEventListener('click', event => {
      event.preventDefault();
      handler();
    });
  });
}

function bindDeleteActions() {
  const tableBody = document.getElementById('tBody');
  if (!tableBody) return;
  tableBody.addEventListener('click', async event => {
    const button = event.target.closest?.('button.del[data-delete-week][data-delete-date]');
    if (!button || !tableBody.contains(button)) return;
    if (!window.confirm(`${button.dataset.deleteDate} tarihli kayıt kalıcı olarak silinsin mi?`)) return;
    const buttons = [...tableBody.querySelectorAll('button.del[data-delete-week][data-delete-date]')];
    const buttonIndex = buttons.indexOf(button);
    await deleteDraw(Number(button.dataset.deleteWeek), button.dataset.deleteDate);
    if (button.isConnected) return button.focus();
    const remaining = [...tableBody.querySelectorAll('button.del[data-delete-week][data-delete-date]')];
    const next = remaining[Math.min(buttonIndex, remaining.length - 1)] || tableBody.closest('.tbl-wrap');
    next?.focus();
  });
}

let cloudState = 'idle';
let supabaseLoadPromise = null;
let cloudAdminReady = null;

function appendCloudSummary(panel, title, detail) {
  const summary = document.createElement('div');
  summary.className = 'cloud-summary';
  summary.setAttribute('role', 'status');
  summary.setAttribute('aria-live', 'polite');
  summary.setAttribute('aria-atomic', 'true');
  const strong = document.createElement('strong');
  const span = document.createElement('span');
  strong.textContent = title;
  span.textContent = detail;
  summary.append(strong, span);
  panel.appendChild(summary);
}

function createCloudButton(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-sm';
  button.textContent = label;
  if (handler) button.addEventListener('click', handler);
  return button;
}

function renderCloudPanel() {
  let panel = document.getElementById('cloudPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'cloudPanel';
    panel.className = 'cloud-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Bulut bağlantısı');
    document.getElementById('drawStatus')?.insertAdjacentElement('afterend', panel);
  }
  panel.replaceChildren();

  if (cloudSession) {
    const actions = document.createElement('div');
    actions.className = 'cloud-actions';
    if (cloudIsAdmin) {
      appendCloudSummary(panel, 'Bulut senkronizasyonu açık', cloudSession.user?.email || 'Yönetici');
      actions.append(
        createCloudButton('Mevcut arşivi buluta aktar', syncArchiveToCloud),
        createCloudButton('Çıkış', cloudLogout)
      );
    } else {
      appendCloudSummary(
        panel,
        'Yönetici yetkisi yok',
        `${cloudSession.user?.email || 'Bu hesap'} yönetici listesinde değil; kayıtlar yerel tutulur.`
      );
      actions.append(createCloudButton('Çıkış', cloudLogout));
    }
    panel.appendChild(actions);
    return;
  }

  if (cloudState === 'loading') {
    appendCloudSummary(panel, 'Bulut bağlantısı hazırlanıyor', 'Yerel arşiv ve analiz kullanılabilir.');
    return;
  }

  if (!cloudClient) {
    appendCloudSummary(panel, 'Çevrimdışı mod', 'Bulut bağlantısı kurulamadı; yerel arşiv kullanılmaya devam ediyor.');
    return;
  }

  if (cloudAdminReady === false) {
    appendCloudSummary(
      panel,
      'Bulut arşivi salt okunur',
      'Yönetici güvenlik ayarları tamamlanana kadar doğrulanmış yerel arşiv kullanılmaya devam eder.'
    );
    return;
  }

  appendCloudSummary(panel, 'Yönetici girişi', 'Buluta kaydetmek ve cihazlar arasında eşitlemek için giriş yapın.');
  const login = document.createElement('form');
  login.className = 'cloud-login';
  login.addEventListener('submit', event => {
    event.preventDefault();
    cloudLogin();
  });
  const email = document.createElement('input');
  email.id = 'cloudEmail';
  email.name = 'email';
  email.type = 'email';
  email.placeholder = 'E-posta…';
  email.autocomplete = 'username';
  email.spellcheck = false;
  email.required = true;
  email.setAttribute('aria-label', 'Yönetici e-postası');
  const password = document.createElement('input');
  password.id = 'cloudPassword';
  password.name = 'password';
  password.type = 'password';
  password.placeholder = 'Şifre…';
  password.autocomplete = 'current-password';
  password.required = true;
  password.setAttribute('aria-label', 'Yönetici şifresi');
  const submit = createCloudButton('Giriş');
  submit.type = 'submit';
  const error = document.createElement('div');
  error.id = 'cloudErr';
  error.className = 'err cloud-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  email.addEventListener('input', clearCloudError);
  password.addEventListener('input', clearCloudError);
  login.append(email, password, submit, error);
  panel.appendChild(login);
}

function clearCloudError() {
  const error = document.getElementById('cloudErr');
  if (!error) return;
  const fieldId = error.dataset.fieldId;
  const field = fieldId ? document.getElementById(fieldId) : null;
  if (field) {
    field.removeAttribute('aria-invalid');
    const describedBy = (field.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter(id => id && id !== 'cloudErr');
    if (describedBy.length) field.setAttribute('aria-describedby', describedBy.join(' '));
    else field.removeAttribute('aria-describedby');
  }
  delete error.dataset.fieldId;
  error.textContent = '';
  error.hidden = true;
}

function showCloudError(message, fieldId = '') {
  clearCloudError();
  const error = document.getElementById('cloudErr');
  if (!error) return showErr(message, fieldId);
  error.textContent = message;
  error.hidden = false;
  if (!fieldId) return;
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.setAttribute('aria-invalid', 'true');
  const describedBy = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  describedBy.add('cloudErr');
  field.setAttribute('aria-describedby', [...describedBy].join(' '));
  error.dataset.fieldId = fieldId;
  field.focus();
}

function ensureSupabaseLibrary() {
  if (window.supabase) return Promise.resolve(true);
  if (supabaseLoadPromise) return supabaseLoadPromise;
  const libraryUrl = window.SUPABASE_CONFIG?.libraryUrl;
  if (!libraryUrl) return Promise.resolve(false);

  supabaseLoadPromise = new Promise(resolve => {
    const script = document.createElement('script');
    script.src = libraryUrl;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), 10000);
    script.addEventListener('load', () => finish(Boolean(window.supabase)), { once: true });
    script.addEventListener('error', () => finish(false), { once: true });
    document.head.appendChild(script);
  });
  return supabaseLoadPromise;
}

async function loadCloudDraws() {
  if (!cloudClient) return { ok: false, error: 'Bulut istemcisi hazır değil.' };
  try {
    const pageSize = 1000;
    const rows = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await cloudClient
        .from('loto_draws')
        .select('week_no,draw_date,numbers,bonus')
        .eq('game', gameId())
        .order('draw_date', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        return { ok: false, error: error.message };
      }

      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }

    cloudDraws = rows.map(rowToDraw).map(normalizeDraw).filter(Boolean);
    return { ok: true, count: cloudDraws.length };
  } catch (e) {
    return { ok: false, error: e.message || 'ağ hatası' };
  }
}

async function insertNewCloudDraws(draws, retries = 1) {
  if (!draws.length) return { stored: [], conflicts: [], pending: [] };
  let response;
  try {
    response = await cloudClient.from('loto_draws').insert(draws.map(drawToRow));
  } catch (e) {
    return { stored: [], conflicts: [], pending: draws, error: e.message || 'ağ hatası' };
  }

  if (!response.error) {
    cloudDraws = [...cloudDraws, ...draws];
    return { stored: draws, conflicts: [], pending: [] };
  }
  if (response.error.code !== '23505') {
    return { stored: [], conflicts: [], pending: draws, error: response.error.message };
  }

  const refreshed = await loadCloudDraws();
  if (!refreshed.ok) {
    return { stored: [], conflicts: [], pending: draws, error: refreshed.error };
  }
  const cloudByDate = new Map(cloudDraws.map(draw => [draw[1], draw]));
  const cloudByYearWeek = new Map(cloudDraws.map(draw => [drawYearWeekKey(draw), draw]));
  const stored = [];
  const conflicts = [];
  const missing = [];
  for (const draw of draws) {
    const cloudDraw = cloudByDate.get(draw[1]);
    const weekConflict = cloudByYearWeek.get(drawYearWeekKey(draw));
    if (!cloudDraw && weekConflict) conflicts.push(draw);
    else if (!cloudDraw) missing.push(draw);
    else if (sameDrawPayload(draw, cloudDraw)) stored.push(draw);
    else conflicts.push(draw);
  }

  if (missing.length && retries > 0) {
    const retried = await insertNewCloudDraws(missing, retries - 1);
    return {
      stored: [...stored, ...retried.stored],
      conflicts: [...conflicts, ...retried.conflicts],
      pending: retried.pending,
      error: retried.error
    };
  }
  return {
    stored,
    conflicts,
    pending: missing,
    error: missing.length ? 'Aynı tarih için eşzamanlı kayıt yarışı çözülemedi.' : ''
  };
}

async function checkCloudAdmin() {
  if (!cloudSession || !cloudClient) return false;
  try {
    const { data, error } = await cloudClient.rpc('is_loto_admin');
    return !error && data === true;
  } catch {
    return false;
  }
}

async function checkCloudAdminSchema() {
  if (!cloudClient) return false;
  try {
    const { error } = await cloudClient.rpc('is_loto_admin');
    // Yetkisiz anonim çağrı fonksiyonun var olduğunu gösterir; PGRST202 ise
    // migration henüz canlı projeye uygulanmamıştır.
    return error?.code !== 'PGRST202';
  } catch {
    // Geçici ağ hatasında genel bulut yükleme akışı karar versin.
    return true;
  }
}

async function syncLocalDrawsToCloud() {
  if (!cloudSession || !cloudIsAdmin || !cloudClient) return { synced: 0 };
  const canonical = canonicalArchiveInfo();
  if (canonical.cloudConflicts.length) {
    const conflictGroups = new Set(canonical.cloudConflicts.map(drawYearWeekKey).filter(Boolean)).size;
    return {
      synced: 0,
      conflicts: canonical.cloudConflicts.length,
      error: `Bulutta ${conflictGroups} yıl/hafta için farklı tarihli kayıtlar var; Supabase kayıtları çözülmeden eşitleme durduruldu.`
    };
  }
  if (!userDraws.length) return { synced: 0 };
  const pending = [...userDraws];
  const cloudByDate = new Map(cloudDraws.map(draw => [draw[1], draw]));
  const plan = localDrawPlan(canonical);
  const resolvedWithoutWrite = [];
  const repairedGroups = [];
  const toRepair = [];
  for (const group of plan.staticMatches) {
    const cloudDraw = cloudByDate.get(group.draw[1]);
    if (!cloudDraw || !sameDrawPayload(group.draw, cloudDraw)) {
      // Paketlenmiş resmî sonuç doğruysa eski bulut kopyasını onunla onarır.
      toRepair.push(group.draw);
      repairedGroups.push(group);
    } else {
      resolvedWithoutWrite.push(...group.originals);
    }
  }
  for (const group of plan.cloudMatches) resolvedWithoutWrite.push(...group.originals);

  if (toRepair.length) {
    let response;
    try {
      response = await cloudClient.from('loto_draws').upsert(toRepair.map(drawToRow), { onConflict: 'game,draw_date' });
    } catch (e) {
      return { synced: 0, conflicts: plan.conflicts.length, error: e.message || 'ağ hatası' };
    }
    if (response.error) return { synced: 0, conflicts: plan.conflicts.length, error: response.error.message };
    cloudDraws = [...cloudDraws, ...toRepair];
  }

  const insertResult = await insertNewCloudDraws(plan.accepted.map(group => group.draw));
  const storedDates = new Set(insertResult.stored.map(draw => draw[1]));
  const conflictDates = new Set(insertResult.conflicts.map(draw => draw[1]));
  const pendingDates = new Set(insertResult.pending.map(draw => draw[1]));
  const insertConflicts = [];
  const insertPending = [];
  const insertedOriginals = [];
  for (const group of plan.accepted) {
    if (storedDates.has(group.draw[1])) insertedOriginals.push(...group.originals);
    else if (conflictDates.has(group.draw[1])) insertConflicts.push(...group.originals);
    else if (pendingDates.has(group.draw[1])) insertPending.push(...group.originals);
    else insertPending.push(...group.originals);
  }

  const unresolved = [...plan.conflicts, ...insertConflicts, ...insertPending];
  userDraws = unresolved;
  const repairedOriginals = repairedGroups.flatMap(group => group.originals);
  const synced = resolvedWithoutWrite.length + repairedOriginals.length + insertedOriginals.length;
  if (!saveUser()) {
    userDraws = pending;
    return { synced, conflicts: unresolved.length, warning: 'Buluta aktarıldı ancak yerel bekleyen kayıtlar temizlenemedi.' };
  }
  if (unresolved.length) {
    const conflictCount = plan.conflicts.length + insertConflicts.length;
    const pendingCount = insertPending.length;
    const parts = [];
    if (conflictCount) parts.push(`${conflictCount} farklı kayıt çakışma kuyruğunda bırakıldı`);
    if (pendingCount) parts.push(`${pendingCount} kayıt daha sonra yeniden denenecek`);
    return {
      synced,
      conflicts: conflictCount,
      warning: `${parts.join('; ')}.`
    };
  }
  return { synced };
}

async function cloudLogin() {
  clearCloudError();
  if (!cloudClient) return showCloudError('Bulut bağlantısı hazır değil. Yerel arşivi kullanmaya devam edebilirsiniz.');
  const email = document.getElementById('cloudEmail')?.value.trim();
  const password = document.getElementById('cloudPassword')?.value;
  if (!email) return showCloudError('Yönetici e-postasını girin.', 'cloudEmail');
  if (!password) return showCloudError('Yönetici şifresini girin.', 'cloudPassword');
  try {
    const { data, error } = await cloudClient.auth.signInWithPassword({ email, password });
    if (error) return showCloudError(`Giriş başarısız: ${error.message}`, 'cloudPassword');
    cloudSession = data.session;
    cloudIsAdmin = await checkCloudAdmin();
    const cloudResult = await loadCloudDraws();
    if (!cloudResult.ok) {
      renderCloudPanel();
      return showErr(`Giriş yapıldı ancak bulut verisi alınamadı: ${cloudResult.error}`);
    }
    if (!cloudIsAdmin) {
      renderCloudPanel();
      render();
      return showErr('Giriş yapıldı ancak bu hesap loto yöneticisi olarak yetkilendirilmemiş.');
    }
    const syncResult = await syncLocalDrawsToCloud();
    renderCloudPanel();
    render();
    if (syncResult.error) toast(`Giriş başarılı; yerel kayıtlar eşitlenemedi: ${syncResult.error}`, 'warn');
    else if (syncResult.warning) toast(syncResult.warning, 'warn');
    else toast(syncResult.synced ? `Giriş başarılı · ${syncResult.synced} yerel kayıt eşitlendi` : 'Yönetici girişi başarılı');
  } catch (e) {
    showCloudError(`Giriş başarısız: ${e.message || 'ağ hatası'}`, 'cloudPassword');
  }
}

async function cloudLogout() {
  clearFormError();
  try {
    const { error } = await cloudClient?.auth.signOut();
    if (error) return showErr(`Çıkış yapılamadı: ${error.message}`);
  } catch (e) {
    return showErr(`Çıkış yapılamadı: ${e.message || 'ağ hatası'}`);
  }
  cloudSession = null;
  cloudIsAdmin = false;
  renderCloudPanel();
  render();
  toast('Çıkış yapıldı');
}

async function syncArchiveToCloud() {
  clearFormError();
  if (!cloudSession || !cloudIsAdmin || !cloudClient) return showErr('Yetkili yönetici girişi gerekli.');
  const plan = cloudArchivePlan();
  if (plan.cloudConflicts.length) {
    const conflictGroups = new Set(plan.cloudConflicts.map(drawYearWeekKey).filter(Boolean)).size;
    return showErr(`Bulutta ${conflictGroups} yıl/hafta için farklı tarihli kayıt var; önce Supabase kayıtlarını çözün.`);
  }
  if (plan.conflicts.length) {
    return showErr(`${plan.conflicts.length} yerel kayıt çakışması çözülmeden toplu aktarım yapılamaz.`);
  }
  const rows = plan.draws.map(drawToRow);
  try {
    for (let i = 0; i < rows.length; i += 400) {
      const { error } = await cloudClient.from('loto_draws').upsert(rows.slice(i, i + 400), { onConflict: 'game,draw_date' });
      if (error) return showErr(`Aktarım durdu: ${error.message}`);
    }
    const cloudResult = await loadCloudDraws();
    if (!cloudResult.ok) return showErr(`Aktarım tamamlandı ancak doğrulama okunamadı: ${cloudResult.error}`);
    const localPending = userDraws;
    userDraws = [];
    const localCleared = saveUser();
    if (!localCleared) userDraws = localPending;
    render();
    if (localCleared) toast(`${rows.length} sonuç bulutla eşitlendi`);
    else toast(`${rows.length} sonuç buluta aktarıldı; yerel bekleyen kayıtlar temizlenemedi`, 'warn');
  } catch (e) {
    showErr(`Aktarım başarısız: ${e.message || 'ağ hatası'}`);
  }
}

async function initCloud() {
  const cfg = window.SUPABASE_CONFIG;
  cloudState = 'loading';
  renderCloudPanel();
  if (!cfg?.url || !cfg?.publishableKey || !await ensureSupabaseLibrary()) {
    cloudState = 'offline';
    renderCloudPanel();
    return;
  }

  try {
    cloudClient = window.supabase.createClient(cfg.url, cfg.publishableKey);
    cloudAdminReady = await checkCloudAdminSchema();
    const { data, error } = await cloudClient.auth.getSession();
    if (error) throw error;
    cloudSession = data.session;
    cloudIsAdmin = cloudAdminReady && cloudSession ? await checkCloudAdmin() : false;
    const cloudResult = await loadCloudDraws();
    if (!cloudResult.ok) throw new Error(cloudResult.error);
    const syncResult = cloudIsAdmin ? await syncLocalDrawsToCloud() : { synced: 0 };
    cloudState = 'ready';
    render();
    if (syncResult.error) toast(`Bulut açıldı; yerel kayıtlar eşitlenemedi: ${syncResult.error}`, 'warn');
    else if (syncResult.warning) toast(syncResult.warning, 'warn');
    else if (syncResult.synced) toast(`${syncResult.synced} bekleyen yerel kayıt bulutla eşitlendi`);
  } catch (e) {
    cloudClient = null;
    cloudSession = null;
    cloudIsAdmin = false;
    cloudAdminReady = null;
    cloudState = 'offline';
    toast(`Bulut bağlantısı kurulamadı: ${e.message || 'ağ hatası'}`, 'warn');
  }
  renderCloudPanel();
}

// Auto-format tarih
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input').forEach(input => {
    const clearOwnError = () => {
      if (document.getElementById('fErr')?.dataset.fieldId === input.id) clearFormError();
    };
    input.addEventListener('input', clearOwnError);
    input.addEventListener('change', clearOwnError);
  });
  const di = document.getElementById('iDate');
  if (di) di.addEventListener('input', function() {
    let v = this.value.replace(/\D/g,'');
    if (v.length >= 3) v = v.slice(0,2)+'/'+v.slice(2);
    if (v.length >= 6) v = v.slice(0,5)+'/'+v.slice(5);
    this.value = v.slice(0,10);
    if (parseDisplayDate(this.value)) {
      const weekInput = document.getElementById('iHft');
      if (weekInput) weekInput.dataset.userEdited = 'false';
      updateWeekSuggestion(allDraws(), true);
    }
  });
  const wi = document.getElementById('iHft');
  if (wi) wi.addEventListener('input', () => { wi.dataset.userEdited = 'true'; });
  const ni = document.getElementById('iNums');
  const drawForm = document.getElementById('drawForm');
  if (drawForm) {
    drawForm.addEventListener('submit', event => {
      event.preventDefault();
      addDraw();
    });
  } else if (ni) {
    // Eski HTML sürümlerinde form yoksa Enter davranışını korur.
    ni.addEventListener('keydown', event => {
      if (event.key === 'Enter') addDraw();
    });
  }
  bindDataActions();
  bindDeleteActions();
  initTabs();
  render();
  initCloud();
});
