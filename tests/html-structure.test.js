const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pages = [
  'index.html',
  'sayisal-loto.html',
  'super-loto.html',
  'sans-topu.html',
  'on-numara.html'
];
const gamePages = pages.slice(1);
const importWeekModes = {
  'sayisal-loto.html': 'preferred',
  'super-loto.html': 'preferred',
  'sans-topu.html': 'preferred',
  'on-numara.html': 'absent'
};

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function matches(source, pattern) {
  return [...source.matchAll(pattern)];
}

test('all pages expose the shared semantic and cache-safe shell', () => {
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /<html lang="tr">/, `${page}: Turkish document language`);
    assert.match(html, /<meta name="viewport"[^>]*viewport-fit=cover/, `${page}: responsive viewport`);
    assert.match(html, /<meta name="description" content="[^"]+">/, `${page}: description`);
    assert.match(html, /<link rel="icon" href="favicon\.svg\?v=20260717"/, `${page}: favicon`);
    assert.match(html, /<a class="skip-link" href="#main-content">/, `${page}: skip link`);
    assert.match(html, /<nav class="navbar" aria-label="Ana menü">/, `${page}: named navigation`);
    assert.match(html, /<img class="nav-logo-mark" src="favicon\.svg\?v=20260717" alt="" width="26" height="26">/, `${page}: stable lottery-ball brand mark`);
    assert.doesNotMatch(html, /🎰/, `${page}: no platform-dependent slot-machine emoji`);
    assert.match(html, /<div class="nav-links">/, `${page}: responsive navigation rail`);
    assert.match(html, /<main id="main-content"[^>]*tabindex="-1"/, `${page}: focusable main landmark`);
    assert.doesNotMatch(html, /v=20260713/, `${page}: no stale asset token`);
    assert.doesNotMatch(html, /\bonclick\s*=/i, `${page}: no inline click handlers`);
    assert.doesNotMatch(html, /apple-mobile-web-app|mobile-web-app-capable/i, `${page}: no misleading app metadata`);
    assert.doesNotMatch(html, /style="[^"]*display\s*:\s*none/i, `${page}: native hidden attribute`);

    const ids = matches(html, /\bid="([^"]+)"/g).map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${page}: unique ids`);

    for (const [, attribute, target] of matches(html, /\b(href|src)="([^"#][^"]*)"/g)) {
      if (/^(?:https?:|data:|mailto:|tel:)/i.test(target)) continue;
      const localPath = target.split('?')[0];
      assert.ok(fs.existsSync(path.join(root, localPath)), `${page}: ${attribute} target exists (${localPath})`);
    }
  }
});

test('game pages preserve the accessible form and tab contracts required by loto.js', () => {
  for (const page of gamePages) {
    const html = read(page);
    assert.match(html, /<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net" crossorigin>/, `${page}: CDN preconnect`);
    assert.match(html, /<form id="drawForm" class="form-row">/, `${page}: draw form`);
    assert.match(html, /<details class="archive-tools">/, `${page}: secondary archive tools disclosure`);
    assert.match(html, /<div class="card analysis-card">/, `${page}: polished analysis shell`);
    assert.match(html, /Adil çekilişte her geçerli kolonun teorik şansı eşittir/, `${page}: recommendation limitation is explicit`);
    assert.match(html, /<div id="cloudPanelHost"><\/div>/, `${page}: cloud controls stay inside archive tools`);
    assert.match(html, /id="fErr" role="alert"/, `${page}: validation alert`);
    assert.match(html, /id="toast" role="status" aria-live="polite"/, `${page}: live toast`);
    assert.match(html, /<caption class="sr-only">/, `${page}: table caption`);
    assert.match(html, /<h2 class="card-title"/, `${page}: hierarchical section heading`);
    assert.match(html, /<th scope="col">/, `${page}: scoped headings`);
    assert.match(
      html,
      /<div class="tbl-wrap" tabindex="0" role="region" aria-label="Son çekiliş sonuçları tablosu">/,
      `${page}: keyboard-scrollable named table region`
    );

    const controls = matches(html, /<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"[^>]*>/g)
      .map((match) => match[1]);
    for (const id of controls) {
      assert.match(html, new RegExp(`<label\\s+for="${id}"`), `${page}: label for #${id}`);
    }
    assert.match(html, /<input\b[^>]*\bid="iNums"[^>]*\binputmode="text"/, `${page}: separator-friendly number keyboard`);
    assert.match(
      html,
      new RegExp(`importWeekMode:\\s*'${importWeekModes[page]}'`),
      `${page}: explicit TXT week contract`
    );

    const tabs = matches(html, /<button\b[^>]*\brole="tab"[^>]*>/g).map((match) => match[0]);
    const panels = matches(html, /<div\b[^>]*\brole="tabpanel"[^>]*>/g).map((match) => match[0]);
    assert.equal(tabs.length, 6, `${page}: six tabs`);
    assert.equal(panels.length, 6, `${page}: six panels`);
    assert.equal(panels.filter((panel) => /\bhidden\b/.test(panel)).length, 5, `${page}: one initially visible panel`);

    for (const tab of tabs) {
      const id = tab.match(/\bid="([^"]+)"/)[1];
      const controlsId = tab.match(/\baria-controls="([^"]+)"/)[1];
      assert.match(html, new RegExp(`<div\\s+id="${controlsId}"[^>]*aria-labelledby="${id}"`), `${page}: ${id} controls ${controlsId}`);
    }

    for (const action of ['import-txt', 'download-data', 'export-csv', 'regenerate']) {
      assert.match(html, new RegExp(`data-action="${action}"`), `${page}: ${action} action`);
    }
  }
});

test('analysis presentation keeps its structured visual hierarchy', () => {
  const script = read('loto.js');
  const css = read('loto.css');

  assert.match(script, /class="oneri-card-head"/, 'recommendation cards have a dedicated header');
  assert.match(script, /class="oneri-score"/, 'recommendation score is visually separated');
  assert.match(script, /const archiveCount = draws\.length\.toLocaleString\('tr-TR'\)/, 'recommendation explains its archive sample');
  assert.doesNotMatch(script, /buildNumberScores\(draws, 'overdue'\)/, 'recommendation does not use gambler-fallacy overdue pressure');
  assert.doesNotMatch(script, /candidateQuality/, 'recommendation does not impose artificial number-shape patterns');
  assert.match(css, /\.grid90\s*\{[\s\S]*?grid-template-columns:\s*repeat\(15,\s*minmax\(0,\s*1fr\)\)/, 'number map uses a readable desktop grid');
  assert.doesNotMatch(css, /\.land-hero::after\s*\{/, 'decorative hero orb is removed');
});

test('cloud controls and Supabase migration keep administrative writes fail-closed', () => {
  const script = read('loto.js');
  const sql = read('supabase-rls.sql');

  assert.match(script, /summary\.setAttribute\('role', 'status'\)/, 'cloud status is announced');
  assert.match(script, /email\.name = 'email'/, 'cloud email has a meaningful name');
  assert.match(script, /email\.spellcheck = false/, 'cloud email disables spellcheck');
  assert.match(script, /error\.id = 'cloudErr'/, 'cloud login has an inline error');
  assert.match(script, /cloudAdminReady === false/, 'missing admin RPC is shown as read-only');
  assert.match(script, /error\?\.code !== 'PGRST202'/, 'admin schema readiness distinguishes a missing RPC');
  assert.match(script, /document\.getElementById\('cloudPanelHost'\)/, 'cloud controls use the archive tools host');

  assert.match(
    sql,
    /revoke all privileges on table public\.loto_draws from public, anon, authenticated/i,
    'anonymous writes are explicitly revoked'
  );
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete)[^;]*\bto\s+anon\b/i, 'anonymous writes are never granted');
  assert.match(sql, /cmd in \('ALL', 'INSERT', 'UPDATE', 'DELETE'\)/, 'legacy write policies are removed');
  assert.match(sql, /create trigger loto_draws_year_week_guard/i, 'concurrent year/week duplicates are guarded');
  assert.match(
    sql,
    /existing\.draw_date is distinct from new\.draw_date/i,
    'the year/week guard permits idempotent same-date upserts'
  );
  assert.match(sql, /create or replace function public\.replace_loto_archive/i, 'atomic archive repair RPC is defined');
  assert.match(sql, /if auth\.uid\(\) is null or not public\.is_loto_admin\(\)/i, 'archive replacement requires an admin');
  assert.match(sql, /delete from public\.loto_draws where game = p_game/i, 'stale category rows are removed atomically');
  assert.match(sql, /insert into public\.loto_draws \(game, draw_date, week_no, numbers, bonus\)/i, 'canonical rows are restored');
  assert.match(
    sql,
    /grant execute on function public\.replace_loto_archive\(text, jsonb\) to authenticated/i,
    'only authenticated users can invoke archive replacement before the admin check'
  );
  assert.match(sql, /loto_draws_game_year_week_unique_modern/i, 'modern year/week uniqueness index is defined');
});
