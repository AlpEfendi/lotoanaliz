const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const engineSource = fs.readFileSync(path.join(__dirname, '..', 'loto.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function createEngine({ data = [], stored = '[]', overrides = {}, syncRunId = null } = {}) {
  const storage = new Map([['testDraws', stored]]);
  if (syncRunId) storage.set('lotoOfficialSyncRun', String(syncRunId));
  const context = {
    LOTO_CONFIG: {
      maxNum: 90,
      bonusMax: 0,
      pickCount: 6,
      importWeekMode: 'preferred',
      drawDays: [1, 3, 6],
      storageKey: 'testDraws',
      gameName: 'Test',
      sinceLabel: 'Ağustos 2020→',
      analysisStartDate: '03/08/2020',
      csvName: 'test.csv',
      goldNumbers: [1, 5, 10],
      data,
      ...overrides
    },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    document: {
      addEventListener() {},
      createElement() { return { click() {} }; },
      getElementById() { return null; },
      querySelectorAll() { return []; }
    },
    window: {},
    Blob: class Blob {},
    FileReader: class FileReader {},
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
    console,
    setTimeout,
    clearTimeout,
    AbortController
  };
  vm.createContext(context);
  vm.runInContext(engineSource, context);
  context.storage = storage;
  return context;
}

test('takvimsel tarihleri doğrular', () => {
  const engine = createEngine();
  assert.ok(engine.parseDisplayDate('29/02/2024'));
  assert.equal(engine.parseDisplayDate('29/02/2023'), null);
  assert.equal(engine.parseDisplayDate('31/04/2026'), null);
  assert.equal(engine.parseDisplayDate('99/99/9999'), null);
  assert.equal(engine.normalizeImportDate('1.2.2026'), '01/02/2026');
  assert.equal(engine.normalizeImportDate('31.2.2026'), '');
});

test('analizi yapılandırılmış başlangıç tarihinde sınırlar', () => {
  const engine = createEngine({
    data: [
      [1, '01/08/2020', [1, 2, 3, 4, 5, 6]],
      [2, '03/08/2020', [50, 51, 52, 53, 54, 55]],
      [3, '05/08/2020', [60, 61, 62, 63, 64, 65]]
    ]
  });
  assert.deepEqual(
    plain(engine.analysisDraws().map(draw => draw[1])),
    ['03/08/2020', '05/08/2020']
  );
});

test('öneri skoru son pencereyle sınırlanmayıp tüm doğrulanmış arşivi kullanır', () => {
  const engine = createEngine({ overrides: { maxNum: 10, pickCount: 2 } });
  const older = Array.from({ length: 80 }, (_, index) =>
    [index + 1, '01/01/2020', [1, 3]]
  );
  const recent = Array.from({ length: 120 }, (_, index) =>
    [index + 81, '01/01/2021', index % 2 ? [1, 3] : [2, 3]]
  );

  const recentOnly = engine.buildNumberScores(recent, 'balanced');
  const fullArchive = engine.buildNumberScores([...older, ...recent], 'balanced');
  assert.ok(Math.abs(recentOnly[1] - recentOnly[2]) < 1e-12, 'eşit pencereler eşit skorlanır');
  assert.ok(fullArchive[1] > fullArchive[2], '120 çekilişten eski sonuçlar uzun dönem skorunu etkiler');
});

test('öneri üretimi dört oyunun sayı adedi, aralığı ve tekrarsızlık kuralını korur', () => {
  const games = [
    { maxNum: 90, pickCount: 6 },
    { maxNum: 60, pickCount: 6 },
    { maxNum: 34, pickCount: 5, bonusMax: 14 },
    { maxNum: 80, pickCount: 10, drawCount: 22 }
  ];

  for (const game of games) {
    const engine = createEngine({ overrides: game });
    const scores = Object.fromEntries(
      Array.from({ length: game.maxNum }, (_, index) => [index + 1, 0.7 + ((index % 11) / 20)])
    );
    for (let attempt = 0; attempt < 500; attempt++) {
      const candidate = plain(engine.generateCandidate(scores));
      assert.equal(candidate.length, game.pickCount);
      assert.equal(new Set(candidate).size, game.pickCount);
      assert.ok(candidate.every(number => Number.isInteger(number) && number >= 1 && number <= game.maxNum));
      assert.deepEqual(candidate, [...candidate].sort((a, b) => a - b));
      const fit = engine.modelFitScore(candidate, scores);
      assert.ok(Number.isInteger(fit) && fit >= 0 && fit <= 100, 'model puanı 0–100 aralığında kalır');
    }
  }
});

test('geçmiş veriden yüksek ağırlık alan sayı yeniden öner üretiminde daha sık seçilir', () => {
  const engine = createEngine({ overrides: { maxNum: 10, pickCount: 2 } });
  vm.runInContext(`
    var recommendationSeed = 24681357;
    Math.random = () => {
      recommendationSeed = (recommendationSeed * 48271) % 2147483647;
      return recommendationSeed / 2147483647;
    };
  `, engine);
  const scores = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [index + 1, 0.10]));
  scores[1] = 8;
  let selected = 0;

  for (let attempt = 0; attempt < 2000; attempt++) {
    if (engine.generateCandidate(scores).includes(1)) selected++;
  }
  assert.ok(selected > 1850, `yüksek ağırlıklı sayı yeterince sık seçilmedi: ${selected}/2000`);
});

test('Şans Topu bonus önerisi geçmiş ana bonus sonuçlarından ve doğru aralıktan üretilir', () => {
  const engine = createEngine({ overrides: { maxNum: 34, pickCount: 5, bonusMax: 14 } });
  const draws = Array.from({ length: 140 }, (_, index) => [
    index + 1,
    '01/01/2021',
    [1, 2, 3, 4, 5],
    (index % 14) + 1
  ]);
  const scores = engine.buildBonusScores(draws);

  assert.equal(Object.keys(scores).length, 14);
  for (let attempt = 0; attempt < 500; attempt++) {
    const bonus = engine.pickBonus(draws);
    assert.ok(Number.isInteger(bonus) && bonus >= 1 && bonus <= 14);
  }
});

test('paket arşivi kapsamındaki bulut fazlalıklarını analize katmaz', () => {
  const engine = createEngine({
    data: [
      [1, '01/07/2026', [1, 2, 3, 4, 5, 6]],
      [2, '05/07/2026', [7, 8, 9, 10, 11, 12]]
    ]
  });
  vm.runInContext(`
    cloudDraws = [
      [90, '03/07/2026', [13, 14, 15, 16, 17, 18]],
      [3, '07/07/2026', [19, 20, 21, 22, 23, 24]]
    ];
  `, engine);

  assert.deepEqual(
    plain(engine.allDraws().map(draw => draw[1])),
    ['01/07/2026', '05/07/2026', '07/07/2026']
  );
  assert.match(
    engine.validateNewDrawInput(
      { week: '90', date: '03/07/2026', numbers: '13 14 15 16 17 18', bonus: '' },
      engine.allDraws(),
      new Date(2026, 6, 13)
    ).error,
    /paket arşivi/i
  );
});

test('paket aralığındaki yerel boşluk ve uyuşmazlıkları karantinaya alır', () => {
  const firstOfficial = [1, '01/07/2026', [1, 2, 3, 4, 5, 6]];
  const lastOfficial = [2, '05/07/2026', [7, 8, 9, 10, 11, 12]];
  const mismatch = [1, '01/07/2026', [13, 14, 15, 16, 17, 18]];
  const gap = [90, '03/07/2026', [19, 20, 21, 22, 23, 24]];
  const engine = createEngine({
    data: [firstOfficial, lastOfficial],
    stored: JSON.stringify([mismatch, gap, lastOfficial])
  });

  assert.deepEqual(plain(engine.allDraws()), [firstOfficial, lastOfficial]);
  assert.deepEqual(plain(engine.quarantinedUserDraws()), [mismatch, gap]);
  const plan = engine.cloudArchivePlan();
  assert.deepEqual(plain(plan.draws), [firstOfficial, lastOfficial]);
  assert.deepEqual(plain(plan.conflicts), [mismatch, gap]);
});

test('paket sonrasındaki bulut sonucu çakışan yerel sonuca karşı kanonik kalır', () => {
  const firstOfficial = [1, '01/07/2026', [1, 2, 3, 4, 5, 6]];
  const lastOfficial = [2, '05/07/2026', [7, 8, 9, 10, 11, 12]];
  const cloud = [3, '07/07/2026', [13, 14, 15, 16, 17, 18]];
  const local = [3, '07/07/2026', [19, 20, 21, 22, 23, 24]];
  const engine = createEngine({ data: [firstOfficial, lastOfficial], stored: JSON.stringify([local]) });
  vm.runInContext(`cloudDraws = [[3, '07/07/2026', [13, 14, 15, 16, 17, 18]]];`, engine);

  assert.deepEqual(plain(engine.allDraws()), [firstOfficial, lastOfficial, cloud]);
  assert.deepEqual(plain(engine.quarantinedUserDraws()), [local]);
});

test('bulutta aynı yıl ve çekiliş numarasındaki farklı tarihleri analize katmaz', () => {
  const official = [2, '05/07/2026', [1, 2, 3, 4, 5, 6]];
  const firstCloud = [3, '07/07/2026', [7, 8, 9, 10, 11, 12]];
  const secondCloud = [3, '09/07/2026', [13, 14, 15, 16, 17, 18]];
  const engine = createEngine({ data: [official] });
  vm.runInContext(`
    cloudDraws = [
      [3, '07/07/2026', [7, 8, 9, 10, 11, 12]],
      [3, '09/07/2026', [13, 14, 15, 16, 17, 18]]
    ];
  `, engine);

  assert.deepEqual(plain(engine.allDraws()), [official]);
  const plan = engine.cloudArchivePlan();
  assert.deepEqual(plain(plan.draws), [official]);
  assert.deepEqual(plain(plan.cloudConflicts), [firstCloud, secondCloud]);
  assert.deepEqual(plain(plan.conflicts), [firstCloud, secondCloud]);
});

test('aynı tarihli farklı yerel varyantların tamamını karantinaya alıp yalnız seçileni siler', async () => {
  const official = [2, '05/07/2026', [1, 2, 3, 4, 5, 6]];
  const first = [3, '07/07/2026', [7, 8, 9, 10, 11, 12]];
  const second = [3, '07/07/2026', [13, 14, 15, 16, 17, 18]];
  const engine = createEngine({ data: [official], stored: JSON.stringify([first, second]) });

  assert.deepEqual(plain(engine.allDraws()), [official]);
  assert.deepEqual(plain(engine.quarantinedUserDraws()), [first, second]);
  assert.deepEqual(plain(engine.cloudArchivePlan().conflicts), [first, second]);

  vm.runInContext('render = () => {}; toast = () => {}; showErr = () => {};', engine);
  await engine.deleteDraw(first[0], first[1], first);
  assert.deepEqual(plain(vm.runInContext('userDraws', engine)), [second]);
});

test('kapalı arşiv öncesini ve aynı yıl-haftadaki ikinci tarihi karantinaya alır', () => {
  const official = [2, '05/07/2026', [1, 2, 3, 4, 5, 6]];
  const repeatedWeek = [2, '07/07/2026', [7, 8, 9, 10, 11, 12]];
  const beforeArchive = [90, '01/01/1900', [13, 14, 15, 16, 17, 18]];
  const engine = createEngine({ data: [official], stored: JSON.stringify([repeatedWeek, beforeArchive]) });

  assert.deepEqual(plain(engine.allDraws()), [official]);
  assert.deepEqual(plain(engine.quarantinedUserDraws()), [repeatedWeek, beforeArchive]);
  assert.match(
    engine.validateNewDrawInput(
      { week: '90', date: '01/01/1900', numbers: '13 14 15 16 17 18', bonus: '' },
      engine.allDraws(),
      new Date(2026, 6, 13)
    ).error,
    /yalnız daha yeni/i
  );
});

test('hafta önerisini yalnız hedef yıl içinden hesaplar', () => {
  const engine = createEngine();
  const draws = [
    [1344, '30/12/2019', [1, 2, 3, 4, 5, 6]],
    [70, '13/06/2026', [1, 2, 3, 4, 5, 6]],
    [71, '15/06/2026', [7, 8, 9, 10, 11, 12]]
  ];
  assert.equal(engine.nextWeekForDate(draws, '17/06/2026'), 72);
  assert.equal(engine.nextWeekForDate(draws, '02/01/2027'), 1);
  assert.equal(engine.nextWeekForDate(draws, '31/02/2027'), null);
});

test('güncellik hesabı bugünkü çekilişi geçmiş eksiklere katmaz', () => {
  const engine = createEngine({ overrides: { drawDays: [1, 5] } });
  const lastMonday = new Date(2026, 6, 13);
  const fridayToday = new Date(2026, 6, 17);
  const nextMonday = new Date(2026, 6, 20);

  assert.equal(engine.countDueDrawDays(lastMonday, fridayToday, [1, 5]), 0);
  assert.equal(engine.countDueDrawDays(lastMonday, nextMonday, [1, 5]), 1);
  assert.equal(engine.nextDrawDate(fridayToday, [1, 5], 1).getTime(), nextMonday.getTime());
});

test('elle girişte ondalık, metin, gelecek tarih ve yinelenen haftayı reddeder', () => {
  const engine = createEngine();
  const existing = [[1, '05/01/2026', [1, 2, 3, 4, 5, 6]]];
  const today = new Date(2026, 6, 13);
  const base = { week: '2', date: '07/01/2026', numbers: '1 2 3 4 5 6', bonus: '' };

  assert.match(engine.validateNewDrawInput({ ...base, numbers: '1.5 2 3 4 5 6' }, existing, today).error, /tam sayı/i);
  assert.match(engine.validateNewDrawInput({ ...base, numbers: '1 foo 2 3 4 5 6' }, existing, today).error, /tam sayı/i);
  assert.match(engine.validateNewDrawInput({ ...base, date: '31/02/2026' }, existing, today).error, /Geçerli bir tarih/i);
  assert.match(engine.validateNewDrawInput({ ...base, date: '15/07/2026' }, existing, today).error, /Gelecek/i);
  assert.match(engine.validateNewDrawInput({ ...base, week: '10000' }, existing, today).error, /1–9999/i);
  assert.match(engine.validateNewDrawInput({ ...base, week: '1' }, existing, today).error, /zaten kayıtlı/i);

  assert.deepEqual(
    plain(engine.validateNewDrawInput(base, existing, today).draw),
    [2, '07/01/2026', [1, 2, 3, 4, 5, 6]]
  );
});

test('bozuk localStorage satırlarını yüklemeden temizler', () => {
  const valid = [1, '05/01/2026', [1, 2, 3, 4, 5, 6]];
  const engine = createEngine({ stored: JSON.stringify([null, valid, [2, '31/02/2026', [1, 2, 3, 4, 5, 6]]]) });
  const userDraws = vm.runInContext('userDraws', engine);
  assert.deepEqual(JSON.parse(JSON.stringify(userDraws)), [valid]);
  assert.equal(engine.storage.get('testDraws'), JSON.stringify([valid]));
});

test('Şans Topu bonusunu tam sayı ve aralık açısından doğrular', () => {
  const engine = createEngine({ overrides: { maxNum: 34, bonusMax: 14, pickCount: 5 } });
  const today = new Date(2026, 6, 13);
  const base = { week: '1', date: '01/07/2026', numbers: '1 2 3 4 5', bonus: '7' };
  assert.match(engine.validateNewDrawInput({ ...base, bonus: '7.9' }, [], today).error, /tam sayı/i);
  assert.deepEqual(plain(engine.validateNewDrawInput(base, [], today).draw), [1, '01/07/2026', [1, 2, 3, 4, 5], 7]);
});

test('TXT ayrıştırıcı hafta numarasını satıra bölünen sonuçla karıştırmaz', () => {
  const engine = createEngine();

  assert.deepEqual(
    plain(engine.parseImportLine('13/07/2026 1 2 3 4 5 6')),
    [null, '13/07/2026', [1, 2, 3, 4, 5, 6], null]
  );
  assert.deepEqual(
    plain(engine.parseImportLine('13/07/2026 42 1 2 3 4 5 6')),
    [42, '13/07/2026', [1, 2, 3, 4, 5, 6], null]
  );

  const split = engine.parseImportBlock(['13/07/2026 42 1 2 3 4 5', '6'], 0);
  assert.deepEqual(
    plain(split),
    { parsed: [42, '13/07/2026', [1, 2, 3, 4, 5, 6], null], nextIndex: 1 }
  );
  assert.equal(engine.parseImportBlock(['13/07/2026 1 2 3 4 5 6 7 8'], 0).error, 'Fazla sayı');
  assert.match(engine.parseImportBlock(['13/07/2026 42 -1 2 3 4 5 6'], 0).error, /pozitif tam sayı/i);
  assert.match(engine.parseImportBlock(['13/07/2026 42 1.5 2 3 4 5 6'], 0).error, /pozitif tam sayı/i);

  const bonusEngine = createEngine({ overrides: { maxNum: 34, bonusMax: 14, pickCount: 5 } });
  assert.deepEqual(
    plain(bonusEngine.parseImportBlock(['01/07/2026 15 1 2 3 4 5', '7'], 0)),
    { parsed: [15, '01/07/2026', [1, 2, 3, 4, 5], 7], nextIndex: 1 }
  );

  const onNumaraEngine = createEngine({
    overrides: { maxNum: 80, drawCount: 22, pickCount: 10, importWeekMode: 'absent' }
  });
  const firstTen = Array.from({ length: 10 }, (_, index) => index + 1).join(' ');
  const lastTwelve = Array.from({ length: 12 }, (_, index) => index + 11).join(' ');
  const onNumaraBlock = onNumaraEngine.parseImportBlock([
    `13/07/2026 ${firstTen}`,
    lastTwelve,
    '23',
    '17/07/2026 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22'
  ], 0);
  assert.deepEqual(
    plain(onNumaraBlock),
    { parsed: [null, '13/07/2026', Array.from({ length: 22 }, (_, index) => index + 1), null], nextIndex: 1 }
  );
});

test('bulut yazma hatasında TXT kayıtlarını yerel kuyruğa alır', async () => {
  const engine = createEngine();
  vm.runInContext(`
    render = () => {};
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudClient = {
      from() {
        return { insert: async () => ({ error: { code: '503', message: 'network unavailable' } }) };
      }
    };
  `, engine);

  const result = await engine.importDrawsFromText('01/07/2026 1 1 2 3 4 5 6');
  assert.equal(result.added, 1);
  assert.match(result.warning, /yerel kuyruğa/i);
  assert.deepEqual(
    plain(vm.runInContext('userDraws', engine)),
    [[1, '01/07/2026', [1, 2, 3, 4, 5, 6]]]
  );
});

test('eşzamanlı farklı bulut eklemesini insert ile ezmeden çakışmaya ayırır', async () => {
  const localDraw = [8, '01/07/2026', [1, 2, 3, 4, 5, 6]];
  const cloudDraw = [8, '01/07/2026', [7, 8, 9, 10, 11, 12]];
  const engine = createEngine();
  vm.runInContext(`
    var raceInsertCalls = 0;
    cloudClient = {
      from() {
        return {
          insert: async () => {
            raceInsertCalls++;
            return { error: { code: '23505', message: 'duplicate key' } };
          }
        };
      }
    };
    loadCloudDraws = async () => {
      cloudDraws = [[8, '01/07/2026', [7, 8, 9, 10, 11, 12]]];
      return { ok: true, count: 1 };
    };
  `, engine);

  const result = await engine.insertNewCloudDraws([localDraw]);
  assert.equal(vm.runInContext('raceInsertCalls', engine), 1);
  assert.deepEqual(plain(result.conflicts), [localDraw]);
  assert.deepEqual(plain(result.pending), []);
  assert.deepEqual(plain(vm.runInContext('cloudDraws', engine)), [cloudDraw]);
});

test('eşzamanlı aynı yıl-haftadaki farklı bulut tarihini çakışmaya ayırır', async () => {
  const localDraw = [8, '03/07/2026', [1, 2, 3, 4, 5, 6]];
  const cloudDraw = [8, '01/07/2026', [7, 8, 9, 10, 11, 12]];
  const engine = createEngine();
  vm.runInContext(`
    var weekRaceInsertCalls = 0;
    cloudClient = {
      from() {
        return {
          insert: async () => {
            weekRaceInsertCalls++;
            return { error: { code: '23505', message: 'duplicate year/week' } };
          }
        };
      }
    };
    loadCloudDraws = async () => {
      cloudDraws = [[8, '01/07/2026', [7, 8, 9, 10, 11, 12]]];
      return { ok: true, count: 1 };
    };
  `, engine);

  const result = await engine.insertNewCloudDraws([localDraw]);
  assert.equal(vm.runInContext('weekRaceInsertCalls', engine), 1);
  assert.deepEqual(plain(result.conflicts), [localDraw]);
  assert.deepEqual(plain(result.pending), []);
  assert.deepEqual(plain(vm.runInContext('cloudDraws', engine)), [cloudDraw]);
});

test('kalıcı bulut oturumu açılışta bekleyen yerel kayıtları eşitler', async () => {
  const pending = [[1, '01/07/2026', [1, 2, 3, 4, 5, 6]]];
  const engine = createEngine({ stored: JSON.stringify(pending) });
  vm.runInContext(`
    var initSyncCalls = 0;
    renderCloudPanel = () => {};
    render = () => {};
    toast = () => {};
    ensureSupabaseLibrary = async () => true;
    loadCloudDraws = async () => ({ ok: true, count: 0 });
    checkCloudAdmin = async () => true;
    syncLocalDrawsToCloud = async () => { initSyncCalls++; return { synced: 1 }; };
    window.SUPABASE_CONFIG = { url: 'https://example.test', publishableKey: 'test-key' };
    window.supabase = {
      createClient() {
        return {
          auth: {
            getSession: async () => ({ data: { session: { user: { email: 'admin@example.test' } } }, error: null })
          }
        };
      }
    };
  `, engine);

  await engine.initCloud();
  assert.equal(vm.runInContext('initSyncCalls', engine), 1);
});

test('aynı tarihli farklı bulut kaydını sessizce ezmez', async () => {
  const pending = [[8, '01/07/2026', [1, 2, 3, 4, 5, 6]]];
  const engine = createEngine({ stored: JSON.stringify(pending) });
  vm.runInContext(`
    var conflictUpsertCalls = 0;
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudDraws = [[8, '01/07/2026', [7, 8, 9, 10, 11, 12]]];
    cloudClient = {
      from() {
        conflictUpsertCalls++;
        return { upsert: async () => ({ error: null }) };
      }
    };
  `, engine);

  const result = await engine.syncLocalDrawsToCloud();
  assert.equal(result.synced, 0);
  assert.equal(result.conflicts, 1);
  assert.match(result.warning, /çakışma kuyruğunda/i);
  assert.equal(vm.runInContext('conflictUpsertCalls', engine), 0);
  assert.deepEqual(plain(vm.runInContext('userDraws', engine)), pending);
});

test('bulutta bulunmayan yeni yerel tarihi upsert yerine insert ile eşitler', async () => {
  const pending = [[8, '01/07/2026', [1, 2, 3, 4, 5, 6]]];
  const engine = createEngine({ stored: JSON.stringify(pending) });
  vm.runInContext(`
    var newDateInsertCalls = 0;
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudClient = {
      from() {
        return {
          insert: async () => {
            newDateInsertCalls++;
            return { error: null };
          }
        };
      }
    };
  `, engine);

  const result = await engine.syncLocalDrawsToCloud();
  assert.equal(result.synced, 1);
  assert.equal(vm.runInContext('newDateInsertCalls', engine), 1);
  assert.deepEqual(plain(vm.runInContext('userDraws', engine)), []);
});

test('aynı yeni yerel kaydın kopyalarını tek bulut insertiyle eşitler', async () => {
  const draw = [8, '01/07/2026', [1, 2, 3, 4, 5, 6]];
  const engine = createEngine({ stored: JSON.stringify([draw, draw]) });
  vm.runInContext(`
    var duplicateInsertCalls = 0;
    var duplicateInsertRows = 0;
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudClient = {
      from() {
        return {
          insert: async rows => {
            duplicateInsertCalls++;
            duplicateInsertRows += rows.length;
            return { error: null };
          }
        };
      }
    };
  `, engine);

  const result = await engine.syncLocalDrawsToCloud();
  assert.equal(result.synced, 2);
  assert.equal(vm.runInContext('duplicateInsertCalls', engine), 1);
  assert.equal(vm.runInContext('duplicateInsertRows', engine), 1);
  assert.deepEqual(plain(vm.runInContext('userDraws', engine)), []);
});

test('paket güncellemesiyle çakışan yerel sonucu buluta yüklemez', async () => {
  const official = [8, '01/07/2026', [7, 8, 9, 10, 11, 12]];
  const pending = [8, '01/07/2026', [1, 2, 3, 4, 5, 6]];
  const engine = createEngine({ data: [official], stored: JSON.stringify([pending]) });
  vm.runInContext(`
    var staticConflictUpsertCalls = 0;
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudClient = {
      from() {
        staticConflictUpsertCalls++;
        return { upsert: async () => ({ error: null }) };
      }
    };
  `, engine);

  const result = await engine.syncLocalDrawsToCloud();
  assert.equal(result.conflicts, 1);
  assert.equal(vm.runInContext('staticConflictUpsertCalls', engine), 0);
  assert.deepEqual(plain(vm.runInContext('userDraws', engine)), [pending]);
});

test('paket aralığındaki boşluk tarihli yerel sonucu buluta yüklemez', async () => {
  const firstOfficial = [1, '01/07/2026', [1, 2, 3, 4, 5, 6]];
  const lastOfficial = [2, '05/07/2026', [7, 8, 9, 10, 11, 12]];
  const pending = [90, '03/07/2026', [13, 14, 15, 16, 17, 18]];
  const engine = createEngine({ data: [firstOfficial, lastOfficial], stored: JSON.stringify([pending]) });
  vm.runInContext(`
    var archiveGapWriteCalls = 0;
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudClient = {
      from() {
        archiveGapWriteCalls++;
        return {
          insert: async () => ({ error: null }),
          upsert: async () => ({ error: null })
        };
      }
    };
  `, engine);

  const result = await engine.syncLocalDrawsToCloud();
  assert.equal(result.synced, 0);
  assert.equal(result.conflicts, 1);
  assert.equal(vm.runInContext('archiveGapWriteCalls', engine), 0);
  assert.deepEqual(plain(vm.runInContext('userDraws', engine)), [pending]);
});

test('paketle aynı yerel sonuç bulutta eksikse gerçekten yükler', async () => {
  const official = [8, '01/07/2026', [1, 2, 3, 4, 5, 6]];
  const engine = createEngine({ data: [official], stored: JSON.stringify([official]) });
  vm.runInContext(`
    var missingCloudUpsertCalls = 0;
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudClient = {
      from() {
        missingCloudUpsertCalls++;
        return { upsert: async () => ({ error: null }) };
      }
    };
  `, engine);

  const result = await engine.syncLocalDrawsToCloud();
  assert.equal(result.synced, 1);
  assert.equal(vm.runInContext('missingCloudUpsertCalls', engine), 1);
  assert.deepEqual(plain(vm.runInContext('userDraws', engine)), []);
});

test('paketle aynı yerel kopyaları tek onarım upsertiyle temizler', async () => {
  const official = [8, '01/07/2026', [1, 2, 3, 4, 5, 6]];
  const engine = createEngine({ data: [official], stored: JSON.stringify([official, official]) });
  vm.runInContext(`
    var duplicateRepairCalls = 0;
    var duplicateRepairRows = 0;
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudClient = {
      from() {
        return {
          upsert: async rows => {
            duplicateRepairCalls++;
            duplicateRepairRows += rows.length;
            return { error: null };
          }
        };
      }
    };
  `, engine);

  const result = await engine.syncLocalDrawsToCloud();
  assert.equal(result.synced, 2);
  assert.equal(vm.runInContext('duplicateRepairCalls', engine), 1);
  assert.equal(vm.runInContext('duplicateRepairRows', engine), 1);
  assert.deepEqual(plain(vm.runInContext('userDraws', engine)), []);
});

test('toplu arşiv aktarımı çözülmemiş yerel çakışmayı buluta yazmaz', async () => {
  const official = [8, '01/07/2026', [7, 8, 9, 10, 11, 12]];
  const pending = [8, '01/07/2026', [1, 2, 3, 4, 5, 6]];
  const engine = createEngine({ data: [official], stored: JSON.stringify([pending]) });
  vm.runInContext(`
    var archiveConflictCalls = 0;
    var archiveConflictError = '';
    showErr = message => { archiveConflictError = message; };
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudClient = {
      from() {
        archiveConflictCalls++;
        return {};
      }
    };
  `, engine);

  await engine.syncArchiveToCloud();
  assert.equal(vm.runInContext('archiveConflictCalls', engine), 0);
  assert.match(vm.runInContext('archiveConflictError', engine), /çözülmeden/i);
  assert.deepEqual(plain(vm.runInContext('userDraws', engine)), [pending]);
});

test('toplu arşiv aktarımı eski bulut fazlalıklarını atomik RPC ile temizler', async () => {
  const official = [8, '01/07/2026', [7, 8, 9, 10, 11, 12]];
  const engine = createEngine({ data: [official] });
  vm.runInContext(`
    var archiveRpcCalls = 0;
    var archiveRpcName = '';
    var archiveRpcArgs = null;
    var archiveToast = '';
    showErr = () => {};
    render = () => {};
    toast = message => { archiveToast = message; };
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudDraws = [[7, '30/06/2026', [1, 2, 3, 4, 5, 6]]];
    loadCloudDraws = async () => {
      cloudDraws = [[8, '01/07/2026', [7, 8, 9, 10, 11, 12]]];
      return { ok: true, count: 1 };
    };
    cloudClient = {
      rpc: async (name, args) => {
        archiveRpcCalls++;
        archiveRpcName = name;
        archiveRpcArgs = args;
        return { data: 1, error: null };
      }
    };
  `, engine);

  await engine.syncArchiveToCloud();
  assert.equal(vm.runInContext('archiveRpcCalls', engine), 1);
  assert.equal(vm.runInContext('archiveRpcName', engine), 'replace_loto_archive');
  assert.deepEqual(plain(vm.runInContext('archiveRpcArgs.p_rows', engine)), [{
    draw_date: '2026-07-01',
    week_no: 8,
    numbers: [7, 8, 9, 10, 11, 12],
    bonus: null
  }]);
  assert.match(vm.runInContext('archiveToast', engine), /1 sonuç bulutla eşitlendi/i);
});

test('atomik arşiv RPC hatasında eski bulut arşivinin korunduğunu bildirir', async () => {
  const official = [8, '01/07/2026', [7, 8, 9, 10, 11, 12]];
  const engine = createEngine({ data: [official] });
  vm.runInContext(`
    var archiveRpcError = '';
    showErr = message => { archiveRpcError = message; };
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudClient = {
      rpc: async () => ({ data: null, error: { code: '22023', message: 'test hatasi' } })
    };
  `, engine);

  await engine.syncArchiveToCloud();
  assert.match(vm.runInContext('archiveRpcError', engine), /eski arşiv korundu/i);
});

test('bulut silme sıfır satır etkilediğinde bellekte başarı taklidi yapmaz', async () => {
  const draw = [8, '01/07/2026', [1, 2, 3, 4, 5, 6]];
  const engine = createEngine();
  vm.runInContext(`
    var deleteErrorMessage = '';
    render = () => {};
    toast = () => {};
    showErr = message => { deleteErrorMessage = message; };
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudDraws = [[8, '01/07/2026', [1, 2, 3, 4, 5, 6]]];
    cloudClient = {
      from() {
        return {
          delete() { return this; },
          eq() { return this; },
          select: async () => ({ data: [], error: null })
        };
      }
    };
  `, engine);

  await engine.deleteDraw(8, '01/07/2026');
  assert.match(vm.runInContext('deleteErrorMessage', engine), /bulunamadı|yetkisi/i);
  assert.deepEqual(plain(vm.runInContext('cloudDraws', engine)), [draw]);
  assert.equal(engine.storage.get('testDraws'), '[]');
});

test('aynı tarihli yerel çakışmayı silerken bulut sürümünü korur', async () => {
  const localDraw = [8, '01/07/2026', [1, 2, 3, 4, 5, 6]];
  const cloudDraw = [8, '01/07/2026', [7, 8, 9, 10, 11, 12]];
  const engine = createEngine({ stored: JSON.stringify([localDraw]) });
  vm.runInContext(`
    var conflictDeleteCalls = 0;
    var conflictDeleteToast = '';
    render = () => {};
    toast = message => { conflictDeleteToast = message; };
    showErr = () => {};
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudDraws = [[8, '01/07/2026', [7, 8, 9, 10, 11, 12]]];
    cloudClient = {
      from() {
        conflictDeleteCalls++;
        return {};
      }
    };
  `, engine);

  await engine.deleteDraw(8, '01/07/2026');
  assert.equal(vm.runInContext('conflictDeleteCalls', engine), 0);
  assert.deepEqual(plain(vm.runInContext('userDraws', engine)), []);
  assert.deepEqual(plain(vm.runInContext('cloudDraws', engine)), [cloudDraw]);
  assert.match(vm.runInContext('conflictDeleteToast', engine), /bulut sürümü korundu/i);
});

test('bulut çıkışı başarısızsa oturumu açık tutup doğru hata verir', async () => {
  const engine = createEngine();
  vm.runInContext(`
    var logoutErrorMessage = '';
    showErr = message => { logoutErrorMessage = message; };
    renderCloudPanel = () => {};
    render = () => {};
    toast = () => {};
    cloudSession = { user: { email: 'admin@example.test' } };
    cloudIsAdmin = true;
    cloudClient = {
      auth: { signOut: async () => ({ error: { message: 'network unavailable' } }) }
    };
  `, engine);

  await engine.cloudLogout();
  assert.match(vm.runInContext('logoutErrorMessage', engine), /Çıkış yapılamadı/i);
  assert.equal(vm.runInContext('cloudSession !== null', engine), true);
  assert.equal(vm.runInContext('cloudIsAdmin', engine), true);
});

function syncEngine(responses, options = {}) {
  const engine = createEngine(options);
  engine.replies = responses;
  vm.runInContext(`
    var syncCalls = [], syncToasts = [], syncProgress = [], syncWaits = 0, syncLoads = 0;
    cloudSession = { user: { id: 'admin' } };
    cloudIsAdmin = true;
    cloudClient = {};
    render = () => {};
    renderCloudPanel = () => { syncProgress.push({ busy: officialSyncBusy, message: officialSyncMessage }); };
    clearFormError = () => {};
    showErr = message => { throw new Error(message); };
    toast = (message, kind) => syncToasts.push({ message, kind });
    wait = async () => { syncWaits++; };
    loadCloudDraws = async () => { syncLoads++; return { ok: true }; };
    requestOfficialSync = async body => {
      syncCalls.push(body);
      const next = replies.shift();
      if (!next) throw new Error('network unavailable');
      return { ok: true, run: next };
    };
  `, engine);
  return engine;
}

test('online button follows one exact run beyond the old three-minute limit', async () => {
  const running = { id: 123, status: 'in_progress', step: 'Kaynak taranıyor' };
  const engine = syncEngine([
    { id: 123, status: 'queued' }, ...Array(22).fill(running),
    { id: 123, status: 'completed', conclusion: 'success', unresolved_conflicts: 0 }
  ]);
  await Promise.all([engine.triggerOfficialResultSync(), engine.triggerOfficialResultSync()]);
  assert.equal(engine.syncCalls.filter(call => call.action === 'start').length, 1);
  assert.ok(engine.syncCalls.filter(call => call.action === 'status').every(call => call.run_id === 123));
  assert.equal(engine.syncWaits, 22);
  assert.equal(engine.syncLoads, 1);
  assert.equal(engine.storage.has('lotoOfficialSyncRun'), false);
  assert.match(engine.syncToasts.at(-1).message, /başarıyla tamamlandı/);
  assert.equal(vm.runInContext('officialSyncBusy', engine), false);
});

for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
  test(`online button reports ${conclusion} promptly without claiming success`, async () => {
    const engine = syncEngine([{ id: 123, status: 'completed', conclusion, step: 'Hazırlık' }], { syncRunId: 123 });
    await engine.triggerOfficialResultSync();
    assert.equal(engine.syncCalls[0].action, 'status');
    assert.equal(engine.syncLoads, 0);
    assert.equal(engine.syncToasts.at(-1).kind, 'warn');
    assert.match(engine.syncToasts.at(-1).message, /tamamlanamadı/);
    assert.equal(engine.storage.has('lotoOfficialSyncRun'), false);
  });
}

test('page refresh/category navigation resumes saved run without dispatch', async () => {
  const engine = syncEngine([{ id: 444, status: 'completed', conclusion: 'success' }], { syncRunId: 444 });
  await engine.triggerOfficialResultSync();
  assert.deepEqual(plain(engine.syncCalls), [{ action: 'status', run_id: 444 }]);
});

test('network failure retains run ID; retry checks the same job', async () => {
  const engine = syncEngine([], { syncRunId: 123 });
  await engine.triggerOfficialResultSync();
  assert.equal(engine.storage.get('lotoOfficialSyncRun'), '123');
  assert.match(engine.syncToasts.at(-1).message, /doğrulanamıyor/);
  engine.replies.push({ id: 123, status: 'completed', conclusion: 'success' });
  await engine.triggerOfficialResultSync();
  assert.ok(engine.syncCalls.every(call => call.action === 'status'));
  assert.equal(engine.syncLoads, 1);
});

test('tracking budget exhaustion is not reported as workflow failure', async () => {
  const engine = syncEngine(Array(120).fill({ id: 123, status: 'queued' }), { syncRunId: 123 });
  await engine.triggerOfficialResultSync();
  assert.equal(engine.storage.get('lotoOfficialSyncRun'), '123');
  assert.match(engine.syncToasts.at(-1).message, /İzleme duraklatıldı/);
  assert.equal(engine.syncLoads, 0);
});

test('unresolved conflicts remain visible after a successful job', async () => {
  const engine = syncEngine([{ id: 123, status: 'completed', conclusion: 'success', unresolved_conflicts: 2 }], { syncRunId: 123 });
  await engine.triggerOfficialResultSync();
  assert.match(engine.syncToasts.at(-1).message, /2 çözülmemiş/);
  assert.equal(engine.syncToasts.at(-1).kind, 'warn');
  assert.equal(engine.syncLoads, 1);
});

test('wrong run ID cannot be mistaken for completion', async () => {
  const engine = syncEngine(Array(3).fill({ id: 999, status: 'completed', conclusion: 'success' }), { syncRunId: 123 });
  await engine.triggerOfficialResultSync();
  assert.equal(engine.syncLoads, 0);
  assert.equal(engine.storage.get('lotoOfficialSyncRun'), '123');
});
