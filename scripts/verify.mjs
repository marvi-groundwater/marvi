/**
 * Post-build checks. Fails loudly rather than shipping a subtly broken site.
 *
 * These assert the things that are easy to break silently and expensive to
 * notice later: missing metadata, untranslated pages, panels leaking across
 * URLs, and relative paths that only resolve at the site root.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { renderPage, translatableStrings, isBuiltin } from '../src/templates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

const probe = parseHTML(readFileSync(join(ROOT, 'index.html'), 'utf8')).document;
const LANGS = [...probe.querySelectorAll('#lang-select option')].map((o) => o.value);

// Same source of truth as the build: the registry decides what should exist.
const readJSON = (rel) => {
  try { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')); } catch { return null; }
};
const registry = readJSON('content/pages.json');
const PAGES = (registry?.pages?.length
  ? registry.pages
  : [...probe.querySelectorAll('.nav-tab')].map((t) => ({ id: t.getAttribute('data-tab') }))
)
  .filter((p) => p && p.id && p.published !== false)
  .map((p) => p.id);

const pathFor = (lang, id) => {
  const slug = id === 'home' ? '' : id + '/';
  return join(OUT, lang === 'en' ? slug : join(lang, slug), 'index.html');
};

/* ---------- CMS pages: renderer and translator must agree on keys ---------- */
// These are two independent code paths over the same data — the renderer tags
// elements, the translator enumerates strings. If they drift, a page silently
// stops being translatable, which nothing else here would catch.
for (const page of registry?.pages || []) {
  if (!page || !page.id || isBuiltin(page)) continue;
  const { document } = parseHTML('<!doctype html><body></body>');
  const section = renderPage(document, page, { index: 1, total: 1 });
  const rendered = new Set(
    [...section.querySelectorAll('[data-i18n], [data-i18n-alt]')].map(
      (n) => n.getAttribute('data-i18n') || n.getAttribute('data-i18n-alt')
    )
  );
  const declared = translatableStrings(page)
    .map((s) => s.key)
    .filter((k) => k.startsWith('page.'));
  declared.forEach((k) =>
    check(rendered.has(k), `page "${page.id}": translator declares ${k}, renderer never emits it`)
  );
  rendered.forEach((k) =>
    check(declared.includes(k), `page "${page.id}": renderer emits ${k}, translator misses it`)
  );
}

let checked = 0;
const untranslated = [];

for (const lang of LANGS) {
  for (const id of PAGES) {
    const file = pathFor(lang, id);
    if (!existsSync(file)) { failures.push(`missing: ${lang}/${id}`); continue; }
    const { document } = parseHTML(readFileSync(file, 'utf8'));
    const where = `${lang}/${id}`;
    checked++;

    // exactly one panel, and it is the right one
    const panels = [...document.querySelectorAll('[data-panel]')];
    check(panels.length === 1, `${where}: expected 1 panel, found ${panels.length}`);
    check(panels[0]?.getAttribute('data-panel') === id, `${where}: wrong panel emitted`);

    // metadata
    const title = document.querySelector('title')?.textContent || '';
    check(title.length > 5, `${where}: title missing`);
    const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    check(desc.length > 20, `${where}: description missing or too short`);
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
    const expected = 'https://testpage.marvi.org.in' + (lang === 'en' ? '/' : '/' + lang + '/') +
      (id === 'home' ? '' : id + '/');
    check(canonical === expected, `${where}: canonical is "${canonical}", expected "${expected}"`);

    // one alternate per language, plus x-default
    const alts = [...document.querySelectorAll('link[rel="alternate"]')];
    check(alts.length === LANGS.length + 1, `${where}: ${alts.length} alternates, expected ${LANGS.length + 1}`);

    // social card
    check(!!document.querySelector('meta[property="og:image"]'), `${where}: og:image missing`);
    check(document.querySelector('meta[property="og:locale"]')?.getAttribute('content') === lang,
      `${where}: og:locale wrong`);

    // language is actually applied
    check(document.documentElement.getAttribute('lang') === lang, `${where}: <html lang> wrong`);
    if (lang === 'ar') {
      check(document.documentElement.getAttribute('dir') === 'rtl', `${where}: missing dir=rtl`);
    }

    // no relative asset paths (they would 404 from a nested URL)
    const bad = [...document.querySelectorAll('[src], link[href], a[href]')]
      .map((n) => n.getAttribute('src') || n.getAttribute('href'))
      .filter((v) => v && !/^(https?:|data:|mailto:|tel:|#|\/)/.test(v));
    check(bad.length === 0, `${where}: relative paths would 404: ${bad.slice(0, 3).join(', ')}`);

    // CSS url() must be absolute too — cover photos live there, and a
    // relative one silently resolves against the nested page directory.
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const badCss = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)]
      .map((m) => m[2])
      .filter((v) => !/^(https?:|data:|\/|#)/.test(v));
    check(badCss.length === 0, `${where}: relative CSS url(): ${badCss.slice(0, 2).join(', ')}`);

    // nav points at real URLs, not fragments
    const navHrefs = [...document.querySelectorAll('.nav-tab')].map((a) => a.getAttribute('href'));
    check(navHrefs.length === PAGES.length, `${where}: nav has ${navHrefs.length} links`);
    check(navHrefs.every((h) => h && !h.startsWith('#')), `${where}: nav still uses fragments`);

    // no leftover inline scripts (the SPA router / content loader)
    check([...document.querySelectorAll('script:not([src])')].length === 0,
      `${where}: inline script survived the build`);

    // exactly one behaviour module, pointing at its built location
    const appScripts = [...document.querySelectorAll('script[src$="app.mjs"]')]
      .map((s) => s.getAttribute('src'));
    check(appScripts.length === 1, `${where}: ${appScripts.length} app.mjs scripts, expected 1`);
    check(appScripts[0] === '/assets/app.mjs', `${where}: app.mjs src is "${appScripts[0]}"`);

    // every script/style/image the page references must exist in the output
    [...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')].forEach((n) => {
      const ref = n.getAttribute('src') || n.getAttribute('href');
      if (!ref || !ref.startsWith('/')) return;
      check(existsSync(join(OUT, ref)), `${where}: references missing file ${ref}`);
    });

    // translated pages should not be byte-identical to English
    if (lang !== 'en' && title === (document.querySelector('title')?.textContent || '')) {
      const enFile = pathFor('en', id);
      if (existsSync(enFile)) {
        const enTitle = parseHTML(readFileSync(enFile, 'utf8')).document.querySelector('title')?.textContent;
        if (enTitle === title && id !== 'home') untranslated.push(where);
      }
    }
  }
}

if (untranslated.length) {
  console.warn(`note: ${untranslated.length} page(s) have an untranslated title (missing i18n key): ${untranslated.slice(0, 5).join(', ')}`);
}

if (failures.length) {
  console.error(`\nFAILED ${failures.length} check(s):`);
  failures.slice(0, 25).forEach((f) => console.error('  ✗ ' + f));
  if (failures.length > 25) console.error(`  … and ${failures.length - 25} more`);
  process.exit(1);
}
console.log(`All checks passed across ${checked} built pages.`);
