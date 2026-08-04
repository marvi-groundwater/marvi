/**
 * Live preview for the CMS — renders the entry you are editing with the exact
 * same renderer the published site uses.
 *
 * This is only possible because src/templates.mjs is isomorphic: it takes a
 * `document` and touches no globals, so the build imports it under linkedom
 * and this file imports it in the browser. There is one renderer, so the
 * preview cannot drift from the real page — the failure mode of the previous
 * preview, which drove a separate in-page runtime that no longer exists.
 *
 * Loaded as a module by admin/index.html. `window.h` is Decap's hyperscript
 * (Decap 3 exposes `h`, not `React`).
 */

import { renderPage } from '/assets/templates.mjs';

const { CMS, h } = window;

/* ---------- styles ---------- */

// The site's CSS, published by the build. Loading it verbatim is what makes
// the preview look like the site rather than an approximation.
CMS.registerPreviewStyle('/assets/site.css');

// Preview-only corrections: the site's layout positions panels inside a
// full-height column offset by the fixed sidebar, neither of which exists in
// the preview iframe.
CMS.registerPreviewStyle(
  `
  html, body { margin: 0; background: var(--paper, #f1eee7); }
  .cms-preview-root { display: block; }
  .cms-preview-root .panel { min-height: 0; animation: none; }
  .cms-preview-root .content-wrap { width: min(1180px, calc(100% - 48px)); }
  /* Reveal animations never trigger without the site's IntersectionObserver. */
  .cms-preview-root .reveal { opacity: 1 !important; transform: none !important; }
  .cms-preview-root .motion-item { opacity: 1 !important; transform: none !important; }
  .cms-preview-empty {
    padding: 48px; font: 400 .95rem/1.6 system-ui, sans-serif; color: #6d746f;
  }
  `,
  { raw: true }
);

/* ---------- entry -> page object ---------- */

/**
 * A freshly picked image is a blob-backed asset that does not exist at its
 * eventual repository path yet, so every nested `image` value has to be
 * resolved through getAsset before rendering.
 */
const resolveAssets = (getAsset, value, fieldName) => {
  if (Array.isArray(value)) return value.map((item) => resolveAssets(getAsset, item));
  if (!value || typeof value !== 'object') {
    if (fieldName === 'image' && typeof value === 'string' && value) {
      const asset = getAsset(value);
      return asset ? asset.toString() : value;
    }
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, val]) => [key, resolveAssets(getAsset, val, key)])
  );
};

const toPage = (entry, getAsset) => {
  const raw = entry.getIn(['data']);
  const data = raw && typeof raw.toJS === 'function' ? raw.toJS() : raw || {};
  const page = resolveAssets(getAsset, data);
  return {
    ...page,
    // The renderer needs these; a half-typed entry may not have them yet.
    slug: page.slug || 'preview',
    menuName: page.menuName || 'Untitled page',
    intro: page.intro || {},
    blocks: Array.isArray(page.blocks) ? page.blocks : []
  };
};

/* ---------- preview component ---------- */

const PagePreview = ({ entry, getAsset }) => {
  let node;
  try {
    const page = toPage(entry, getAsset);
    // A detached document keeps rendering isolated from the preview DOM.
    const doc = document.implementation.createHTMLDocument('preview');
    node = renderPage(doc, page, {
      index: Number(page.order) || 1,
      total: Number(page.order) || 1,
      // Links are inert in a preview; keep them harmless.
      urlFor: () => '#'
    });
  } catch (err) {
    // A partly-filled entry should show a message, not a blank pane.
    node = null;
    console.warn('[preview] render failed:', err);
  }

  return h('div', {
    className: 'cms-preview-root',
    ref: (el) => {
      if (!el) return;
      el.textContent = '';
      if (node) {
        el.appendChild(el.ownerDocument.importNode(node, true));
      } else {
        const msg = el.ownerDocument.createElement('p');
        msg.className = 'cms-preview-empty';
        msg.textContent = 'Preview unavailable — fill in the page title to start.';
        el.appendChild(msg);
      }
    }
  });
};

/* Custom preview templates are OFF by default under Sveltia CMS.
 *
 * Sveltia accepts registerPreviewTemplate and, as measured on this exact
 * bundle in a sibling repository, never calls the component — and the act of
 * registering one REPLACES the working built-in preview with a blank
 * rectangle. Registering unconditionally would therefore trade a working
 * preview for an empty pane.
 *
 * It may nonetheless work here: Sveltia looks the template up by
 * `fileName ?? collectionName`, and this is a folder collection ("pages"),
 * where the sibling's failing cases were files collections. That is untested.
 *
 * To test, open /admin/?customPreview=1 and edit a page:
 *   - the page renders with the site's own styling  -> it works, make it
 *     unconditional again
 *   - an empty white rectangle                      -> it does not, leave this
 *     as it is and use the built-in preview
 *
 * registerPreviewStyle above is unaffected and does work, so the built-in
 * preview is still styled like the real site either way.
 */
if (new URLSearchParams(window.location.search).has('customPreview')) {
  CMS.registerPreviewTemplate('pages', PagePreview);
}
