import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deduplicateDraws, getTargetPeriods, GAMES, parseCard, validateDraw } from '../automation/scrape-and-sync.mjs';

const officialHref = '/sayisal-loto/cekilis-sonuclari/95';

test('Sayısal Loto kartında Joker ve Süperstar ana sayılara karışmaz', () => {
  const draw = parseCard({
    label: '95. Çekiliş',
    date: '10.08.2026 Pazartesi',
    href: officialHref,
    numbers: [
      { value: '8' }, { value: '23' }, { value: '32' },
      { value: '41' }, { value: '48' }, { value: '89' },
      { value: '34', content: 'Joker' }, { value: '77', content: 'Süperstar' }
    ]
  }, 'sayisal', GAMES.sayisal);

  assert.deepEqual(draw.numbers, [8, 23, 32, 41, 48, 89]);
  assert.equal(draw.bonus, null);
  assert.equal(draw.draw_date, '2026-08-10');
  assert.equal(draw.week_no, 95);
});

test('Şans Topu kartında altıncı sayı bonus olarak ayrılır', () => {
  const draw = parseCard({
    label: '63. Çekiliş',
    date: '09.08.2026 Pazar',
    href: '/sans-topu/cekilis-sonuclari/63',
    numbers: ['6', '12', '22', '24', '31', '8'].map(value => ({ value }))
  }, 'sans', GAMES.sans);

  assert.deepEqual(draw.numbers, [6, 12, 22, 24, 31]);
  assert.equal(draw.bonus, 8);
});

test('On Numara yalnızca 22 farklı ve geçerli sayı kabul eder', () => {
  const values = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55, 58, 61, 64];
  const draw = parseCard({
    label: '64. Çekiliş',
    date: '10.08.2026 Pazartesi',
    href: '/on-numara/cekilis-sonuclari/64',
    numbers: values.map(value => ({ value }))
  }, 'onnumara', GAMES.onnumara);

  assert.equal(draw.numbers.length, 22);
  assert.deepEqual(draw.numbers, values);
});

test('doğrulayıcı tekrar, aralık, takvim ve gelecek tarih hatalarını reddeder', () => {
  const base = {
    game: 'super',
    draw_date: '2026-08-09',
    week_no: 95,
    numbers: [10, 27, 31, 32, 39, 54],
    bonus: null,
    source_url: 'https://www.millipiyangoonline.com/super-loto/cekilis-sonuclari/95'
  };
  const today = new Date('2026-08-11T12:00:00+03:00');

  assert.equal(validateDraw(base, GAMES.super, today), '');
  assert.match(validateDraw({ ...base, numbers: [10, 10, 31, 32, 39, 54] }, GAMES.super, today), /tekrarsız/);
  assert.match(validateDraw({ ...base, numbers: [10, 27, 31, 32, 39, 61] }, GAMES.super, today), /1–60/);
  assert.match(validateDraw({ ...base, draw_date: '2026-02-31' }, GAMES.super, today), /Geçersiz/);
  assert.match(validateDraw({ ...base, draw_date: '2026-08-12' }, GAMES.super, today), /Gelecek/);
});

test('aynı oyun ve tarihte farklı sonuç kaynak hatası sayılır', () => {
  const first = {
    game: 'sayisal', draw_date: '2026-08-10', week_no: 95,
    numbers: [8, 23, 32, 41, 48, 89], bonus: null,
    source_url: `https://www.millipiyangoonline.com${officialHref}`
  };
  assert.equal(deduplicateDraws([first, { ...first }]).length, 1);
  assert.throws(() => deduplicateDraws([
    first,
    { ...first, numbers: [8, 23, 32, 41, 48, 90] }
  ]), /iki farklı sonuç/);
});

test('gelecek tarih sınırı sunucunun değil Türkiye takviminin günüdür', () => {
  const draw = {
    game: 'super', draw_date: '2026-09-01', week_no: 1,
    numbers: [1, 2, 3, 4, 5, 6], bonus: null,
    source_url: 'https://www.millipiyangoonline.com/super-loto/cekilis-sonuclari/1'
  };
  assert.match(validateDraw(draw, GAMES.super, new Date('2026-08-31T20:59:59Z')), /Gelecek/);
  assert.equal(validateDraw(draw, GAMES.super, new Date('2026-08-31T21:00:00Z')), '');
  assert.match(validateDraw({ ...draw, draw_date: '2026-09-02' }, GAMES.super, new Date('2026-09-01T12:00:00Z')), /Gelecek/);
});

test('otomasyon mevcut ayla birlikte önceki ayı ve yıl geçişini tarar', () => {
  assert.deepEqual(getTargetPeriods(1, new Date('2026-08-11T12:00:00+03:00')), [
    { year: 2026, month: 8 },
    { year: 2026, month: 7 }
  ]);
  assert.deepEqual(getTargetPeriods(1, new Date('2027-01-02T12:00:00+03:00')), [
    { year: 2027, month: 1 },
    { year: 2026, month: 12 }
  ]);
});

test('SQL aktarımı sadece service_role ile çalışır ve manuel çakışmayı ezmez', async () => {
  const sql = await readFile(new URL('../supabase-automation.sql', import.meta.url), 'utf8');
  assert.match(sql, /auth\.role\(\).*service_role/s);
  assert.match(sql, /loto_sync_conflicts/);
  assert.match(sql, /Ayni tarih icin kayitli sonuc resmi kaynaktan farkli/);
  assert.doesNotMatch(sql, /do update set\s+numbers\s*=/i);
  assert.match(sql, /grant execute on function public\.import_official_loto_results\(jsonb\) to service_role/);
});

test('GitHub zamanlayıcısı gizli Supabase anahtarı kullanır', async () => {
  const workflow = await readFile(new URL('../.github/workflows/loto-sync.yml', import.meta.url), 'utf8');
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /secrets\.SUPABASE_SECRET_KEY/);
  assert.match(workflow, /xvfb-run --auto-servernum npm run sync:loto/);
  assert.match(workflow, /LOTO_HEADLESS: 'false'/);
  assert.match(workflow, /LOTO_MONTHS_BACK:/);
  assert.match(workflow, /runs-on: ubuntu-24.04/);
  assert.match(workflow, /google-chrome --version/);
  assert.doesNotMatch(workflow, /playwright install|apt-get|apt install/);
});

test('manuel online kontrol yalnız yönetici Edge Function üzerinden tetiklenir', async () => {
  const frontend = await readFile(new URL('../loto.js', import.meta.url), 'utf8');
  const edgeFunction = await readFile(new URL('../supabase/functions/trigger-loto-sync/handler.mjs', import.meta.url), 'utf8');
  assert.match(frontend, /functions\.invoke\('trigger-loto-sync'/);
  assert.match(edgeFunction, /rpc\('is_loto_admin'\)/);
  assert.match(edgeFunction, /GITHUB_ACTIONS_TOKEN/);
  assert.match(edgeFunction, /actions\/workflows\/loto-sync\.yml\/dispatches/);
  assert.doesNotMatch(frontend, /GITHUB_ACTIONS_TOKEN/);
});
