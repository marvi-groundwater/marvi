/**
 * Static site build: content/pages/*.json → _site/, one real document per
 * (page, language).
 *
 * index.html is the chrome template — head, CSS, sidebar, footer, lightbox.
 * Its authored panels and inline scripts are historical: panels were migrated
 * into the page files by scripts/migrate.mjs, and behaviour lives in
 * src/app.mjs. The build strips both and renders every panel from data via
 * src/templates.mjs, so there is exactly one rendering path.
 *
 * Languages: pages are rendered in English, captureEnglish() snapshots the
 * strings, then applyLanguage() rewrites the document once per language before
 * it is split into per-page files — the same slot/data-i18n mechanism the old
 * runtime used, run at build time. /hi/... pages therefore carry Hindi
 * metadata read back off the translated DOM.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { captureEnglish, applyLanguage } from '../src/hydrate.mjs';
import { renderPage, brandMark } from '../src/templates.mjs';
import { buildRegistry, urlFor } from '../src/registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const SITE_URL = 'https://' + readFileSync(join(ROOT, 'CNAME'), 'utf8').trim();

const template = readFileSync(join(ROOT, 'index.html'), 'utf8');
const probeStyles = parseHTML(template).document;
const i18n = JSON.parse(readFileSync(join(ROOT, 'content/i18n.json'), 'utf8'));
// Site-wide chrome (currently just the brand badge). Absent or half-filled is
// fine — every reader of it falls back rather than failing the build.
const SITE = existsSync(join(ROOT, 'content/site.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'))
  : {};

const PAGES = buildRegistry(ROOT);
const SECTION_IDS = PAGES.slice(1).map((p) => p.slug); // all but home, nav order
const href = (lang, page) => urlFor(lang, page, PAGES);
const pageById = new Map(PAGES.map((p) => [p.slug, p]));

/* ---------- chrome shell + rendered panels ---------- */

function composeDocument() {
  const { document } = parseHTML(template);

  // Drop the authored panels and every script: panels are rendered from data,
  // behaviour ships as /assets/app.mjs, and gallery.js / layout-model.js only
  // existed to serve the old inline runtime.
  document.querySelectorAll('[data-panel]').forEach((n) => n.remove());
  document.querySelectorAll('script').forEach((n) => n.remove());

  // Draw the brand badge from content/site.json.
  const mark = document.querySelector('.brand-mark');
  if (mark) {
    const { shape, svg } = brandMark(SITE.brand);
    mark.setAttribute('data-shape', shape);
    mark.innerHTML = svg;
  }

  // Rebuild the sidebar nav from the registry.
  const nav = document.querySelector('.side-nav');
  nav.textContent = '';
  PAGES.forEach((page, i) => {
    const tab = document.createElement('button'); // becomes a link per-page
    tab.className = 'nav-tab';
    tab.setAttribute('type', 'button');
    tab.setAttribute('data-tab', page.slug);
    const thumb = document.createElement('img');
    thumb.className = 'nav-thumb';
    thumb.setAttribute('alt', '');
    thumb.setAttribute('aria-hidden', 'true');
    const menuImage = page.menuImage || page.heroImage;
    if (menuImage?.image) thumb.setAttribute('src', menuImage.image);
    const number = document.createElement('span');
    number.className = 'nav-number';
    number.textContent = String(i + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'nav-name';
    name.textContent = page.menuName;
    const arrow = document.createElement('span');
    arrow.className = 'nav-arrow';
    arrow.textContent = '↗';
    tab.append(thumb, number, name, arrow);
    nav.appendChild(tab);
  });

  // Render every page's panel into <main id="content"> — the layout CSS
  // positions panels relative to that container, not <body>. All panels must
  // be present so captureEnglish/applyLanguage see every string once; the
  // per-page split keeps exactly one.
  const main = document.getElementById('content');
  PAGES.forEach((page, i) => {
    const section = renderPage(document, page, {
      index: i + 1,
      total: PAGES.length,
      urlFor: (id) => href('en', pageById.get(id) || PAGES[0])
    });
    section.setAttribute('hidden', '');
    main.appendChild(section);
  });

  // Behaviour module.
  const app = document.createElement('script');
  app.setAttribute('type', 'module');
  app.setAttribute('src', '/assets/app.mjs');
  document.body.appendChild(app);

  return document;
}

/* ---------- URL rewriting ---------- */

const isAbsolute = (v) => /^(https?:|data:|mailto:|tel:|#|\/\/|\/)/.test(v);

// Cover photos and card art live in url() inside the inline <style> — a
// relative one silently resolves against the page directory one level down.
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

  // Metadata reads off the *translated* document so /hi/ pages get Hindi.
  const pageName = (
    document.querySelector(`.nav-tab[data-tab="${page.slug}"] .nav-name`)?.textContent ||
    page.menuName
  ).trim();
  const isHome = page.slug === PAGES[0].slug;
  const descSel = isHome
    ? `#panel-${page.slug} .hero-copy .lede`
    : `#panel-${page.slug} .page-head .lede`;
  const description = document.querySelector(descSel)?.textContent.trim() || '';

  // 1. Keep only this page's panel.
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    if (panel.getAttribute('data-panel') === page.slug) {
      panel.removeAttribute('hidden');
      panel.removeAttribute('role');
    } else {
      panel.remove();
    }
  });

  // 2. Nav tabs become real links.
  const nav = document.querySelector('.side-nav');
  if (nav) {
    nav.removeAttribute('role');
    nav.removeAttribute('aria-orientation');
  }
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    const id = tab.getAttribute('data-tab');
    const target = pageById.get(id);
    const link = document.createElement('a');
    link.className = tab.className;
    link.setAttribute('data-tab', id);
    link.setAttribute('href', href(lang, target || PAGES[0]));
    if (id === page.slug) link.setAttribute('aria-current', 'page');
    link.innerHTML = tab.innerHTML;
    tab.replaceWith(link);
  });

  // 3. Any remaining [data-open] button (the sidebar brand) becomes a link;
  //    rendered blocks already emit real links with data-open kept as a hook.
  document.querySelectorAll('button[data-open]').forEach((btn) => {
    const target = pageById.get(btn.getAttribute('data-open'));
    if (!target) return;
    const link = document.createElement('a');
    link.className = btn.className;
    link.setAttribute('href', href(lang, target));
    if (btn.hasAttribute('aria-label')) link.setAttribute('aria-label', btn.getAttribute('aria-label'));
    link.innerHTML = btn.innerHTML;
    btn.replaceWith(link);
  });

  // 4. Language switcher: point page-relative so the choice stays on this page.
  const select = document.getElementById('lang-select');
  if (select) {
    select.setAttribute('data-lang-base', isHome ? '' : page.slug + '/');
    select.querySelectorAll('option').forEach((opt) => {
      if (opt.value === lang) opt.setAttribute('selected', 'selected');
      else opt.removeAttribute('selected');
    });
  }

  // 5. Head: title, description, canonical, alternates, social card.
  const head = document.querySelector('head');
  const title = isHome ? 'MARVI — Groundwater · India' : 'MARVI — ' + pageName;
  document.querySelector('title').textContent = title;

  const canonical = SITE_URL + href(lang, page);
  head.querySelectorAll('meta[name="description"]').forEach((n) => n.remove());
  const meta = (attr, key, value) => {
    if (!value) return;
    const tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    tag.setAttribute('content', value);
    head.appendChild(tag);
  };
  meta('name', 'description', description);
  const link = (rel, hrefValue, hreflang) => {
    const tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    tag.setAttribute('href', hrefValue);
    if (hreflang) tag.setAttribute('hreflang', hreflang);
    head.appendChild(tag);
  };
  link('canonical', canonical);
  LANGS.forEach((l) => link('alternate', SITE_URL + href(l, page), l));
  link('alternate', SITE_URL + href('en', page), 'x-default');

  const socialSrc = (page.menuImage || page.heroImage || {}).image;
  const social = socialSrc
    ? SITE_URL + (socialSrc.startsWith('/') ? socialSrc : '/' + socialSrc)
    : null;
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

  absolutise(document);
  return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
}

/* ---------- run ---------- */

const composed = composeDocument();
const LANGS = [...composed.querySelectorAll('#lang-select option')].map((o) => o.value);
const englishBase = captureEnglish(composed, SECTION_IDS);
const composedHTML = composed.documentElement.outerHTML;

const write = (relPath, body) => {
  const full = join(OUT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
};

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

let count = 0;
for (const lang of LANGS) {
  const { document } = parseHTML(composedHTML);
  const base = captureEnglish(document, SECTION_IDS);
  base.EN = englishBase.EN;
  base.EN_BODY = englishBase.EN_BODY;
  base.EN_ALT = englishBase.EN_ALT;
  applyLanguage(document, base, i18n, lang);
  const langHTML = document.documentElement.outerHTML;
  for (const page of PAGES) {
    const rel = href(lang, page).replace(/^\//, '');
    write(join(rel, 'index.html'), buildPage(langHTML, lang, page));
    count++;
  }
  if (lang === 'en') write('404.html', buildPage(langHTML, 'en', PAGES[0]));
}

/* ---------- static passthrough ---------- */

for (const dir of ['assets', 'content', 'admin']) {
  if (existsSync(join(ROOT, dir))) cpSync(join(ROOT, dir), join(OUT, dir), { recursive: true });
}
cpSync(join(ROOT, 'src/app.mjs'), join(OUT, 'assets/app.mjs'));
// The CMS preview renders entries with the very same renderer the site uses,
// so publish it as a module the admin page can import, plus the site's CSS
// lifted out of the template for the preview iframe to load.
cpSync(join(ROOT, 'src/templates.mjs'), join(OUT, 'assets/templates.mjs'));
write(
  'assets/site.css',
  absolutiseCss([...probeStyles.querySelectorAll('style')].map((n) => n.textContent).join('\n'))
);
cpSync(join(ROOT, 'CNAME'), join(OUT, 'CNAME'));

const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
  'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
  LANGS.flatMap((lang) =>
    PAGES.map(
      (page) =>
        '  <url>\n    <loc>' + SITE_URL + href(lang, page) + '</loc>\n' +
        LANGS.map(
          (l) => '    <xhtml:link rel="alternate" hreflang="' + l + '" href="' + SITE_URL + href(l, page) + '"/>\n'
        ).join('') +
        '  </url>'
    )
  ).join('\n') +
  '\n</urlset>\n';
write('sitemap.xml', sitemap);
write('robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: ' + SITE_URL + '/sitemap.xml\n');

console.log(`Built ${count} pages (${PAGES.length} pages × ${LANGS.length} languages) into _site/`);
