const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

const configs = [
  {
    file: 'data-sayisal.js',
    varName: 'SAYISAL_DATA',
    count: 6,
    max: 90,
    currentStart: '03/08/2020',
    currentCount: 932,
    currentLast: '15/07/2026'
  },
  {
    file: 'data-super.js',
    varName: 'SUPER_DATA',
    count: 6,
    max: 60,
    currentStart: '02/08/2020',
    currentCount: 933,
    currentLast: '16/07/2026'
  },
  {
    file: 'data-sans.js',
    varName: 'SANS_DATA',
    count: 5,
    max: 34,
    bonusMax: 14,
    currentStart: '05/08/2020',
    currentCount: 611,
    currentLast: '15/07/2026'
  },
  {
    file: 'data-onnumara.js',
    varName: 'ONNUMARA_DATA',
    count: 22,
    max: 80,
    currentStart: '03/08/2020',
    currentCount: 611,
    currentLast: '13/07/2026'
  }
];

function dateValue(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  assert.ok(match, `Tarih biçimi geçersiz: ${value}`);
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  assert.equal(date.getUTCFullYear(), year, `Yıl geçersiz: ${value}`);
  assert.equal(date.getUTCMonth(), month - 1, `Ay geçersiz: ${value}`);
  assert.equal(date.getUTCDate(), day, `Gün geçersiz: ${value}`);
  return date.getTime();
}

function loadData(config) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, config.file), 'utf8'),
    context,
    { filename: config.file }
  );
  return context[config.varName];
}

for (const config of configs) {
  test(`${config.file} arşiv bütünlüğünü korur`, () => {
    const rows = loadData(config);
    assert.ok(Array.isArray(rows) && rows.length > config.currentCount);

    const dates = new Set();
    let previous = -Infinity;
    for (const [week, date, numbers, bonus] of rows) {
      const time = dateValue(date);
      assert.ok(time > previous, `Tarih sırası bozuk: ${date}`);
      previous = time;
      assert.ok(Number.isInteger(week) && week > 0, `Hafta no bozuk: ${date}`);
      assert.ok(!dates.has(date), `Yinelenen tarih: ${date}`);
      dates.add(date);
      assert.equal(numbers.length, config.count, `Sayı adedi bozuk: ${date}`);
      assert.equal(new Set(numbers).size, numbers.length, `Yinelenen sayı: ${date}`);
      assert.ok(
        numbers.every(number => Number.isInteger(number) && number >= 1 && number <= config.max),
        `Sayı aralığı bozuk: ${date}`
      );
      if (config.bonusMax) {
        assert.ok(
          Number.isInteger(bonus) && bonus >= 1 && bonus <= config.bonusMax,
          `Bonus sayı bozuk: ${date}`
        );
      }
    }

    const cutoff = dateValue(config.currentStart);
    const current = rows.filter(row => dateValue(row[1]) >= cutoff);
    assert.equal(current.length, config.currentCount);
    assert.equal(current[0][1], config.currentStart);
    assert.equal(current.at(-1)[1], config.currentLast);

    const yearWeeks = new Set();
    const results = new Set();
    for (const [week, date, numbers, bonus] of current) {
      const yearWeek = `${date.slice(-4)}-${week}`;
      assert.ok(!yearWeeks.has(yearWeek), `Yinelenen yıl/çekiliş: ${yearWeek}`);
      yearWeeks.add(yearWeek);
      const result = `${numbers.join(',')}|${bonus ?? ''}`;
      assert.ok(!results.has(result), `Yinelenen sonuç: ${date}`);
      results.add(result);
    }
  });
}
