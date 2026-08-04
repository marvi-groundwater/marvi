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

/* The preview pane renders the page with the site's OWN renderer, so what an
 * editor sees while typing is what the build will publish — the two cannot
 * drift, because there is only one of them.
 *
 * Sveltia resolves a preview template by `fileName ?? collectionName`. This is
 * a FOLDER collection, so there is no file name and the key is "pages", which
 * is why the component is called. It is NOT called for files collections, so
 * "site" deliberately has no custom template and uses the built-in preview —
 * still wearing the site's stylesheet, via registerPreviewStyle above.
 *
 * Measured on this bundle: renders the real page and redraws on every
 * keystroke. If a future Sveltia stops calling it, the symptom is an empty
 * white pane rather than an error — delete this line and the built-in preview
 * comes straight back.
 */
CMS.registerPreviewTemplate('pages', PagePreview);
