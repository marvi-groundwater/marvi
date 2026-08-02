/**
 * Render index.html the way a browser would, once per language.
 *
 * The site hydrates itself from content/pages/*.json and translates itself
 * from content/i18n.json — all in the inline scripts in index.html. Rather
 * than reimplement that here (a second copy that would drift the moment
 * someone edits the page), this runs the page's own code in jsdom and takes
 * the resulting HTML.
 *
 * The page picks its language from localStorage on boot, so selecting a
 * language is just a matter of seeding that before the scripts run.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

/** Browser APIs jsdom lacks that the page's motion code touches on boot. */
function installStubs(window) {
  window.matchMedia = () => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  });
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  window.IntersectionObserver = Observer;
  window.ResizeObserver = Observer;
  window.scrollTo = () => {};
}

/**
 * Serve content/ and assets/ off the filesystem. The page fetches relative
 * paths like "content/pages/home.json"; there is no server here, so map them
 * straight to files.
 */
function installFetch(window, root) {
  window.fetch = async (input) => {
    const url = String(input).replace(/^\.?\//, '').split('?')[0];
    const file = join(root, url);
    if (!existsSync(file)) {
      return { ok: false, status: 404, async json() { throw new Error('404'); } };
    }
    const body = readFileSync(file, 'utf8');
    return { ok: true, status: 200, async json() { return JSON.parse(body); }, async text() { return body; } };
  };
}

/**
 * @param {object} opts
 * @param {string} opts.root        repo root
 * @param {string} opts.html        index.html source
 * @param {string} opts.lang        language to render
 * @param {string[]} opts.pageKeys  page ids, in nav order
 * @returns {Promise<string>} the rendered document
 *
 * `html` is expected to already contain any CMS-created panels — the caller
 * injects them into the source rather than into the live DOM, so they are
 * present before the page's own scripts run and get hydrated and translated
 * alongside everything else. Mutating the DOM afterwards would race the
 * page's async hydration and silently miss the translation pass.
 */
export async function renderLanguage({ root, html, lang, pageKeys }) {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://localhost/',
    virtualConsole,
    resources: undefined, // never fetch external subresources during a build
    beforeParse(window) {
      installStubs(window);
      installFetch(window, root);
      window.MARVI_PAGES = pageKeys;
      try {
        window.localStorage.setItem('marvi-lang', lang);
      } catch { /* jsdom always provides localStorage, but stay defensive */ }
    }
  });

  const { window } = dom;

  // The page injects its panels and copy asynchronously. There is no "done"
  // signal to wait on, so settle by watching the DOM stop changing — cheaper
  // and more honest than a fixed sleep, which would either be too short on a
  // slow machine or waste time on a fast one.
  await settle(window);

  const out = '<!DOCTYPE html>\n' + window.document.documentElement.outerHTML;
  dom.window.close();
  if (errors.length) {
    throw new Error(`page script failed while rendering "${lang}": ${errors[0]}`);
  }
  return out;
}

function settle(window) {
  return new Promise((resolve) => {
    const { document } = window;
    let quiet = 0;
    let last = '';

    const tick = () => {
      const now = document.body.innerHTML.length + ':' + document.body.children.length;
      if (now === last) quiet++;
      else quiet = 0;
      last = now;
      if (quiet >= 3) return resolve();
      setTimeout(tick, 20);
    };
    setTimeout(tick, 20);
  });
}
