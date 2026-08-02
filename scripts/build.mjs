/**
 * Static site build.
 *
 * index.html is the template, not a served page. The site already knows how to
 * hydrate itself from content/pages/*.json and translate itself from
 * content/i18n.json, so this does not reimplement any of that: it runs the
 * page's own scripts once per language (see prerender.mjs), then splits each
 * rendered document into one file per page, keeping only that page's panel.
 *
 * The result is a real, indexable document per (page, language) — with its own
 * title, description, canonical, hreflang set and social card — instead of one
 * URL serving everything behind #fragments.
 *
 * Output: _site/            English         → /, /approach/, ...
 *         _site/<lang>/     everything else → /hi/, /hi/approach/, ...
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { renderLanguage } from './prerender.mjs';
import { renderPage, applyCover } from '../src/templates.mjs';
import { buildRegistry } from '../src/registry.mjs';

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

const template = readFileSync(join(ROOT, 'index.html'), 'utf8');
const probe = parseHTML(template).document;

const LANGS = [...probe.querySelectorAll('#lang-select option')].map((o) => o.value);

/* ---------- page registry ---------- */

const PAGES = buildRegistry(ROOT, probe, template);
const PAGE_KEYS = PAGES.map((p) => p.id);

const urlFor = (lang, slug) => (lang === 'en' ? '/' + slug : '/' + lang + '/' + slug);

/* ---------- template preparation ---------- */

/**
 * Add panels and nav entries for pages that have no authored markup, then hand
 * the HTML to the prerenderer. Doing this in the source (rather than the live
 * DOM) means the page's own hydration and translation see these panels like
 * any other section.
 */
function prepareTemplate() {
  const { document } = parseHTML(template);

  const panels = [...document.querySelectorAll('[data-panel]')];
  const last = panels[panels.length - 1];
  panels.forEach((panel) => {
    if (!PAGE_KEYS.includes(panel.getAttribute('data-panel'))) panel.remove();
  });

  PAGES.forEach((page, i) => {
    if (page.authored) return;
    const section = renderPage(document, page, { index: i + 1, total: PAGES.length });
    applyCover(section, page);
    section.setAttribute('hidden', '');
    last.after(section);
  });

  // Rebuild the nav so created pages appear and numbering stays contiguous.
  const nav = document.querySelector('.side-nav');
  if (nav) {
    const existing = new Map(
      [...nav.querySelectorAll('.nav-tab')].map((t) => [t.getAttribute('data-tab'), t])
    );
    nav.textContent = '';
    PAGES.forEach((page, i) => {
      let tab = existing.get(page.id);
      if (!tab) {
        tab = document.createElement('button');
        tab.className = 'nav-tab';
        tab.setAttribute('type', 'button');
        tab.setAttribute('data-tab', page.id);
        const thumb = document.createElement('img');
        thumb.className = 'nav-thumb';
        thumb.setAttribute('alt', '');
        thumb.setAttribute('aria-hidden', 'true');
        if (page.cover) thumb.setAttribute('src', page.cover);
        const number = document.createElement('span');
        number.className = 'nav-number';
        const name = document.createElement('span');
        name.className = 'nav-name';
        name.textContent = page.name;
        const arrow = document.createElement('span');
        arrow.className = 'nav-arrow';
        arrow.textContent = '↗';
        tab.append(thumb, number, name, arrow);
      }
      const number = tab.querySelector('.nav-number');
      if (number) number.textContent = String(i + 1).padStart(2, '0');
      nav.appendChild(tab);
    });
  }

  // jsdom is told not to fetch subresources (a build should never depend on
  // the network), so local scripts the page needs — layout-model.js, the
  // bundled gallery data — are inlined here in place, preserving load order.
  document.querySelectorAll('script[src]').forEach((tag) => {
    const src = tag.getAttribute('src').replace(/^\.?\//, '').split('?')[0];
    const file = join(ROOT, src);
    if (!existsSync(file)) return;
    const inline = document.createElement('script');
    inline.setAttribute('data-inlined-from', src);
    inline.textContent = readFileSync(file, 'utf8');
    tag.replaceWith(inline);
  });

  return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
}

/* ---------- per-page metadata ---------- */

// Read back off the *translated* document, so /hi/ pages get Hindi metadata.
const nameIn = (document, page) =>
  (document.querySelector(`.nav-tab[data-tab="${page.id}"] .nav-name`)?.textContent || page.name).trim();

const describeIn = (document, page) => {
  const sel =
    page.id === 'home' ? '#panel-home .hero-copy .lede' : `#panel-${page.id} .page-head .lede`;
  return document.querySelector(sel)?.textContent.trim() || '';
};

const imageFor = (page) => {
  const src = page.data.menuImage?.image || page.data.heroImage?.image;
  if (!src) return null;
  return SITE_URL + (src.startsWith('/') ? src : '/' + src);
};

/* ---------- URL rewriting ---------- */

const isAbsolute = (v) => /^(https?:|data:|mailto:|tel:|#|\/\/|\/)/.test(v);

// Cover photos and card art live in url() inside the inline <style>, not in
// attributes — miss these and every section header loses its background one
// directory down.
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

function buildPage(langHTML, lang, page) {
  const { document } = parseHTML(langHTML);

  const pageName = nameIn(document, page);
  const description = describeIn(document, page);

  // 1. Keep only this page's panel, so each URL is its own document rather
  //    than a near-duplicate of every other one.
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    if (panel.getAttribute('data-panel') === page.id) panel.removeAttribute('hidden');
    else panel.remove();
  });

  // 2. Nav tabs become real links.
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

  // 3. Hero CTAs and the brand mark likewise.
  document.querySelectorAll('[data-open]').forEach((btn) => {
    const target = PAGES.find((p) => p.id === btn.getAttribute('data-open'));
    if (!target) return;
    const link = document.createElement('a');
    link.className = btn.className;
    link.setAttribute('href', urlFor(lang, target.slug));
    link.innerHTML = btn.innerHTML;
    btn.replaceWith(link);
  });

  // 4. Language switcher navigates to the same page in the new language.
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

  const social = imageFor(page);
  meta('property', 'og:type', 'website');
  meta('property', 'og:site_name', 'MARVI');
  meta('property', 'og:title', title);
  meta('property', 'og:description', description);
  meta('property', 'og:url', canonical);
  meta('property', 'og:locale', lang);
  meta('property', 'og:image', social);
  meta('name', 'twitter:card', 'summary_large_image');
  meta('name', 'twitter:title', title);
  meta('name', 'twitter:description', description);
  meta('name', 'twitter:image', social);

  // 6. Drop the inline scripts: routing and content are resolved already, and
  //    re-running hydration in the browser would refetch every JSON file only
  //    to reproduce what is now baked in. layout-model.js goes with them —
  //    it exists to serve that hydration.
  document.querySelectorAll('script:not([src])').forEach((s) => s.remove());
  document.querySelectorAll('script[src$="layout-model.js"]').forEach((s) => s.remove());
  const appScript = document.createElement('script');
  appScript.setAttribute('type', 'module');
  appScript.setAttribute('src', '/assets/app.mjs');
  document.body.appendChild(appScript);

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

const prepared = prepareTemplate();

let count = 0;
for (const lang of LANGS) {
  const langHTML = await renderLanguage({ root: ROOT, html: prepared, lang, pageKeys: PAGE_KEYS });
  for (const page of PAGES) {
    const dir = lang === 'en' ? page.slug : lang + '/' + page.slug;
    write(join(dir, 'index.html'), buildPage(langHTML, lang, page));
    count++;
  }
  if (lang === 'en') write('404.html', buildPage(langHTML, 'en', PAGES[0]));
}

/* ---------- static passthrough ---------- */

for (const dir of ['assets', 'content', 'admin']) {
  if (existsSync(join(ROOT, dir))) cpSync(join(ROOT, dir), join(OUT, dir), { recursive: true });
}
cpSync(join(ROOT, 'src/app.mjs'), join(OUT, 'assets/app.mjs'));
cpSync(join(ROOT, 'CNAME'), join(OUT, 'CNAME'));

const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
  'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
  LANGS.flatMap((lang) =>
    PAGES.map(
      (page) =>
        '  <url>\n    <loc>' + SITE_URL + urlFor(lang, page.slug) + '</loc>\n' +
        LANGS.map(
          (l) =>
            '    <xhtml:link rel="alternate" hreflang="' + l + '" href="' +
            SITE_URL + urlFor(l, page.slug) + '"/>\n'
        ).join('') +
        '  </url>'
    )
  ).join('\n') +
  '\n</urlset>\n';
write('sitemap.xml', sitemap);
write('robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: ' + SITE_URL + '/sitemap.xml\n');

console.log(`Built ${count} pages (${PAGES.length} pages × ${LANGS.length} languages) into _site/`);
