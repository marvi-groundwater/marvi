#!/usr/bin/env node
/**
 * Auto-translate missing / changed site strings via GitHub Models (free AI).
 *
 * Runs in CI (see .github/workflows/translate.yml). It:
 *  1. Gathers the English source for every translatable key
 *     (nav + hero + section intros from the CMS content files and index.html,
 *      plus the body prose tagged with data-i18n in index.html).
 *  2. Compares against the hidden `en` block stored in content/i18n.json —
 *     the English each existing translation was made from.
 *  3. For any key that is NEW or whose English CHANGED, or that is missing in a
 *     language, asks GitHub Models to translate it into all target languages.
 *  4. Writes the results (and refreshes the `en` block) back to content/i18n.json.
 *
 * No-op (exit 0, no file change) when nothing needs translating.
 * Fails soft: if the model can't be reached, the site keeps its existing
 * translations — English is always the runtime fallback.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const I18N_PATH = ROOT + 'content/i18n.json';

const TARGET_LANGS = ['es', 'hi', 'lo', 'zh-Hant', 'th', 'jv', 'zh-Hans', 'ar', 'pt', 'fr', 'bn', 'ru', 'id'];
const LANG_NAMES = {
  es: 'Spanish', hi: 'Hindi', lo: 'Lao (Lao script only)', 'zh-Hant': 'Traditional Chinese',
  th: 'Thai', jv: 'Javanese (romanized Basa Jawa, Latin script)', 'zh-Hans': 'Simplified Chinese',
  ar: 'Arabic (Modern Standard)', pt: 'Portuguese', fr: 'French', bn: 'Bengali', ru: 'Russian',
  id: 'Indonesian'
};

// GitHub Models — overridable via env if the endpoint/model naming changes.
const MODEL = process.env.MODELS_MODEL || 'openai/gpt-4o-mini';
const ENDPOINT = process.env.MODELS_ENDPOINT || 'https://models.github.ai/inference/chat/completions';
const TOKEN = process.env.GITHUB_TOKEN || process.env.MODELS_TOKEN;

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// ---- 1. gather the English source for every key ----
function collectEnglish() {
  const en = {};
  const home = JSON.parse(readFileSync(ROOT + 'content/homepage.json', 'utf8'));
  const sections = JSON.parse(readFileSync(ROOT + 'content/sections.json', 'utf8'));
  let html = readFileSync(ROOT + 'index.html', 'utf8');
  const body = html.slice(0, html.indexOf('<!-- Load editable content'));

  // hero (from the CMS homepage file)
  en['hero.eyebrow'] = home.eyebrow;
  en['hero.title'] = home.heroTitle;
  en['hero.body'] = home.heroBody;
  en['hero.btn1'] = home.primaryButtonLabel;
  en['hero.btn2'] = home.secondaryButtonLabel;

  // section intros (from the CMS sections file)
  for (const [k, v] of Object.entries(sections)) {
    en[`sec.${k}.eyebrow`] = v.eyebrow;
    en[`sec.${k}.title`] = v.title;
    en[`sec.${k}.lede`] = v.lede;
  }

  // ui.explore label
  const navLabel = body.match(/<p class="nav-label">([^<]+)<\/p>/);
  if (navLabel) en['ui.explore'] = decode(navLabel[1].trim());

  // nav tab names
  const navRe = /<button class="nav-tab"[^>]*data-tab="([^"]+)"[^>]*>[\s\S]*?<span class="nav-name">([^<]+)<\/span>/g;
  let m;
  while ((m = navRe.exec(body))) en[`nav.${m[1]}`] = decode(m[2].trim());

  // body prose tagged with data-i18n
  const bodyRe = /data-i18n="([^"]+)"[^>]*>([^<]+)</g;
  while ((m = bodyRe.exec(body))) en[m[1]] = decode(m[2].trim());

  return en;
}

// ---- 2. call GitHub Models to translate a batch ----
async function translateBatch(entries) {
  // entries: [{ key, english }]
  const strings = Object.fromEntries(entries.map((e) => [e.key, e.english]));
  const sys =
    'You are a professional translator for a non-profit groundwater project (MARVI, India/Australia). ' +
    'Translate short website UI strings accurately, naturally and concisely, in the correct script for each language. ' +
    'Keep these proper nouns UNCHANGED in every language: MARVI, MyWell, Bhujal Jankaars, YINMIK; keep place names ' +
    '(Rajasthan, Gujarat, Dharta, Meghraj) and all numbers/units unchanged. Preserve any leading "01 · " numbering. ' +
    'Return ONLY strict JSON, no prose.';
  const user =
    `Translate each of these strings into these languages: ${TARGET_LANGS.map((l) => `${l} (${LANG_NAMES[l]})`).join(', ')}.\n` +
    `Return a JSON object mapping each key to an object of { "<langCode>": "<translation>" } for all ${TARGET_LANGS.length} languages.\n\n` +
    `Strings (key -> English):\n${JSON.stringify(strings, null, 2)}`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
    })
  });
  if (!res.ok) throw new Error(`Models API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---- 3. main ----
(async () => {
  const en = collectEnglish();
  const i18n = JSON.parse(readFileSync(I18N_PATH, 'utf8'));

  // One-time: record the current English as the baseline WITHOUT translating,
  // so existing (hand-reviewed) translations are kept and only future edits act.
  if (process.argv.includes('--seed')) {
    i18n.en = en;
    writeFileSync(I18N_PATH, JSON.stringify(i18n, null, 2) + '\n');
    console.log(`Seeded en baseline with ${Object.keys(en).length} keys.`);
    process.exit(0);
  }

  const prevEn = i18n.en || {}; // English each existing translation was made from

  // which keys need (re)translation?
  const todo = [];
  for (const [key, english] of Object.entries(en)) {
    if (!english) continue;
    const changed = prevEn[key] !== english;
    const missing = TARGET_LANGS.some((l) => !i18n[l] || i18n[l][key] == null);
    if (changed || missing) todo.push({ key, english });
  }

  if (!todo.length) {
    console.log('Nothing to translate — all strings up to date.');
    process.exit(0);
  }
  console.log(`Translating ${todo.length} changed/missing string(s) via ${MODEL}...`);
  if (!TOKEN) {
    console.error('No GITHUB_TOKEN/MODELS_TOKEN available — cannot call GitHub Models. Leaving translations unchanged.');
    process.exit(0);
  }

  for (const batch of chunk(todo, 12)) {
    const out = await translateBatch(batch);
    for (const { key } of batch) {
      const row = out[key];
      if (!row) { console.warn(`  no result for ${key}`); continue; }
      for (const l of TARGET_LANGS) {
        if (row[l] != null) { (i18n[l] ||= {})[key] = row[l]; }
      }
    }
  }

  // refresh the source-of-truth English block
  i18n.en = en;
  writeFileSync(I18N_PATH, JSON.stringify(i18n, null, 2) + '\n');
  console.log(`Updated content/i18n.json (${todo.length} strings across ${TARGET_LANGS.length} languages).`);
})().catch((err) => {
  console.error('Auto-translate failed (site keeps existing translations):', err.message);
  process.exit(1);
});
