/**
 * The page registry: which pages exist, in what order.
 *
 * Every page is a file in content/pages/ — the twelve that shipped with the
 * site and anything created in the CMS, one shape for all. Order is the
 * `order` field (set in the CMS); ties and missing values fall back to
 * alphabetical so a hand-added file still lands somewhere sensible.
 *
 * Shared by build, verify and (later) the translator so they can never
 * disagree about what the site contains.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function buildRegistry(root) {
  const dir = join(root, 'content/pages');
  if (!existsSync(dir)) return [];
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const id = f.replace(/\.json$/, '');
      let data = {};
      try {
        data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch (err) {
        throw new Error(`content/pages/${f} is not valid JSON: ${err.message}`);
      }
      return {
        id,
        slug: data.slug || id,
        menuName: data.menuName || id,
        order: Number.isFinite(data.order) ? data.order : 500,
        published: data.published !== false,
        template: data.template || 'standard',
        ...data
      };
    })
    .filter((p) => p.published);
  pages.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  return pages;
}

/** URL path for a page in a language. The home page owns the root. */
export const urlFor = (lang, page, pages) => {
  const home = pages ? pages[0] : null;
  const slug = home && page.slug === home.slug ? '' : page.slug + '/';
  return lang === 'en' ? '/' + slug : '/' + lang + '/' + slug;
};
