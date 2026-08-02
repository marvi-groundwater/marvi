/**
 * Renderers for CMS-created pages.
 *
 * The ten original sections are hand-authored in index.html and keep their
 * bespoke markup ("builtin" pages). Anything an editor creates is rendered
 * here instead, from a template plus an ordered list of blocks.
 *
 * The deal this encodes: editors choose *what is on the page and in what
 * order*; the design system keeps control of *how it looks*. Every block below
 * reuses classes that already exist in the stylesheet, so a new page inherits
 * the site's typography and spacing rather than inventing its own. Adding a
 * block type means adding a renderer here, listing its text fields in
 * TEXT_FIELDS, and adding a variant in admin/config.yml — deliberately a code
 * change, not a content one.
 *
 * Translation: every translatable string a block renders is tagged with
 * data-i18n, using keys that translatableStrings() reproduces exactly. That
 * shared key scheme is what lets auto-translate.mjs find the strings without
 * rendering anything, and it is why the two must stay in step — hence
 * TEXT_FIELDS driving both.
 *
 * Same isomorphic rule as hydrate.mjs: take `document`, touch no globals.
 */

const el = (document, tag, opts = {}) => {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.key) node.setAttribute('data-i18n', opts.key);
  return node;
};

/** Split editor prose into paragraphs on blank lines. */
const paragraphs = (text) =>
  String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

const applyFit = (img, focus, fit) => {
  if (focus && focus !== 'auto') img.style.objectPosition = focus;
  if (fit && fit !== 'auto') img.style.objectFit = fit;
};

const image = (document, src, alt, focus, fit, altKey) => {
  const img = el(document, 'img');
  img.src = src;
  img.alt = alt || '';
  img.loading = 'lazy';
  if (altKey && alt) img.setAttribute('data-i18n-alt', altKey);
  applyFit(img, focus, fit);
  return img;
};

const ytId = (url) => {
  const m =
    String(url || '').match(/[?&]v=([^&]+)/) || String(url || '').match(/youtu\.be\/([^?&]+)/);
  return m ? m[1] : '';
};

/**
 * Which fields of each block type hold translatable prose.
 * `fields` are on the block itself; `itemFields` repeat per entry in `items`.
 * Numbers (a stat's value, a card's index) are deliberately absent — they read
 * the same in every language and translating them invites corruption.
 */
export const TEXT_FIELDS = {
  // prose is handled specially: it splits into one key per paragraph.
  prose: { fields: [], paragraphField: 'text' },
  heading: { fields: ['text'] },
  image: { fields: ['caption', 'alt'] },
  imagePair: { fields: ['altA', 'altB'] },
  quote: { fields: ['text', 'attribution'] },
  stats: { fields: [], itemFields: ['label'] },
  video: { fields: ['title', 'meta'] },
  cards: { fields: [], itemFields: ['title', 'text'] },
  steps: { fields: [], itemFields: ['title', 'text'] },
  embed: { fields: ['title'] }
};

/* ---------- blocks ---------- */

const BLOCKS = {
  prose(document, block, k) {
    const wrap = el(document, 'div', { class: 'prose reveal' });
    // One key per paragraph, not one for the whole field: applying a
    // translation sets textContent, which would flatten a multi-paragraph
    // block into a single run of text. translatableStrings() splits the same
    // way, so the keys line up.
    paragraphs(block.text).forEach((text, i) => {
      wrap.appendChild(
        el(document, 'p', {
          class: i === 0 && block.lead ? 'large' : '',
          text,
          key: k('text.p' + i)
        })
      );
    });
    return wrap;
  },

  heading(document, block, k) {
    const wrap = el(document, 'div', { class: 'reveal' });
    wrap.appendChild(el(document, 'h2', { text: block.text, key: k('text') }));
    return wrap;
  },

  image(document, block, k) {
    if (!block.image) return null;
    const figure = el(document, 'figure', { class: 'editorial-image reveal' });
    figure.appendChild(
      image(document, block.image, block.alt, block.focus, block.fit, k('alt'))
    );
    if (block.caption) {
      figure.appendChild(
        el(document, 'figcaption', { class: 'image-note', text: block.caption, key: k('caption') })
      );
    }
    return figure;
  },

  imagePair(document, block, k) {
    const wrap = el(document, 'div', { class: 'split reveal' });
    [block.imageA, block.imageB].forEach((src, i) => {
      if (!src) return;
      const figure = el(document, 'figure', { class: 'editorial-image' });
      figure.appendChild(
        image(
          document,
          src,
          i === 0 ? block.altA : block.altB,
          block.focus,
          block.fit,
          k(i === 0 ? 'altA' : 'altB')
        )
      );
      wrap.appendChild(figure);
    });
    return wrap.children.length ? wrap : null;
  },

  quote(document, block, k) {
    if (!block.text) return null;
    const wrap = el(document, 'div', { class: 'dark-block reveal' });
    wrap.appendChild(el(document, 'blockquote', { text: block.text, key: k('text') }));
    if (block.attribution) {
      wrap.appendChild(
        el(document, 'p', { class: 'meta', text: block.attribution, key: k('attribution') })
      );
    }
    return wrap;
  },

  stats(document, block, k) {
    const items = Array.isArray(block.items) ? block.items : [];
    if (!items.length) return null;
    const row = el(document, 'div', { class: 'metric-row reveal' });
    items.forEach((item, j) => {
      const metric = el(document, 'div', { class: 'metric' });
      metric.appendChild(el(document, 'strong', { text: item.value }));
      metric.appendChild(el(document, 'span', { text: item.label, key: k('i' + j + '.label') }));
      row.appendChild(metric);
    });
    return row;
  },

  video(document, block, k) {
    if (!block.url) return null;
    const grid = el(document, 'div', { class: 'video-grid reveal' });
    const a = el(document, 'a', { class: 'video-card' });
    a.href = block.url;
    a.target = '_blank';
    a.rel = 'noopener';
    const wrap = el(document, 'div', { class: 'video-image' });
    const id = ytId(block.url);
    const img = image(
      document,
      block.thumbnail || (id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : ''),
      block.title
    );
    const play = el(document, 'span', { class: 'play' });
    play.setAttribute('aria-hidden', 'true');
    wrap.append(img, play);
    a.appendChild(wrap);
    if (block.meta) {
      a.appendChild(el(document, 'span', { class: 'meta', text: block.meta, key: k('meta') }));
    }
    a.appendChild(el(document, 'h3', { text: block.title, key: k('title') }));
    grid.appendChild(a);
    return grid;
  },

  cards(document, block, k) {
    const items = Array.isArray(block.items) ? block.items : [];
    if (!items.length) return null;
    const grid = el(document, 'div', { class: 'grid-3 reveal' });
    items.forEach((item, j) => {
      const card = el(document, 'article', { class: 'project-card' });
      if (item.image) {
        card.style.backgroundImage =
          `linear-gradient(180deg, rgb(5 14 11 / .1), rgb(5 14 11 / .6)), url("${item.image}")`;
      }
      card.appendChild(
        el(document, 'span', { class: 'card-number', text: String(j + 1).padStart(2, '0') })
      );
      card.appendChild(el(document, 'h3', { text: item.title, key: k('i' + j + '.title') }));
      if (item.text) {
        card.appendChild(el(document, 'p', { text: item.text, key: k('i' + j + '.text') }));
      }
      grid.appendChild(card);
    });
    return grid;
  },

  steps(document, block, k) {
    const items = Array.isArray(block.items) ? block.items : [];
    if (!items.length) return null;
    const wrap = el(document, 'div', { class: 'process reveal' });
    items.forEach((item, j) => {
      const step = el(document, 'div', { class: 'process-step' });
      step.appendChild(el(document, 'strong', { text: item.title, key: k('i' + j + '.title') }));
      if (item.text) {
        step.appendChild(el(document, 'p', { text: item.text, key: k('i' + j + '.text') }));
      }
      wrap.appendChild(step);
    });
    return wrap;
  },

  embed(document, block) {
    if (!block.url) return null;
    const wrap = el(document, 'div', { class: 'reveal' });
    const frame = el(document, 'iframe');
    frame.src = block.url;
    frame.loading = 'lazy';
    frame.title = block.title || 'Embedded content';
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('style', 'width:100%;aspect-ratio:16/9;border:0;border-radius:12px');
    wrap.appendChild(frame);
    return wrap;
  }
};

export const BLOCK_TYPES = Object.keys(BLOCKS);

/** Key prefix for a block's strings. Must match translatableStrings(). */
const blockKeyBase = (pageId, index) => `page.${pageId}.b${index}`;

/**
 * Every translatable string on a page, as { key, english }.
 * auto-translate.mjs uses this so new pages are translated like any other
 * content — without it, a CMS page would exist in English only.
 */
export function translatableStrings(page) {
  const out = [];
  const push = (key, english) => {
    if (english != null && String(english).trim()) out.push({ key, english: String(english) });
  };

  // The nav label and page head reuse the same key shape as the builtin
  // sections, so the existing slot machinery in hydrate.mjs applies them.
  push(`nav.${page.id}`, page.name);
  push(`sec.${page.id}.eyebrow`, page.eyebrow);
  push(`sec.${page.id}.title`, page.title);
  push(`sec.${page.id}.lede`, page.lede);

  (Array.isArray(page.blocks) ? page.blocks : []).forEach((block, i) => {
    const spec = TEXT_FIELDS[block && block.type];
    if (!spec) return;
    const base = blockKeyBase(page.id, i);
    (spec.fields || []).forEach((f) => push(`${base}.${f}`, block[f]));
    if (spec.paragraphField) {
      paragraphs(block[spec.paragraphField]).forEach((text, p) =>
        push(`${base}.${spec.paragraphField}.p${p}`, text)
      );
    }
    if (spec.itemFields && Array.isArray(block.items)) {
      block.items.forEach((item, j) => {
        spec.itemFields.forEach((f) => push(`${base}.i${j}.${f}`, item && item[f]));
      });
    }
  });
  return out;
}

/* ---------- templates ---------- */

// Templates differ in the header treatment and the wrapper around the blocks.
// They intentionally do not differ in typography or colour — that is the
// stylesheet's job, and the reason a new page still looks like this site.
const TEMPLATES = {
  editorial: { bodyClass: 'section-body' },
  feature: { bodyClass: 'section-body' },
  gallery: { bodyClass: 'section-body' }
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/**
 * A "builtin" page is one of the ten original sections, whose markup lives in
 * index.html and is not generated here. The CMS writes template: "builtin" for
 * these (it uses the template field as its variable-type key); `builtin: true`
 * is the older shape and is still accepted.
 */
export const isBuiltin = (page) => page.template === 'builtin' || page.builtin === true;

/**
 * Build a full <section class="panel"> for a CMS-created page.
 * Returns the element; the caller decides where it goes.
 */
export function renderPage(document, page, { index, total } = {}) {
  const template = TEMPLATES[page.template] || TEMPLATES.editorial;

  const section = el(document, 'section', { class: 'panel' });
  section.id = 'panel-' + page.id;
  section.setAttribute('data-panel', page.id);
  section.setAttribute('tabindex', '0');

  const wrap = el(document, 'div', { class: 'content-wrap' });

  const head = el(document, 'header', { class: 'page-head' });
  if (index != null && total != null) {
    head.appendChild(
      el(document, 'span', {
        class: 'section-index',
        text: String(index).padStart(2, '0') + ' / ' + String(total).padStart(2, '0')
      })
    );
  }
  // No data-i18n here: these three reuse the sec.<id>.* slots, which are
  // matched by selector in hydrate.mjs like the builtin sections.
  const headText = el(document, 'div');
  if (page.eyebrow) headText.appendChild(el(document, 'p', { class: 'eyebrow', text: page.eyebrow }));
  headText.appendChild(el(document, 'h1', { text: page.title || page.name || '' }));
  if (page.lede) headText.appendChild(el(document, 'p', { class: 'lede', text: page.lede }));
  head.appendChild(headText);
  wrap.appendChild(head);

  const body = el(document, 'div', { class: template.bodyClass });
  (Array.isArray(page.blocks) ? page.blocks : []).forEach((block, i) => {
    const render = BLOCKS[block && block.type];
    if (!render) return;
    const base = blockKeyBase(page.id, i);
    const node = render(document, block, (field) => `${base}.${field}`);
    if (node) body.appendChild(node);
  });
  wrap.appendChild(body);

  section.appendChild(wrap);
  return section;
}

/**
 * Cover photo for a CMS page, applied the same way the builtin sections do it
 * (a --cover custom property the stylesheet turns into the header background).
 */
export function applyCover(section, page) {
  if (!page.cover) return;
  const head = section.querySelector('.page-head');
  if (!head) return;
  head.style.setProperty('--cover', `url("${page.cover}")`);
  if (page.coverFocus && page.coverFocus !== 'auto') {
    head.style.setProperty('--cover-position', page.coverFocus);
  }
}
