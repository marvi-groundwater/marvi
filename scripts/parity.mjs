/**
 * Migration parity check: nothing the old site showed may be missing from the
 * new one.
 *
 * Old = the authored panels still present in index.html (the migration's
 * input) plus the item lists in the pre-migration page JSON (read from git).
 * New = the built English pages in _site/.
 *
 * For every old visible text string and every old image, assert it appears on
 * the corresponding built page. One-directional on purpose: the build may add
 * things (filter buttons, counts), it may not lose things.
 */

import { readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { parseHTML } from 'linkedom';
import { buildRegistry, urlFor } from '../src/registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = buildRegistry(ROOT);

const template = parseHTML(readFileSync(join(ROOT, 'index.html'), 'utf8')).document;

const norm = (s) => s.replace(/\s+/g, ' ').trim();
// Whitespace-free comparison: <br> contributes no space to textContent, so
// "a.\nb" vs "a.b" must still match.
const squash = (s) => String(s || '').replace(/\s+/g, '');
const failures = [];

// Regions whose authored fallback the OLD runtime replaced from JSON — their
// authored text was never visible, so it is exempt from the text walk. The
// JSON strings themselves are asserted separately below.
const REPLACED = '.page-head, .hero-copy, .media-grid, .video-grid, .pub-grid, .tool-grid, ' +
  '.people-grid, .portrait-band, .gallery-grid, .archive-tools, .filter-bar, .cms-sections';

for (const page of PAGES) {
  const panel = template.querySelector(`[data-panel="${page.slug}"]`);
  if (!panel) continue; // pages created after the migration have no authored panel

  const rel = urlFor('en', page, PAGES).replace(/^\//, '');
  const built = parseHTML(readFileSync(join(ROOT, '_site', rel, 'index.html'), 'utf8')).document;
  const builtText = squash(built.body.textContent);
  const builtAttrs = squash(
    [...built.querySelectorAll('[alt], [aria-label], [data-title]')]
      .map((n) => (n.getAttribute('alt') || '') + '\n' + (n.getAttribute('aria-label') || '') + '\n' + (n.getAttribute('data-title') || ''))
      .join('\n')
  );
  const appears = (text) => {
    const q = squash(text);
    return !q || builtText.includes(q) || builtAttrs.includes(q);
  };
  const builtImages = new Set(
    [...built.querySelectorAll('img')].map((i) => basename(i.getAttribute('src') || ''))
  );
  const builtHrefs = new Set(
    [...built.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
  );

  // 1. Every visible text node in the authored panel appears in the built page.
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const text = norm(child.textContent);
        if (text.length > 2 && !appears(text)) {
          failures.push(`${page.slug}: text lost: "${text.slice(0, 70)}"`);
        }
      } else if (
        child.nodeType === 1 &&
        !['SCRIPT', 'STYLE', 'INPUT'].includes(child.tagName) &&
        !(child.matches && child.matches(REPLACED))
      ) {
        walk(child);
      }
    }
  };
  walk(panel);

  // 2. Every authored image appears — except data-img slots, whose src the
  //    old runtime replaced from JSON (the JSON images are asserted below).
  [...panel.querySelectorAll('img:not([data-img])')].forEach((img) => {
    const name = basename(img.getAttribute('src') || '');
    if (name && !builtImages.has(name)) failures.push(`${page.slug}: image lost: ${name}`);
  });

  // 3. Every item in the pre-migration JSON is represented (titles + links).
  let v1 = null;
  try {
    v1 = JSON.parse(
      execSync(`git show origin/main:content/pages/${page.slug}.json`, { cwd: ROOT, encoding: 'utf8' })
    );
  } catch { /* no v1 — created page */ }
  if (v1) {
    // What the old runtime actually showed: intro strings…
    ['eyebrow', 'title', 'lede'].forEach((f) => {
      const value = v1.intro?.[f];
      if (value && !appears(value)) failures.push(`${page.slug}: intro.${f} lost`);
    });
    // …the slot photos…
    Object.values(v1.images || {}).forEach((entry) => {
      const name = basename(entry?.image || '');
      if (name && !builtImages.has(name)) failures.push(`${page.slug}: slot image lost: ${name}`);
    });
    // …and every list item.
    const items = [
      ...(v1.items || []),
      ...(v1.partners || []),
      ...(v1.portraits || [])
    ];
    items.forEach((item) => {
      const label = item.title || item.name;
      if (label && !appears(label)) {
        failures.push(`${page.slug}: item lost: "${label}"`);
      }
      const photoName = basename(item.photo?.image || item.image || '');
      if (photoName && !builtImages.has(photoName)) {
        failures.push(`${page.slug}: item photo lost: ${photoName}`);
      }
      if (item.url && !builtHrefs.has(item.url)) {
        failures.push(`${page.slug}: link lost: ${item.url}`);
      }
      (item.editions || []).forEach((e) => {
        if (e.url && !builtHrefs.has(e.url)) {
          failures.push(`${page.slug}: edition link lost: ${e.url}`);
        }
      });
    });
  }
}

if (failures.length) {
  console.error(`PARITY FAILED — ${failures.length} loss(es):`);
  failures.slice(0, 30).forEach((f) => console.error('  ✗ ' + f));
  if (failures.length > 30) console.error(`  … and ${failures.length - 30} more`);
  process.exit(1);
}
console.log(`Parity holds: every authored string, image and item survives across ${PAGES.length} pages.`);
