/**
 * Static site build.
 *
 * index.html is the template, not a served page: it holds every panel and the
 * authored fallback copy. This script bakes the CMS content in, translates the
 * document once per language, then emits one file per (language, page) with
 * only that page's panel in it — so each URL is a real, indexable document
 * rather than a fragment of a single-page app.
 *
 * Output: _site/            English      → /, /approach/, ...
 *         _site/<lang>/     everything else → /hi/, /hi/approach/, ...
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { hydrate, captureEnglish, applyLanguage } from '../src/hydrate.mjs';
import { renderPage, applyCover, isBuiltin } from '../src/templates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const SITE_URL = 'https://' + readFileSync(join(ROOT, 'CNAME'), 'utf8').trim();

const readJSON = (rel) => {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
  } catch {
    return null;
  }
};

/* ---------- inputs ---------- */

const content = {
  home: readJSON('content/homepage.json'),
  sections: readJSON('content/sections.json'),
  media: readJSON('content/media.json'),
  films: readJSON('content/films.json'),
  partners: readJSON('content/partners.json'),
  images: readJSON('content/images.json'),
  portraits: readJSON('content/portraits.json'),
  menu: readJSON('content/menu.json')
};
const i18n = readJSON('content/i18n.json') || {};
const template = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* ---------- page + language registry, read from the template ---------- */

const probe = parseHTML(template).document;

const LANGS = [...probe.querySelectorAll('#lang-select option')].map((o) => o.value);

// content/pages.json is the registry: it decides which pages exist, in what
// order, and whether each is a hand-authored section from index.html
// ("builtin") or one an editor created in the CMS. Falling back to the nav in
// the template keeps the build working if the file is ever missing.
const registry = readJSON('content/pages.json');
const registryPages =
  registry && Array.isArray(registry.pages) && registry.pages.length
    ? registry.pages
    : [...probe.querySelectorAll('.nav-tab')].map((tab) => ({
        id: tab.getAttribute('data-tab'),
        name: tab.querySelector('.nav-name').textContent.trim(),
        template: 'builtin'
      }));

const PAGES = registryPages
  .filter((p) => p && p.id && p.published !== false)
  .map((p) => ({ ...p, slug: p.id === 'home' ? '' : p.id + '/' }));

const SECTION_IDS = PAGES.filter((p) => p.id !== 'home').map((p) => p.id);

const urlFor = (lang, slug) => (lang === 'en' ? '/' + slug : '/' + lang + '/' + slug);

// Title and description are read back off the *translated* document rather
// than the English content files, so /hi/ pages get Hindi metadata. This is
// the whole point of translating before splitting into pages.
const nameIn = (document, page) => {
  const node = document.querySelector('.nav-tab[data-tab="' + page.id + '"] .nav-name');
  return (node ? node.textContent : page.name).trim();
};

const describeIn = (document, page) => {
  const sel =
    page.id === 'home' ? '#panel-home .hero-copy .lede' : '#panel-' + page.id + ' .page-head .lede';
  const node = document.querySelector(sel);
  return node ? node.textContent.trim() : '';
};

/**
 * Per-page social image. Builtin sections use the menu thumbnails the CMS
 * already manages; CMS-created pages fall back to their own cover photo, so a
 * new page still gets a proper card when shared.
 */
const imageFor = (page) => {
  const entry = content.menu?.[page.id];
  const src = (entry && (typeof entry === 'string' ? entry : entry.image)) || page.cover;
  if (!src) return null;
  return SITE_URL + (src.startsWith('/') ? src : '/' + src);
};

/* ---------- registry → document ---------- */

/**
 * Reshape the template to match content/pages.json: render any CMS-created
 * page, rebuild the nav in registry order, and renumber the section counters.
 *
 * Runs once, before English is captured, so new pages are picked up by the
 * translation pass like any other section.
 */
function applyRegistry(document) {
  const panels = document.querySelectorAll('[data-panel]');
  const lastPanel = panels[panels.length - 1];
  const byId = new Map([...panels].map((p) => [p.getAttribute('data-panel'), p]));

  // 1. Drop panels the registry no longer lists (unpublished or removed).
  const wanted = new Set(PAGES.map((p) => p.id));
  panels.forEach((panel) => {
    if (!wanted.has(panel.getAttribute('data-panel'))) panel.remove();
  });

  // 2. Render CMS pages that have no authored markup.
  PAGES.forEach((page, i) => {
    if (byId.has(page.id)) return;
    if (isBuiltin(page)) {
      console.warn(`warning: page "${page.id}" is marked builtin but has no panel in index.html`);
      return;
    }
    const section = renderPage(document, page, { index: i + 1, total: PAGES.length });
    applyCover(section, page);
    lastPanel.after(section);
    byId.set(page.id, section);
  });

  // 3. Rebuild the nav in registry order. Regenerating rather than reordering
  //    keeps the numbering, thumbnails and markup consistent for every entry,
  //    authored or created.
  const nav = document.querySelector('.side-nav');
  if (nav) {
    nav.textContent = '';
    PAGES.forEach((page, i) => {
      const tab = document.createElement('button');
      tab.className = 'nav-tab';
      tab.setAttribute('type', 'button');
      tab.setAttribute('data-tab', page.id);
      const thumb = document.createElement('img');
      thumb.className = 'nav-thumb';
      thumb.setAttribute('alt', '');
      thumb.setAttribute('aria-hidden', 'true');
      // menu.json wins for the builtin sections (hydrate fills those in
      // later); a CMS page falls back to its own cover so its mobile tile
      // is not blank.
      if (page.cover) thumb.setAttribute('src', page.cover);
      const number = document.createElement('span');
      number.className = 'nav-number';
      number.textContent = String(i + 1).padStart(2, '0');
      const name = document.createElement('span');
      name.className = 'nav-name';
      name.textContent = page.name || page.id;
      const arrow = document.createElement('span');
      arrow.className = 'nav-arrow';
      arrow.textContent = '↗';
      tab.append(thumb, number, name, arrow);
      nav.appendChild(tab);
    });
  }

  // 4. Renumber "03 / 10" counters — the total changes when pages are added.
  PAGES.forEach((page, i) => {
    const index = byId.get(page.id)?.querySelector('.section-index');
    if (index) {
      index.textContent =
        String(i + 1).padStart(2, '0') + ' / ' + String(PAGES.length).padStart(2, '0');
    }
  });

  return document;
}

/* ---------- URL rewriting ---------- */

// The template uses paths relative to the repo root, which only resolve at "/".
// Every emitted page lives one or two directories deep, so make them absolute.
const isAbsolute = (v) => /^(https?:|data:|mailto:|tel:|#|\/\/|\/)/.test(v);

// Cover photos and card art live in url() inside the inline <style>, not in
// attributes — miss these and every section header loses its background.
const absolutiseCss = (css) =>
  css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, quote, path) =>
    isAbsolute(path) ? whole : `url(${quote}/${path.replace(/^\.\//, '')}${quote})`
  );

const absolutise = (document) => {
  const fix = (node, attr) => {
    const v = node.getAttribute(attr);
    if (!v || isAbsolute(v)) return;
    node.setAttribute(attr, '/' + v.replace(/^\.\//, ''));
  };
  document.querySelectorAll('[src]').forEach((n) => fix(n, 'src'));
  document.querySelectorAll('link[href]').forEach((n) => fix(n, 'href'));
  document.querySelectorAll('a[href]').forEach((n) => fix(n, 'href'));
  document.querySelectorAll('style').forEach((n) => {
    n.textContent = absolutiseCss(n.textContent);
  });
  document.querySelectorAll('[style]').forEach((n) => {
    const v = n.getAttribute('style');
    if (v && v.includes('url(')) n.setAttribute('style', absolutiseCss(v));
  });
};

/* ---------- per-page document surgery ---------- */

function buildPage(langDoc, lang, page) {
  // Re-parse per page: each one mutates the DOM destructively.
  const { document } = parseHTML(langDoc);

  // Read the translated copy before the panels and nav are rewritten.
  const pageName = nameIn(document, page);
  const description = describeIn(document, page);

  // 1. Keep only this page's panel.
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    if (panel.getAttribute('data-panel') === page.id) panel.removeAttribute('hidden');
    else panel.remove();
  });

  // 2. Nav tabs become real links. They were role="tab" buttons driving an
  //    in-page swap; now each one is a separate document.
  const nav = document.querySelector('.side-nav');
  if (nav) {
    nav.removeAttribute('role');
    nav.removeAttribute('aria-orientation');
  }
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    const id = tab.getAttribute('data-tab');
    const target = PAGES.find((p) => p.id === id);
    const link = document.createElement('a');
    link.className = tab.className;
    link.setAttribute('data-tab', id);
    link.setAttribute('href', urlFor(lang, target ? target.slug : ''));
    if (id === page.id) link.setAttribute('aria-current', 'page');
    link.innerHTML = tab.innerHTML;
    tab.replaceWith(link);
  });

  // 3. Hero CTAs ([data-open]) likewise.
  document.querySelectorAll('[data-open]').forEach((btn) => {
    const id = btn.getAttribute('data-open');
    const target = PAGES.find((p) => p.id === id);
    if (!target) return;
    const link = document.createElement('a');
    link.className = btn.className;
    link.setAttribute('href', urlFor(lang, target.slug));
    link.innerHTML = btn.innerHTML;
    btn.replaceWith(link);
  });

  // 4. Language switcher: remember where we are so the choice lands on the
  //    same page in the new language.
  const select = document.getElementById('lang-select');
  if (select) {
    select.setAttribute('data-lang-base', page.slug);
    select.querySelectorAll('option').forEach((opt) => {
      if (opt.value === lang) opt.setAttribute('selected', 'selected');
      else opt.removeAttribute('selected');
    });
  }

  // 5. Head: title, description, canonical, alternates, social card.
  const head = document.querySelector('head');
  const title = page.id === 'home' ? 'MARVI — Groundwater · India' : 'MARVI — ' + pageName;
  document.querySelector('title').textContent = title;

  const meta = (attr, key, value) => {
    if (!value) return;
    const tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    tag.setAttribute('content', value);
    head.appendChild(tag);
  };
  const canonical = SITE_URL + urlFor(lang, page.slug);

  head.querySelectorAll('meta[name="description"]').forEach((n) => n.remove());
  meta('name', 'description', description);

  const link = (rel, href, hreflang) => {
    const tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    tag.setAttribute('href', href);
    if (hreflang) tag.setAttribute('hreflang', hreflang);
    head.appendChild(tag);
  };
  link('canonical', canonical);
  LANGS.forEach((l) => link('alternate', SITE_URL + urlFor(l, page.slug), l));
  link('alternate', SITE_URL + urlFor('en', page.slug), 'x-default');

  meta('property', 'og:type', 'website');
  meta('property', 'og:site_name', 'MARVI');
  meta('property', 'og:title', title);
  meta('property', 'og:description', description);
  meta('property', 'og:url', canonical);
  meta('property', 'og:locale', lang);
  meta('property', 'og:image', imageFor(page));
  meta('name', 'twitter:card', 'summary_large_image');
  meta('name', 'twitter:title', title);
  meta('name', 'twitter:description', description);
  meta('name', 'twitter:image', imageFor(page));

  // 6. Point the behaviour module at its built location. Any inline script is
  //    a leftover from the old single-page version and is dropped: content and
  //    routing are resolved at build time now.
  document.querySelectorAll('script:not([src])').forEach((s) => s.remove());
  const appScript = document.querySelector('script[src$="app.mjs"]');
  if (appScript) appScript.setAttribute('src', '/assets/app.mjs');

  absolutise(document);
  return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
}

/* ---------- run ---------- */

const write = (relPath, body) => {
  const full = join(OUT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
};

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

// Hydrate once, capture English once — English is read live off the hydrated
// DOM so it always matches the current CMS content.
const base = parseHTML(template).document;
applyRegistry(base);
hydrate(base, content);
const englishBase = captureEnglish(base, SECTION_IDS);

let count = 0;
for (const lang of LANGS) {
  const { document } = parseHTML(base.documentElement.outerHTML);
  const localBase = captureEnglish(document, SECTION_IDS);
  // Reuse the English snapshot taken before any translation was applied.
  localBase.EN = englishBase.EN;
  localBase.EN_BODY = englishBase.EN_BODY;
  applyLanguage(document, localBase, i18n, lang);
  const langHTML = document.documentElement.outerHTML;

  for (const page of PAGES) {
    const dir = lang === 'en' ? page.slug : lang + '/' + page.slug;
    write(join(dir, 'index.html'), buildPage(langHTML, lang, page));
    count++;
  }
}

/* ---------- static passthrough ---------- */

for (const dir of ['assets', 'content', 'admin']) {
  if (existsSync(join(ROOT, dir))) cpSync(join(ROOT, dir), join(OUT, dir), { recursive: true });
}
cpSync(join(ROOT, 'src/app.mjs'), join(OUT, 'assets/app.mjs'));
cpSync(join(ROOT, 'CNAME'), join(OUT, 'CNAME'));

// Tell crawlers what exists.
const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
  'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
  LANGS.flatMap((lang) =>
    PAGES.map(
      (page) =>
        '  <url>\n    <loc>' +
        SITE_URL +
        urlFor(lang, page.slug) +
        '</loc>\n' +
        LANGS.map(
          (l) =>
            '    <xhtml:link rel="alternate" hreflang="' +
            l +
            '" href="' +
            SITE_URL +
            urlFor(l, page.slug) +
            '"/>\n'
        ).join('') +
        '  </url>'
    )
  ).join('\n') +
  '\n</urlset>\n';
write('sitemap.xml', sitemap);

// GitHub Pages serves 404.html for unknown paths. Reuse the English home page
// so a mistyped URL still shows the site rather than a bare error.
write('404.html', buildPage(parseHTML(base.documentElement.outerHTML).document.documentElement.outerHTML, 'en', PAGES[0]));
write('robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: ' + SITE_URL + '/sitemap.xml\n');

console.log(
  `Built ${count} pages (${PAGES.length} pages × ${LANGS.length} languages) into _site/`
);
