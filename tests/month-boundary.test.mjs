import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { GAMES, getTargetPeriods, openDrawPage, scrapeGame, selectDrawPeriod } from '../automation/scrape-and-sync.mjs';

function card(game, period) {
  const config = GAMES[game];
  return {
    type: config.pageType,
    label: '1. Çekiliş',
    date: `01.${String(period.month).padStart(2, '0')}.${period.year} - 21:30`,
    href: `${config.path}/1`,
    numbers: Array.from({ length: config.count + (config.bonusMax ? 1 : 0) }, (_, index) => ({
      value: index < config.count ? index + 1 : 1
    }))
  };
}

// Resmî sayfanın davranışı: filtre tıklanınca eski içerik yerinde kalır;
// yeni yanıt gelince kartlar değiştirilir. Boş DOM, açık boş-durumdan farklıdır.
function makePage(initialPeriod, initialRows, responses = []) {
  let rows = initialRows;
  let selected = { ...initialPeriod };
  let pending;
  const events = [];
  const document = {
    querySelector(selector) {
      return { value: String(selector === '#draw-year' ? selected.year : selected.month) };
    },
    querySelectorAll(selector) {
      return (rows || []).filter(row => selector.includes(row.type)).map(row => ({ textContent: row.date }));
    }
  };
  function locator(selector) {
    let acceptsEmpty = selector.includes('no-result-draws');
    return {
      first() { return this; },
      or() { acceptsEmpty = true; return this; },
      async waitFor() {
        events.push(`wait:${selector}`);
        if (selector.includes('draw-label') && !(rows?.length || (acceptsEmpty && rows !== null))) {
          throw new Error('Sonuç yükleme zaman aşımı');
        }
      },
      async isVisible() { return rows !== null && rows.length === 0; },
      async count() { return 1; },
      async selectOption(value) { selected[selector === '#draw-year' ? 'year' : 'month'] = Number(value); },
      async evaluateAll() { return rows || []; }
    };
  }
  return {
    events,
    locator,
    async goto() { events.push('goto'); },
    async evaluate(fn) {
      if (String(fn).includes('window.stop')) return;
      return runInNewContext(`(${fn})()`, { document });
    },
    async waitForTimeout() {},
    getByRole() {
      return { async click() {
        events.push(`filter:${selected.year}-${selected.month}`);
        pending = responses.shift();
      } };
    },
    async waitForFunction(fn, args) {
      events.push('wait:filtered-response');
      rows = pending ?? null;
      if (!runInNewContext(`(${fn})(args)`, { document, args })) {
        throw new Error('Filtre sonucu yükleme zaman aşımı');
      }
    }
  };
}

for (const game of Object.keys(GAMES)) {
  for (let month = 1; month <= 12; month += 1) {
    test(`${game}: ${month}/2025 boşken önceki ay okunur (Ocak dahil)`, async () => {
      const periods = getTargetPeriods(1, new Date(`2025-${String(month).padStart(2, '0')}-02T09:00:00+03:00`));
      const page = makePage(periods[0], [], [[card(game, periods[1])]]);
      const draws = await scrapeGame(page, game, GAMES[game], periods);
      assert.equal(draws.length, 1);
      assert.equal(draws[0].game, game);
      assert.equal(draws[0].draw_date, `${periods[1].year}-${String(periods[1].month).padStart(2, '0')}-01`);
      assert.deepEqual(page.events.filter(event => event.startsWith('filter:')), [
        `filter:${periods[1].year}-${periods[1].month}`
      ]);
      assert.ok(page.events.includes('wait:filtered-response'));
    });
  }
}

test('dolu güncel ay ve geçmiş ay birlikte okunur; mevcut aya gereksiz istek yapılmaz', async () => {
  const periods = [{ year: 2025, month: 9 }, { year: 2025, month: 8 }];
  const page = makePage(periods[0], [card('super', periods[0])], [[card('super', periods[1])]]);
  const draws = await scrapeGame(page, 'super', GAMES.super, periods);
  assert.deepEqual(draws.map(draw => draw.draw_date), ['2025-08-01', '2025-09-01']);
});

test('yalnız güncel ay istendiğinde açık boş-durum sorunsuz tamamlanır', async () => {
  const current = { year: 2025, month: 9 };
  assert.deepEqual(await scrapeGame(makePage(current, []), 'sayisal', GAMES.sayisal, [current]), []);
});

test('boş DOM veya kaynak erişim hatası sonuç yok sayılmaz', async () => {
  const page = makePage({ year: 2025, month: 9 }, null);
  await assert.rejects(openDrawPage(page, 'https://www.millipiyangoonline.com', 'sayisal'), /iki denemede/);
  assert.equal(page.events.filter(event => event === 'goto').length, 2);
});

test('geçmiş ay filtresi başarısızsa eski sonuç yok yazısı başarı sayılmaz', async () => {
  const periods = [{ year: 2025, month: 9 }, { year: 2025, month: 8 }];
  await assert.rejects(scrapeGame(makePage(periods[0], [], [[]]), 'sayisal', GAMES.sayisal, periods), /zaman aşımı/);
});

test('filtre yanlış ay, yanlış yıl, karışık dönem veya yanlış oyun döndürürse kabul edilmez', async () => {
  const requested = { year: 2025, month: 8 };
  for (const rows of [
    [card('sayisal', { year: 2025, month: 7 })],
    [card('sayisal', { year: 2024, month: 8 })],
    [card('sayisal', requested), card('sayisal', { year: 2025, month: 7 })],
    [card('super', requested)]
  ]) {
    await assert.rejects(selectDrawPeriod(makePage({ year: 2025, month: 9 }, [], [rows]), 'sayisal', requested), /zaman aşımı/);
  }
});

test('ilk yüklemede yanlış dönemin kartları gösterilirse arşive aktarılmaz', async () => {
  const period = { year: 2025, month: 9 };
  const page = makePage(period, [card('sayisal', { year: 2025, month: 8 })]);
  await assert.rejects(scrapeGame(page, 'sayisal', GAMES.sayisal, [period]), /başka dönemin/);
});

test('Türkiye gece yarısında ay ve yıl UTC tarihinden bağımsız değişir', () => {
  assert.deepEqual(getTargetPeriods(1, new Date('2025-12-31T21:05:00Z')), [
    { year: 2026, month: 1 }, { year: 2025, month: 12 }
  ]);
});
