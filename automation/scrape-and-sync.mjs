import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SOURCE_ORIGIN = 'https://www.millipiyangoonline.com';
const CARD_SELECTOR = '[data-id][data-page-type]';
const NUMBER_SELECTOR = '[data-testid="draw-list-winning-numbers"] > div > div:last-child';

export const GAMES = Object.freeze({
  sayisal: {
    path: '/sayisal-loto/cekilis-sonuclari',
    pageType: 'SAYISAL',
    count: 6,
    max: 90,
    bonusMax: 0
  },
  super: {
    path: '/super-loto/cekilis-sonuclari',
    pageType: 'SUPERLOTO',
    count: 6,
    max: 60,
    bonusMax: 0
  },
  sans: {
    path: '/sans-topu/cekilis-sonuclari',
    pageType: 'SANSTOPU',
    count: 5,
    max: 34,
    bonusMax: 14
  },
  onnumara: {
    path: '/on-numara/cekilis-sonuclari',
    pageType: 'ONNUMARA',
    count: 22,
    max: 80,
    bonusMax: 0
  }
});

function hasFlag(name) {
  return process.argv.includes(name);
}

function toIsoDate(displayDate) {
  const match = String(displayDate || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return '';
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function normalizeNumbers(values) {
  return values.map(Number).sort((a, b) => a - b);
}

export function validateDraw(draw, config, today = new Date()) {
  if (!draw || !Object.hasOwn(GAMES, draw.game)) return 'Bilinmeyen oyun.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draw.draw_date)) return 'Geçersiz çekiliş tarihi.';
  const drawDate = new Date(`${draw.draw_date}T00:00:00+03:00`);
  if (Number.isNaN(drawDate.getTime()) || toIsoDate(new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(drawDate)) !== draw.draw_date) return 'Geçersiz çekiliş tarihi.';
  const todayInTurkey = new Date(today.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
  todayInTurkey.setHours(23, 59, 59, 999);
  if (drawDate > todayInTurkey) return 'Gelecek tarihli çekiliş.';
  if (!Number.isInteger(draw.week_no) || draw.week_no < 1 || draw.week_no > 9999) return 'Geçersiz çekiliş numarası.';
  if (!Array.isArray(draw.numbers) || draw.numbers.length !== config.count) return `Sonuç ${config.count} sayı içermeli.`;
  if (draw.numbers.some(number => !Number.isInteger(number) || number < 1 || number > config.max)) return `Sayılar 1–${config.max} aralığında olmalı.`;
  if (new Set(draw.numbers).size !== config.count) return 'Sonuç sayıları tekrarsız olmalı.';
  if (config.bonusMax) {
    if (!Number.isInteger(draw.bonus) || draw.bonus < 1 || draw.bonus > config.bonusMax) return `Bonus 1–${config.bonusMax} aralığında olmalı.`;
  } else if (draw.bonus !== null) return 'Bu oyunda bonus bulunmamalı.';
  if (!draw.source_url?.startsWith(`${SOURCE_ORIGIN}/`)) return 'Kaynak adresi resmî siteye ait değil.';
  return '';
}

export function parseCard(rawCard, game, config) {
  const weekMatch = String(rawCard.label || '').match(/(\d+)/);
  const rawNumbers = rawCard.numbers.map(item => ({
    value: Number(item.value),
    content: String(item.content || '').trim().toLocaleLowerCase('tr-TR')
  }));
  const primary = game === 'sans'
    ? rawNumbers.slice(0, config.count)
    : rawNumbers.filter(item => !item.content).slice(0, config.count);
  const bonusItem = game === 'sans' ? rawNumbers[config.count] : null;
  const draw = {
    game,
    draw_date: toIsoDate(rawCard.date),
    week_no: Number(weekMatch?.[1]),
    numbers: normalizeNumbers(primary.map(item => item.value)),
    bonus: bonusItem ? bonusItem.value : null,
    source_url: new URL(rawCard.href, SOURCE_ORIGIN).href
  };
  const error = validateDraw(draw, config);
  if (error) throw new Error(`${game} ${rawCard.label || 'çekiliş'}: ${error}`);
  return draw;
}

async function openDrawPage(page, url, game) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      // Bazı CDN yanıtları DOMContentLoaded sinyalini tamamlamasa da React
      // içeriği yükleniyor; yanıt başlar başlamaz seçici üzerinden bekliyoruz.
      await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
      await page.locator('[data-testid="draw-label-and-number"]').first()
        .waitFor({ state: 'visible', timeout: 45_000 });
      return;
    } catch (error) {
      lastError = error;
      console.warn(`${game}: resmî sayfa denemesi ${attempt}/2 başarısız: ${error.message}`);
      if (attempt < 2) {
        await page.evaluate(() => window.stop()).catch(() => {});
        await page.waitForTimeout(5_000);
      }
    }
  }
  throw new Error(`${game}: resmî sonuç sayfasına iki denemede erişilemedi. ${lastError?.message || ''}`.trim(), {
    cause: lastError
  });
}

async function scrapeGame(page, game, config) {
  const url = `${SOURCE_ORIGIN}${config.path}`;
  await openDrawPage(page, url, game);

  const rawCards = await page.locator(CARD_SELECTOR).evaluateAll((cards, numberSelector) =>
    cards.map(card => ({
      type: card.getAttribute('data-page-type'),
      label: card.querySelector('[data-testid="draw-label-and-number"]')?.textContent?.trim() || '',
      date: card.querySelector('[data-testid="draw-date"]')?.textContent?.trim() || '',
      href: card.querySelector('.draw-details-redirect')?.getAttribute('href') || '',
      numbers: [...card.querySelectorAll(numberSelector)].map(element => ({
        value: element.textContent?.trim() || '',
        content: element.getAttribute('data-content') || ''
      }))
    })), NUMBER_SELECTOR);

  const matchingCards = rawCards.filter(card => card.type === config.pageType);
  if (!matchingCards.length) throw new Error(`${game}: resmî sayfada sonuç kartı bulunamadı.`);
  return matchingCards.map(card => parseCard(card, game, config));
}

export function deduplicateDraws(draws) {
  const byKey = new Map();
  for (const draw of draws) {
    const key = `${draw.game}:${draw.draw_date}`;
    const previous = byKey.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(draw)) {
      throw new Error(`${key}: kaynak aynı tarih için iki farklı sonuç döndürdü.`);
    }
    byKey.set(key, draw);
  }
  return [...byKey.values()].sort((left, right) =>
    left.draw_date.localeCompare(right.draw_date) || left.game.localeCompare(right.game)
  );
}

async function importToSupabase(draws) {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !secretKey) {
    throw new Error('SUPABASE_URL ve SUPABASE_SECRET_KEY ortam değişkenleri gerekli.');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/import_official_loto_results`, {
    method: 'POST',
    headers: {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ p_rows: draws })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase aktarımı başarısız (${response.status}): ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : {};
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  const headless = process.env.LOTO_HEADLESS !== 'false';
  const browserChannel = process.env.LOTO_BROWSER_CHANNEL || 'chrome';
  const browser = await chromium.launch({
    channel: browserChannel,
    headless,
    // Milli Piyango'nun CDN'i bazı otomasyon istemcilerinde HTTP/2 akışını
    // protokol hatasıyla kapatıyor. HTTP/1.1 geri dönüşü veri içeriğini değiştirmez.
    args: ['--disable-http2']
  });
  const context = await browser.newContext({
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();
  const results = [];

  try {
    for (const [game, config] of Object.entries(GAMES)) {
      const draws = await scrapeGame(page, game, config);
      results.push(...draws);
      console.log(`${game}: ${draws.length} sonuç doğrulandı; son tarih ${draws.at(-1)?.draw_date || '—'}`);
    }
  } catch (error) {
    await writeFile('loto-sync-diagnostics.json', JSON.stringify({
      failed_at: new Date().toISOString(),
      error: error?.stack || String(error),
      page_url: page.url(),
      browser_channel: browserChannel,
      browser_version: browser.version(),
      headless
    }, null, 2));
    await page.evaluate(() => window.stop()).catch(() => {});
    await page.screenshot({ path: 'loto-sync-error.png', fullPage: true, timeout: 10_000 }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }

  const draws = deduplicateDraws(results);
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, count: draws.length, draws }, null, 2));
    return;
  }
  const imported = await importToSupabase(draws);
  console.log(JSON.stringify({ dryRun: false, scraped: draws.length, imported }, null, 2));
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
