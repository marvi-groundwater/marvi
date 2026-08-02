/**
 * Post-build checks. Fails loudly rather than shipping a subtly broken site.
 * Asserts the things that break silently: missing metadata, panels leaking
 * across URLs, relative paths that only resolve at the root, missing files.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { buildRegistry, urlFor } from '../src/registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const SITE_URL = 'https://' + readFileSync(join(ROOT, 'CNAME'), 'utf8').trim();

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

const PAGES = buildRegistry(ROOT);
const template = parseHTML(readFileSync(join(ROOT, 'index.html'), 'utf8')).document;
const LANGS = [...template.querySelectorAll('#lang-select option')].map((o) => o.value);

let checked = 0;
for (const lang of LANGS) {
  for (const page of PAGES) {
    const rel = urlFor(lang, page, PAGES).replace(/^\//, '');
    const file = join(OUT, rel, 'index.html');
    const where = `${lang}/${page.slug}`;
    if (!existsSync(file)) { failures.push(`missing: ${where}`); continue; }
    const { document } = parseHTML(readFileSync(file, 'utf8'));
    checked++;

    // exactly one panel, the right one
    const panels = [...document.querySelectorAll('[data-panel]')];
    check(panels.length === 1, `${where}: expected 1 panel, found ${panels.length}`);
    check(panels[0]?.getAttribute('data-panel') === page.slug, `${where}: wrong panel emitted`);

    // metadata
    const title = document.querySelector('title')?.textContent || '';
    check(title.length > 5, `${where}: title missing`);
    const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    check(desc.length > 20, `${where}: description missing or too short`);
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
    check(canonical === SITE_URL + urlFor(lang, page, PAGES), `${where}: canonical "${canonical}"`);
    const alts = document.querySelectorAll('link[rel="alternate"]').length;
    check(alts === LANGS.length + 1, `${where}: ${alts} alternates, expected ${LANGS.length + 1}`);
    check(!!document.querySelector('meta[property="og:image"]'), `${where}: og:image missing`);
    check(document.documentElement.getAttribute('lang') === lang, `${where}: <html lang> wrong`);
    if (lang === 'ar') {
      check(document.querySelectorAll('[dir="rtl"]').length > 0, `${where}: no rtl marking`);
    }

    // no relative paths (they 404 one directory down)
    const bad = [...document.querySelectorAll('[src], link[href], a[href]')]
      .map((n) => n.getAttribute('src') || n.getAttribute('href'))
      .filter((v) => v && !/^(https?:|data:|mailto:|tel:|#|\/)/.test(v));
    check(bad.length === 0, `${where}: relative paths: ${bad.slice(0, 3).join(', ')}`);
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const badCss = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)]
      .map((m) => m[2]).filter((v) => !/^(https?:|data:|\/|#)/.test(v));
    check(badCss.length === 0, `${where}: relative CSS url(): ${badCss.slice(0, 2).join(', ')}`);

    // nav: every page linked, no fragments, current page marked
    const navLinks = [...document.querySelectorAll('.side-nav .nav-tab')];
    check(navLinks.length === PAGES.length, `${where}: nav has ${navLinks.length} links`);
    check(navLinks.every((a) => a.tagName === 'A' && !a.getAttribute('href')?.startsWith('#')),
      `${where}: nav not fully linkified`);
    check(!!document.querySelector('.nav-tab[aria-current="page"]'), `${where}: no aria-current`);

    // scripts: no inline leftovers, exactly one app module, files exist
    check(document.querySelectorAll('script:not([src])').length === 0,
      `${where}: inline script survived`);
    const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    check(scripts.length === 1 && scripts[0] === '/assets/app.mjs',
      `${where}: scripts are ${JSON.stringify(scripts)}`);
    scripts.forEach((ref) => {
      if (ref.startsWith('/')) check(existsSync(join(OUT, ref)), `${where}: missing ${ref}`);
    });

    // prerender must never bake a font-size (the invisible-headline class of bug)
    const baked = [...document.querySelectorAll('[data-cms-text-scale]')]
      .filter((n) => (n.getAttribute('style') || '').includes('font-size'));
    check(baked.length === 0, `${where}: prerendered font-size on ${baked.length} node(s)`);
  }
}

// sitemap + robots exist and agree with the registry
check(existsSync(join(OUT, 'sitemap.xml')), 'sitemap.xml missing');
check(existsSync(join(OUT, 'robots.txt')), 'robots.txt missing');
if (existsSync(join(OUT, 'sitemap.xml'))) {
  const locs = (readFileSync(join(OUT, 'sitemap.xml'), 'utf8').match(/<loc>/g) || []).length;
  check(locs === PAGES.length * LANGS.length, `sitemap lists ${locs} URLs, expected ${PAGES.length * LANGS.length}`);
}

if (failures.length) {
  console.error(`\nFAILED ${failures.length} check(s):`);
  failures.slice(0, 25).forEach((f) => console.error('  ✗ ' + f));
  if (failures.length > 25) console.error(`  … and ${failures.length - 25} more`);
  process.exit(1);
}
console.log(`All checks passed across ${checked} built pages.`);
