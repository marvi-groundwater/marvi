/**
 * The page registry: which pages exist, in what order.
 *
 * Pages are the files in content/pages/. A static site cannot list a directory
 * at runtime, which is why index.html carries a hardcoded fallback list — but
 * at build time the directory *is* readable, so a page added through the CMS
 * is picked up with no code change.
 *
 * Order follows the authored list first (that is the designed narrative order
 * of the site), then anything new, alphabetically.
 *
 * Shared by the build and the verifier deliberately: they are two passes over
 * the same data, and a private copy in each is exactly how they drift.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function readAuthoredOrder(templateHtml) {
  const m = templateHtml.match(/const PAGE_KEYS = window\.MARVI_PAGES \|\| (\[[^\]]*\])/);
  try {
    return m ? JSON.parse(m[1].replace(/'/g, '"')) : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} root repo root
 * @param {Document} probe parsed index.html (for authored panels + nav labels)
 * @param {string} templateHtml raw index.html
 */
export function buildRegistry(root, probe, templateHtml) {
  const dir = join(root, 'content/pages');
  const ids = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
    : [];

  const authoredOrder = readAuthoredOrder(templateHtml);
  const ordered = [
    ...authoredOrder.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !authoredOrder.includes(id)).sort()
  ];

  const authoredPanels = new Set(
    [...probe.querySelectorAll('[data-panel]')].map((p) => p.getAttribute('data-panel'))
  );

  return ordered
    .map((id) => {
      let data = {};
      try {
        data = JSON.parse(readFileSync(join(dir, id + '.json'), 'utf8'));
      } catch { /* keep the page, fall back to authored markup */ }
      const authored = authoredPanels.has(id);
      return {
        id,
        slug: id === 'home' ? '' : id + '/',
        data,
        authored,
        // The nav label lives in index.html for authored sections, and in the
        // page file for ones created in the CMS.
        name:
          data.menuName ||
          probe.querySelector(`.nav-tab[data-tab="${id}"] .nav-name`)?.textContent.trim() ||
          id,
        template: authored ? 'builtin' : data.template || 'editorial',
        blocks: data.blocks,
        eyebrow: data.intro?.eyebrow,
        title: data.intro?.title,
        lede: data.intro?.lede,
        cover: data.heroImage?.image,
        coverFocus: data.heroImage
          ? `${data.heroImage.positionX ?? 50}% ${data.heroImage.positionY ?? 50}%`
          : null
      };
    })
    .filter((p) => p.data.published !== false);
}
