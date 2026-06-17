#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = process.env.COLLECTAPI_KEY;
const DATA_DIR = fs.existsSync(path.join(ROOT, 'data-sayisal.js'))
  ? ROOT
  : path.join(ROOT, 'loto');

const GAMES = {
  sayisal: {
    label: 'Sayisal Loto',
    endpoint: '/chancegame/sayisalLoto',
    file: path.join(DATA_DIR, 'data-sayisal.js'),
    variable: 'SAYISAL_DATA',
    maxNum: 90,
    pickCount: 6,
  },
  super: {
    label: 'Super Loto',
    endpoint: '/chancegame/superLoto',
    file: path.join(DATA_DIR, 'data-super.js'),
    variable: 'SUPER_DATA',
    maxNum: 60,
    pickCount: 6,
  },
  sans: {
    label: 'Sans Topu',
    endpoint: '/chancegame/sanstopu',
    file: path.join(DATA_DIR, 'data-sans.js'),
    variable: 'SANS_DATA',
    maxNum: 34,
    pickCount: 5,
    bonusKey: 'sanstopu',
    bonusMax: 14,
  },
};

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const selectedGame = argValue('game') || 'all';
const dryRun = process.argv.includes('--dry-run');

function selectedGames() {
  if (selectedGame === 'all') return Object.keys(GAMES);
  if (!GAMES[selectedGame]) {
    throw new Error(`Bilinmeyen oyun: ${selectedGame}. Secenekler: all, ${Object.keys(GAMES).join(', ')}`);
  }
  return [selectedGame];
}

function requestJson(endpoint) {
  if (!TOKEN) {
    throw new Error('COLLECTAPI_KEY bulunamadi. GitHub Secrets veya ortam degiskeni olarak ekleyin.');
  }

  const options = {
    method: 'GET',
    hostname: 'api.collectapi.com',
    path: endpoint,
    headers: {
      'content-type': 'application/json',
      authorization: `apikey ${TOKEN}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`API HTTP ${res.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`API JSON parse hatasi: ${error.message}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function readData(config) {
  const source = fs.readFileSync(config.file, 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: config.file });
  const data = context[config.variable];
  if (!Array.isArray(data)) throw new Error(`${config.variable} dizisi okunamadi.`);
  return { source, data };
}

function parseDate(dateText) {
  const normalized = String(dateText || '').trim().replace(/\./g, '/');
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`Tarih formati gecersiz: ${dateText}`);
  return `${match[1]}/${match[2]}/${match[3]}`;
}

function dateKey(dateText) {
  const [day, month, year] = dateText.split('/').map(Number);
  return year * 10000 + month * 100 + day;
}

function parseNumbers(numbersText, config) {
  const numbers = String(numbersText || '')
    .split(/\s*-\s*/)
    .map((part) => Number(part.trim()))
    .filter((num) => !Number.isNaN(num));

  if (numbers.length !== config.pickCount) {
    throw new Error(`${config.label}: ${config.pickCount} sayi bekleniyordu, ${numbers.length} geldi.`);
  }
  if (new Set(numbers).size !== numbers.length) {
    throw new Error(`${config.label}: Tekrarli sayi geldi: ${numbers.join(', ')}`);
  }
  if (numbers.some((num) => !Number.isInteger(num) || num < 1 || num > config.maxNum)) {
    throw new Error(`${config.label}: Sayi araligi hatali: ${numbers.join(', ')}`);
  }

  return numbers.sort((a, b) => a - b);
}

function parseBonus(item, config) {
  if (!config.bonusKey) return undefined;
  const bonus = Number(item[config.bonusKey]);
  if (!Number.isInteger(bonus) || bonus < 1 || bonus > config.bonusMax) {
    throw new Error(`${config.label}: Bonus hatali: ${item[config.bonusKey]}`);
  }
  return bonus;
}

function nextDrawNo(data, dateText) {
  const year = Number(dateText.slice(-4));
  const sameYear = data.filter((draw) => String(draw[1]).endsWith(`/${year}`));
  if (!sameYear.length) return 1;
  return Math.max(...sameYear.map((draw) => Number(draw[0]) || 0)) + 1;
}

function normalizeApiItem(item, config, data) {
  const date = parseDate(item.tarih);
  const numbers = parseNumbers(item.rakamlar, config);
  const bonus = parseBonus(item, config);
  const drawNo = nextDrawNo(data, date);
  return bonus === undefined ? [drawNo, date, numbers] : [drawNo, date, numbers, bonus];
}

function appendDraws(source, additions) {
  const closeIndex = source.lastIndexOf('];');
  if (closeIndex === -1) throw new Error('Veri dosyasinda kapanis bulunamadi: ];');

  const before = source.slice(0, closeIndex).trimEnd();
  const after = source.slice(closeIndex);
  const separator = before.endsWith('[') || before.endsWith(',') ? '' : ',';
  const rows = additions.map((draw) => JSON.stringify(draw)).join(',\n');
  return `${before}${separator}\n${rows},\n${after}`;
}

function validateAll(data, config) {
  for (const draw of data) {
    const numbers = draw[2];
    if (!Array.isArray(numbers) || numbers.length !== config.pickCount) {
      throw new Error(`${config.label}: Kayit sayi adedi hatali: ${JSON.stringify(draw)}`);
    }
    if (new Set(numbers).size !== numbers.length) {
      throw new Error(`${config.label}: Kayitta tekrarli sayi var: ${JSON.stringify(draw)}`);
    }
    if (numbers.some((num) => !Number.isInteger(num) || num < 1 || num > config.maxNum)) {
      throw new Error(`${config.label}: Kayitta sayi araligi hatali: ${JSON.stringify(draw)}`);
    }
    if (config.bonusKey && (!Number.isInteger(draw[3]) || draw[3] < 1 || draw[3] > config.bonusMax)) {
      throw new Error(`${config.label}: Kayitta bonus hatali: ${JSON.stringify(draw)}`);
    }
  }
}

async function updateGame(gameKey) {
  const config = GAMES[gameKey];
  const { source, data } = readData(config);
  const latestDate = Math.max(...data.map((draw) => dateKey(draw[1])));
  const existingDates = new Set(data.map((draw) => draw[1]));

  const response = await requestJson(config.endpoint);
  if (!response.success || !Array.isArray(response.result)) {
    throw new Error(`${config.label}: API basarisiz cevap dondu.`);
  }

  const additions = [];
  for (const item of response.result) {
    const date = parseDate(item.tarih);
    if (existingDates.has(date)) continue;
    if (dateKey(date) <= latestDate) continue;

    const draw = normalizeApiItem(item, config, [...data, ...additions]);
    additions.push(draw);
    existingDates.add(date);
  }

  if (!additions.length) {
    console.log(`${config.label}: Yeni cekilis yok.`);
    return 0;
  }

  additions.sort((a, b) => dateKey(a[1]) - dateKey(b[1]));
  const nextData = [...data, ...additions];
  validateAll(nextData, config);

  if (dryRun) {
    console.log(`${config.label}: ${additions.length} yeni cekilis bulundu (dry-run).`);
    additions.forEach((draw) => console.log(JSON.stringify(draw)));
    return additions.length;
  }

  fs.writeFileSync(config.file, appendDraws(source, additions), 'utf8');
  console.log(`${config.label}: ${additions.length} yeni cekilis eklendi.`);
  additions.forEach((draw) => console.log(JSON.stringify(draw)));
  return additions.length;
}

async function main() {
  let total = 0;
  for (const gameKey of selectedGames()) {
    total += await updateGame(gameKey);
  }
  console.log(`Toplam yeni cekilis: ${total}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
