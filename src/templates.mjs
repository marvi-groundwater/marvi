/**
 * Page + block renderers.
 *
 * Every page on the site is rendered from its content/pages/<id>.json by these
 * functions at build time. The markup they emit is byte-compatible with what
 * the old hand-authored panels / runtime renderers produced — same classes,
 * same ids, same attributes — so the existing stylesheet and the migrated
 * pages' #panel-<id> CSS keep working untouched.
 *
 * Translation: any string that was translated under the old system carries its
 * legacy key in the block's `i18n` map (written by scripts/migrate.mjs); the
 * renderer re-emits it as data-i18n. Strings without a legacy key get a
 * generated `page.<slug>.b<n>.<path>` key, which makes them translatable the
 * moment the translation provider is restored (phase 3) while changing
 * nothing today.
 *
 * Isomorphic rule: take `document`, touch no globals — the same code must run
 * under linkedom at build time and, if ever needed, in a browser.
 */

/* ---------- generic helpers ---------- */

const el = (document, tag, opts = {}) => {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.key) node.setAttribute('data-i18n', opts.key);
  return node;
};

/** Text with \n rendered as <br> (hero title, image labels). */
const multiline = (document, node, value) => {
  node.textContent = '';
  String(value ?? '').split('\n').forEach((line, i) => {
    if (i > 0) node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode(line));
  });
  return node;
};

/* Mirror of layout-model.js (the runtime's MarviLayout) — the maths the CMS
 * layout controls are defined by. Kept in sync by hand; it is 12 lines. */
const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
export const photoLayout = (data = {}) => {
  const zoom = clamp(data.zoom, 50, 200, 100);
  return {
    x: clamp(data.positionX, 0, 100, 50),
    y: clamp(data.positionY, 0, 100, 50),
    scale: zoom / 100,
    fit: data.fit && data.fit !== 'auto' ? data.fit : 'cover'
  };
};
export const textLayout = (data = {}) => ({
  width: clamp(data.textWidth, 30, 100, 100),
  offsetX: clamp(data.textOffsetX, -30, 30, 0),
  offsetY: clamp(data.textOffsetY, -30, 30, 0)
});

/** Photo entry ({image, zoom, positionX, positionY, fit, alt}) → <img>. */
const photo = (document, entry = {}, { alt, lazy = true, className } = {}) => {
  const img = el(document, 'img', { class: className });
  if (entry.image) img.src = entry.image;
  img.alt = alt ?? entry.alt ?? '';
  if (lazy) img.setAttribute('loading', 'lazy');
  const layout = photoLayout(entry);
  if (layout.x !== 50 || layout.y !== 50) img.style.objectPosition = `${layout.x}% ${layout.y}%`;
  if (layout.scale !== 1) img.style.scale = String(layout.scale);
  if (entry.fit && entry.fit !== 'auto') img.style.objectFit = layout.fit;
  return img;
};

/** The intro sizing/placement controls, applied to a head root at build time. */
const applyTextControls = (root, intro = {}) => {
  const scale = (sel, value) => {
    const node = root.querySelector(sel);
    if (node) node.setAttribute('data-cms-text-scale', String(clamp(value, 0, 200, 100)));
  };
  scale('.eyebrow', intro.eyebrowSize);
  scale('h1', intro.titleSize);
  scale('.lede', intro.ledeSize);
  if (['left', 'center', 'right'].includes(intro.textAlign)) {
    root.setAttribute('data-text-align', intro.textAlign);
  }
  if (['top', 'middle', 'bottom'].includes(intro.textPosition)) {
    root.setAttribute('data-text-position', intro.textPosition);
  }
  const layout = textLayout(intro);
  root.style.setProperty('--cms-text-width', layout.width + '%');
  root.style.setProperty('--cms-text-offset-x', layout.offsetX + '%');
  root.style.setProperty('--cms-text-offset-y', layout.offsetY + '%');
};

/** The page-head cover photo custom properties (mirror of applyHeroLayout). */
const applyCoverControls = (root, entry = {}) => {
  if (!entry.image) return;
  const layout = photoLayout(entry);
  root.style.setProperty('--cover', `url("${String(entry.image).replaceAll('"', '%22')}")`);
  root.style.setProperty('--cms-photo-position', `${layout.x}% ${layout.y}%`);
  root.style.setProperty('--cms-photo-scale', String(layout.scale));
  root.style.setProperty('--cms-photo-fit', layout.fit);
};

const ytId = (url) => {
  const m =
    String(url || '').match(/[?&]v=([^&]+)/) || String(url || '').match(/youtu\.be\/([^?&]+)/);
  return m ? m[1] : '';
};

/* A stable id for a publication section or an archive category: it keys the
 * filter buttons and the translation entries, so it must not change when the
 * heading is retitled — and, crucially, it is what the runtime matches on, so
 * it must survive translation into 13 languages that the label does not. */
const stableKey = (kind) =>
  String(kind || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'other';

/**
 * Group a flat publication list into the page's sections.
 *
 * Publications are stored as one list with a `kind` on each entry; the sections
 * are the groups of that kind, laid out in the order of `block.sections`.
 * Deriving the grouping instead of storing it is what makes the page show every
 * publication exactly once — an entry cannot be filed under two headings, and
 * one whose kind names no section falls into the trailing catch-all rather than
 * disappearing. That matters: an editor is free to type a new kind, and
 * scripts/parity.mjs fails the deploy if any publication stops appearing.
 *
 * A configured section stays on the page when it is empty, showing its own
 * "nothing here yet" line and a chip reading 0 — an empty section advertises
 * that the kind exists and can be filled, which a missing one cannot.
 */
const publicationSections = (block, items) => {
  const configured =
    Array.isArray(block.sections) && block.sections.length
      ? block.sections
      : // No section list: fall back to the kinds actually present, first seen first.
        [...new Set(items.map((i) => i.kind).filter(Boolean))].map((kind) => ({ kind }));

  const byKind = new Map();
  const order = [];
  configured.forEach((entry) => {
    if (!entry || !entry.kind || byKind.has(entry.kind)) return;
    const section = {
      key: stableKey(entry.kind),
      label: entry.title || entry.kind,
      note: entry.note || '',
      empty: entry.empty || '',
      configured: true,
      items: []
    };
    byKind.set(entry.kind, section);
    order.push(section);
  });

  // The catch-all. If a section for kind "Other" was configured, unmatched
  // entries merge into it rather than creating a second one.
  let other = order.find((s) => s.key === 'other');
  items.forEach((item) => {
    const section = byKind.get(item.kind);
    if (section) return section.items.push(item);
    if (!other) {
      other = { key: 'other', label: block.otherLabel || 'Other', note: '', empty: '', items: [] };
      order.push(other);
    }
    other.items.push(item);
  });

  // A configured section stays on the page when it is empty: it advertises
  // that the kind exists and can be filled, and its chip shows a 0. The
  // catch-all is generated rather than configured, so it only ever appears
  // once something has actually landed in it.
  return order.filter((section) => section.items.length || section.configured);
};

/* ---------- block renderers ---------- */
/* Each takes (document, block, ctx) where ctx = { urlFor(pageId), t(path) }.
 * t(path) resolves the data-i18n key: legacy (block.i18n) or generated. */

const pageLink = (document, ctx, { label, page, primary, key }) => {
  const a = el(document, 'a', { class: 'button' + (primary ? ' primary' : '') });
  a.setAttribute('data-open', page);           // i18n slot + old-link compatibility
  a.setAttribute('href', ctx.urlFor(page));
  a.textContent = (label || '') + ' ';
  if (key) a.setAttribute('data-i18n', key);
  a.appendChild(el(document, 'span', { text: '↗' }));
  return a;
};

const proseColumn = (document, col, ctx, side) => {
  const wrap = el(document, 'div', { class: 'prose' });
  if (col.logo && col.logo.image) {
    const logo = el(document, 'img', { class: 'app-logo' });
    logo.src = col.logo.image;
    logo.alt = col.logo.alt || '';
    logo.setAttribute('loading', 'lazy');
    logo.setAttribute('width', '78');
    logo.setAttribute('height', '78');
    wrap.appendChild(logo);
  }
  if (col.lead) {
    wrap.appendChild(el(document, 'p', { class: 'large', text: col.lead, key: ctx.t(`${side}.lead`) }));
  }
  (col.paragraphs || []).forEach((text, i) => {
    wrap.appendChild(el(document, 'p', { text, key: ctx.t(`${side}.paragraphs.${i}`) }));
  });
  if (Array.isArray(col.features) && col.features.length) {
    const list = el(document, 'div', { class: 'feature-list' });
    col.features.forEach((f, i) => {
      const item = el(document, 'div', { class: 'feature-item' });
      item.appendChild(el(document, 'span', { text: f.number || String(i + 1).padStart(2, '0') }));
      const body = el(document, 'div');
      body.appendChild(el(document, 'strong', { text: f.title, key: ctx.t(`${side}.features.${i}.title`) }));
      if (f.text) body.appendChild(el(document, 'small', { text: f.text, key: ctx.t(`${side}.features.${i}.text`) }));
      item.appendChild(body);
      list.appendChild(item);
    });
    wrap.appendChild(list);
  }
  if (Array.isArray(col.actions) && col.actions.length) {
    const actions = el(document, 'div', { class: 'hero-actions' });
    col.actions.forEach((a) => actions.appendChild(pageLink(document, ctx, a)));
    wrap.appendChild(actions);
  }
  return wrap;
};

const splitColumn = (document, col = {}, ctx, side) => {
  if (col.kind === 'dataPanel') {
    const wrap = el(document, 'div', { class: 'image-data-panel reveal' });
    wrap.appendChild(photo(document, col.photo));
    const overlay = el(document, 'div', { class: 'image-data-overlay' });
    overlay.appendChild(el(document, 'strong', { text: col.stat }));
    overlay.appendChild(el(document, 'span', { text: col.caption, key: ctx.t(`${side}.caption`) }));
    wrap.appendChild(overlay);
    return wrap;
  }
  if (col.kind === 'image') {
    const wrap = el(document, 'div', { class: (col.look || 'app-shot') + ' reveal' });
    wrap.appendChild(photo(document, col.photo));
    return wrap;
  }
  return proseColumn(document, col, ctx, side);
};

const BLOCKS = {
  split(document, block, ctx) {
    const wrap = el(document, 'div', { class: 'split' });
    wrap.appendChild(splitColumn(document, block.left, ctx, 'left'));
    wrap.appendChild(splitColumn(document, block.right, ctx, 'right'));
    return wrap;
  },

  cards(document, block, ctx) {
    const grid = el(document, 'div', { class: 'grid-3' });
    (block.items || []).forEach((item, i) => {
      const card = el(document, 'article', { class: 'project-card' });
      card.appendChild(el(document, 'span', { class: 'card-number', text: item.number || String(i + 1).padStart(2, '0') }));
      card.appendChild(el(document, 'h3', { text: item.title, key: ctx.t(`items.${i}.title`) }));
      if (item.text) card.appendChild(el(document, 'p', { text: item.text, key: ctx.t(`items.${i}.text`) }));
      grid.appendChild(card);
    });
    return grid;
  },

  imagePair(document, block, ctx) {
    const wrap = el(document, 'div', {
      class: block.look === 'screens' ? 'app-screen-strip' : 'editorial-images'
    });
    (block.items || []).forEach((item, i) => {
      const figure = el(document, 'figure', {
        class: block.look === 'screens' ? undefined : 'editorial-image'
      });
      figure.appendChild(photo(document, item.photo));
      if (item.caption) {
        figure.appendChild(
          el(document, 'figcaption', { class: 'image-note', text: item.caption, key: ctx.t(`items.${i}.caption`) })
        );
      }
      wrap.appendChild(figure);
    });
    return wrap;
  },

  photoRibbon(document, block) {
    const wrap = el(document, 'div', { class: 'photo-ribbon' });
    (block.items || []).forEach((item) => {
      const figure = el(document, 'figure');
      figure.appendChild(photo(document, item.photo));
      wrap.appendChild(figure);
    });
    return wrap;
  },

  banner(document, block, ctx) {
    const wrap = el(document, 'div', { class: 'dark-block' });
    if (block.eyebrow) {
      const eyebrow = el(document, 'p', { class: 'eyebrow', text: block.eyebrow, key: ctx.t('eyebrow') });
      if (block.accent) eyebrow.style.color = block.accent;
      wrap.appendChild(eyebrow);
    }
    wrap.appendChild(el(document, 'h2', { text: block.title, key: ctx.t('title') }));
    if (block.lede) wrap.appendChild(el(document, 'p', { class: 'lede', text: block.lede, key: ctx.t('lede') }));
    return wrap;
  },

  statement(document, block, ctx) {
    const wrap = el(document, 'div', { class: 'home-statement' });
    const grid = el(document, 'div', { class: 'statement-grid' });
    grid.appendChild(el(document, 'p', { class: 'meta', text: block.label, key: ctx.t('label') }));
    grid.appendChild(el(document, 'blockquote', { text: block.quote, key: ctx.t('quote') }));
    wrap.appendChild(grid);
    const row = el(document, 'div', { class: 'metric-row' });
    (block.metrics || []).forEach((m, i) => {
      const metric = el(document, 'div', { class: 'metric' });
      metric.appendChild(el(document, 'strong', { text: m.value }));
      metric.appendChild(el(document, 'span', { text: m.label, key: ctx.t(`metrics.${i}.label`) }));
      row.appendChild(metric);
    });
    wrap.appendChild(row);
    return wrap;
  },

  storyCards(document, block, ctx) {
    const section = el(document, 'section', { class: 'home-explore' });
    section.setAttribute('aria-labelledby', 'explore-title');
    const head = el(document, 'header', { class: 'explore-head' });
    const headText = el(document, 'div');
    headText.appendChild(el(document, 'p', { class: 'eyebrow', text: block.eyebrow, key: ctx.t('eyebrow') }));
    const h2 = el(document, 'h2', { text: block.title, key: ctx.t('title') });
    h2.id = 'explore-title';
    headText.appendChild(h2);
    head.appendChild(headText);
    head.appendChild(el(document, 'p', { text: block.lede, key: ctx.t('lede') }));
    section.appendChild(head);
    const grid = el(document, 'div', { class: 'story-grid' });
    (block.items || []).forEach((item, i) => {
      const card = el(document, 'a', { class: 'story-card' });
      card.setAttribute('data-open', item.page);
      card.setAttribute('href', ctx.urlFor(item.page));
      card.appendChild(photo(document, item.photo));
      const copy = el(document, 'span', { class: 'story-copy' });
      copy.appendChild(el(document, 'span', { class: 'meta', text: item.label, key: ctx.t(`items.${i}.label`) }));
      copy.appendChild(el(document, 'strong', { text: item.title, key: ctx.t(`items.${i}.title`) }));
      const arrow = el(document, 'i', { text: '↗' });
      arrow.setAttribute('aria-hidden', 'true');
      copy.appendChild(arrow);
      card.appendChild(copy);
      grid.appendChild(card);
    });
    section.appendChild(grid);
    return section;
  },

  steps(document, block, ctx) {
    const wrap = el(document, 'div', { class: 'process' });
    (block.items || []).forEach((item, i) => {
      const step = el(document, 'div', { class: 'process-step' });
      step.appendChild(el(document, 'h3', { text: item.title, key: ctx.t(`items.${i}.title`) }));
      if (item.text) step.appendChild(el(document, 'p', { text: item.text, key: ctx.t(`items.${i}.text`) }));
      wrap.appendChild(step);
    });
    return wrap;
  },

  framedShot(document, block) {
    const frame = el(document, 'div', { class: 'game-frame' });
    const dots = el(document, 'div', { class: 'game-dots' });
    for (let i = 0; i < 3; i++) dots.appendChild(el(document, 'span'));
    frame.appendChild(dots);
    frame.appendChild(photo(document, block.photo, { lazy: false }));
    return frame;
  },

  mediaStories(document, block) {
    const frag = el(document, 'div', { class: 'media-stories-wrap' });
    const bar = el(document, 'div', { class: 'filter-bar' });
    const n = (block.items || []).length;
    const count = el(document, 'span', { class: 'filter-label', text: `${n} selected ${n === 1 ? 'story' : 'stories'}` });
    count.id = 'media-count';
    bar.appendChild(count);
    const search = el(document, 'input', { class: 'search' });
    search.id = 'media-search';
    search.setAttribute('type', 'search');
    search.setAttribute('placeholder', 'Search stories or publishers…');
    search.setAttribute('aria-label', 'Search media stories');
    bar.appendChild(search);
    frag.appendChild(bar);

    const grid = el(document, 'div', { class: 'media-grid' });
    grid.id = 'media-grid';
    (block.items || []).forEach((item) => {
      const a = el(document, 'a', { class: 'media-card' });
      a.href = item.url || '#';
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      a.setAttribute(
        'data-search',
        [item.meta, item.title, item.description].filter(Boolean).join(' ').toLowerCase()
      );
      a.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      a.appendChild(el(document, 'h3', { text: item.title }));
      if (item.description) a.appendChild(el(document, 'p', { text: item.description }));
      a.appendChild(el(document, 'span', { class: 'read', text: 'Read story ↗' }));
      grid.appendChild(a);
    });
    frag.appendChild(grid);
    return frag;
  },

  filmGrid(document, block) {
    const grid = el(document, 'div', { class: 'video-grid' });
    (block.items || []).forEach((item) => {
      const a = el(document, 'a', { class: 'video-card' });
      a.href = item.url || '#';
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      const wrap = el(document, 'div', { class: 'video-image' });
      const id = ytId(item.url);
      const img = el(document, 'img');
      img.setAttribute('loading', 'lazy');
      if (id) img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      img.alt = item.title ? item.title + ' video thumbnail' : '';
      const play = el(document, 'span', { class: 'play' });
      play.setAttribute('aria-hidden', 'true');
      wrap.append(img, play);
      a.appendChild(wrap);
      a.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      a.appendChild(el(document, 'h3', { text: item.title }));
      grid.appendChild(a);
    });
    return grid;
  },

  photoArchive(document, block) {
    const frag = el(document, 'div', { class: 'photo-archive-wrap' });
    const items = block.items || [];
    const tools = el(document, 'div', { class: 'archive-tools' });
    const count = el(document, 'span', {
      class: 'filter-label',
      text: `${items.length} archived ${items.length === 1 ? 'image' : 'images'}`
    });
    count.id = 'gallery-count';
    tools.appendChild(count);
    const filters = el(document, 'div', { class: 'archive-filters' });
    filters.id = 'archive-filters';
    filters.setAttribute('aria-label', 'Filter the image archive');
    ['All', ...new Set(items.map((i) => i.category).filter(Boolean))].forEach((category) => {
      const filter = el(document, 'button', { class: 'archive-filter', text: category });
      filter.setAttribute('type', 'button');
      filter.setAttribute('aria-pressed', String(category === 'All'));
      filters.appendChild(filter);
    });
    tools.appendChild(filters);
    frag.appendChild(tools);

    const grid = el(document, 'div', { class: 'gallery-grid' });
    grid.id = 'gallery-grid';
    grid.setAttribute('aria-live', 'polite');
    items.forEach((item, index) => {
      const button = el(document, 'button', { class: 'gallery-item' });
      button.setAttribute('type', 'button');
      button.setAttribute('data-category', item.category || '');
      button.setAttribute('data-index', String(index));
      button.setAttribute('data-title', item.title || '');
      button.setAttribute('aria-label', 'Open ' + (item.title || 'image'));
      const img = photo(document, item, { alt: item.title || '' });
      img.setAttribute('decoding', 'async');
      button.appendChild(img);
      button.appendChild(el(document, 'span', { text: item.category }));
      grid.appendChild(button);
    });
    frag.appendChild(grid);
    return frag;
  },

  publicationList(document, block, ctx) {
    const frag = el(document, 'div', { class: 'publications-wrap' });
    const items = block.items || [];
    const sections = publicationSections(block, items);

    // Chips carry their count, so the shape of the collection is legible
    // before anything is clicked — including the kinds sitting at zero.
    const filters = el(document, 'div', { class: 'chip-filter' });
    filters.id = 'publication-filters';
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Filter publications by kind');
    const addChip = (key, label, n, i18nKey) => {
      const chip = el(document, 'button', { class: 'chip-btn' });
      chip.setAttribute('type', 'button');
      // The runtime matches on this attribute, never on the label — labels are
      // translated into 13 languages and would stop matching data-section.
      chip.setAttribute('data-filter', key);
      chip.setAttribute('data-count', String(n));
      chip.setAttribute('aria-pressed', String(key === 'all'));
      chip.appendChild(el(document, 'span', { text: label, key: i18nKey }));
      chip.appendChild(el(document, 'b', { text: String(n) }));
      filters.appendChild(chip);
    };
    addChip('all', block.allLabel || 'All', items.length, ctx.t('allLabel'));
    sections.forEach((s) => addChip(s.key, s.label, s.items.length, ctx.t(`sections.${s.key}.title`)));
    frag.appendChild(filters);

    // Search and the chips intersect rather than replace one another, so
    // picking a kind and then typing narrows within that kind.
    const bar = el(document, 'label', { class: 'filter-bar' });
    bar.appendChild(
      el(document, 'span', { class: 'filter-label', text: block.searchLabel || 'Search', key: ctx.t('searchLabel') })
    );
    const search = el(document, 'input', { class: 'search' });
    search.id = 'publication-search';
    search.setAttribute('type', 'search');
    search.setAttribute('placeholder', block.searchPlaceholder || 'groundwater, water literacy, Hindi…');
    search.setAttribute('aria-label', 'Search publications');
    bar.appendChild(search);
    const count = el(document, 'span', {
      class: 'filter-label',
      text: `${items.length} ${items.length === 1 ? 'publication' : 'publications'}`
    });
    count.id = 'publication-count';
    // The count is the whole announcement when a chip is pressed or a query
    // typed; putting the live region here rather than on the list keeps it short.
    count.setAttribute('aria-live', 'polite');
    bar.appendChild(count);
    frag.appendChild(bar);

    // The list/cards choice is a CSS state on one set of markup, not a second
    // rendering — so filtering, counting and searching cannot disagree between
    // the two views.
    const view = block.defaultView === 'cards' ? 'cards' : 'list';
    const views = el(document, 'div', { class: 'view-toggle' });
    views.id = 'publication-views';
    views.setAttribute('role', 'group');
    views.setAttribute('aria-label', 'Change the layout');
    [['list', block.listLabel || 'List'], ['cards', block.cardsLabel || 'Cards']].forEach(([key, label]) => {
      const button = el(document, 'button', { class: 'view-btn', text: label, key: ctx.t(`views.${key}`) });
      button.setAttribute('type', 'button');
      button.setAttribute('data-view', key);
      button.setAttribute('aria-pressed', String(key === view));
      views.appendChild(button);
    });
    bar.appendChild(views);

    const wrap = el(document, 'div', { class: 'pub-sections' });
    wrap.id = 'publication-sections';
    wrap.setAttribute('data-view', view);
    sections.forEach((section) => {
      const group = el(document, 'section', { class: 'pub-section' });
      group.setAttribute('data-section', section.key);
      const head = el(document, 'div', { class: 'pub-section-head' });
      head.appendChild(
        el(document, 'h2', {
          class: 'pub-section-title',
          text: section.label,
          key: ctx.t(`sections.${section.key}.title`)
        })
      );
      // A bare number, so it never needs translating. The runtime rewrites it
      // to "2 of 4" while a search is narrowing the section.
      const sectionCount = el(document, 'span', {
        class: 'pub-section-count',
        text: String(section.items.length)
      });
      sectionCount.setAttribute('data-role', 'count');
      sectionCount.setAttribute('data-total', String(section.items.length));
      head.appendChild(sectionCount);
      group.appendChild(head);
      if (section.note) {
        group.appendChild(
          el(document, 'p', {
            class: 'pub-section-note',
            text: section.note,
            key: ctx.t(`sections.${section.key}.note`)
          })
        );
      }
      // Shown only when the kind is genuinely empty and nothing is narrowing
      // the view — under a search it would read as a second, different problem.
      const emptyLine = el(document, 'p', {
        class: 'pub-section-empty',
        text: section.empty || `Nothing listed under ${section.label.toLowerCase()} yet.`,
        key: ctx.t(`sections.${section.key}.empty`)
      });
      if (section.items.length) emptyLine.hidden = true;
      group.appendChild(emptyLine);

      const grid = el(document, 'div', { class: 'pub-grid' });
      section.items.forEach((item) => {
        const card = el(document, 'article', { class: 'pub-card' });
        if (item.kind) card.setAttribute('data-kind', item.kind);
        card.setAttribute('data-section', section.key);
        card.setAttribute(
          'data-search',
          [item.kind, item.meta, item.title, item.description, ...(item.editions || []).map((e) => e && e.label)]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
        );
        card.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
        card.appendChild(el(document, 'h3', { text: item.title }));
        if (item.description) card.appendChild(el(document, 'p', { text: item.description }));
        const links = el(document, 'span', { class: 'pub-links' });
        (item.editions || []).forEach((edition) => {
          if (!edition || !edition.url) return;
          const link = el(document, 'a', { text: (edition.label || 'Download') + ' ↗' });
          link.href = edition.url;
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener');
          link.setAttribute('aria-label', [item.title, edition.label].filter(Boolean).join(' — '));
          links.appendChild(link);
        });
        if (links.childNodes.length) card.appendChild(links);
        grid.appendChild(card);
      });
      group.appendChild(grid);
      wrap.appendChild(group);
    });
    frag.appendChild(wrap);

    // Belongs to the search alone: a kind that is simply empty already says so
    // in its own section, and showing both reads as two problems, not one fact.
    const noMatch = el(document, 'p', {
      class: 'pub-empty',
      text: block.emptyMessage || 'No publication matches that',
      key: ctx.t('emptyMessage')
    });
    noMatch.id = 'publication-empty';
    noMatch.hidden = true;
    frag.appendChild(noMatch);
    return frag;
  },

  toolList(document, block, ctx) {
    const grid = el(document, 'div', { class: 'tool-grid' });
    grid.id = 'tool-grid';
    (block.items || []).forEach((item) => {
      const card = el(document, 'article', { class: 'tool-card reveal' });
      const shot = el(document, 'div', { class: 'tool-shot' });
      shot.appendChild(photo(document, item.photo || {}, { alt: item.name ? item.name + ' screenshot' : '' }));
      card.appendChild(shot);
      const copy = el(document, 'div', { class: 'tool-copy' });
      copy.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      copy.appendChild(el(document, 'h3', { text: item.name }));
      if (item.description) copy.appendChild(el(document, 'p', { text: item.description }));
      // An external URL wins; otherwise link to the target page.
      const action = el(document, 'a', { class: 'button primary' });
      action.textContent = (item.linkLabel || 'Open') + ' ';
      if (item.url) {
        action.href = item.url;
        action.setAttribute('target', '_blank');
        action.setAttribute('rel', 'noopener');
      } else {
        action.setAttribute('data-open', item.target || 'home');
        action.href = ctx.urlFor(item.target || 'home');
      }
      action.appendChild(el(document, 'span', { text: '↗' }));
      copy.appendChild(action);
      card.appendChild(copy);
      grid.appendChild(card);
    });
    return grid;
  },

  partnerList(document, block) {
    const grid = el(document, 'div', { class: 'people-grid' });
    (block.items || []).forEach((item) => {
      const card = el(document, 'article', { class: 'people-card' });
      card.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      const h3 = el(document, 'h3');
      if (item.url) {
        const a = el(document, 'a', { text: (item.name || '') + ' ↗' });
        a.href = item.url;
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
        h3.appendChild(a);
      } else {
        h3.textContent = item.name || '';
      }
      card.appendChild(h3);
      grid.appendChild(card);
    });
    return grid;
  },

  portraitBand(document, block) {
    const band = el(document, 'div', { class: 'portrait-band' });
    (block.items || []).forEach((item) => {
      if (!item || !item.image) return;
      const card = el(document, item.url ? 'a' : 'article', { class: 'portrait-card' });
      if (item.url) {
        card.href = item.url;
        card.setAttribute('target', '_blank');
        card.setAttribute('rel', 'noopener');
      }
      const details = [item.name, item.title, item.affiliation].filter(Boolean).join(', ');
      card.setAttribute('aria-label', details + (item.url ? ' — open profile' : ''));
      card.appendChild(
        photo(document, item, { alt: item.name ? 'Portrait of ' + item.name : 'MARVI team member portrait' })
      );
      const info = el(document, 'span', { class: 'portrait-card-info' });
      info.appendChild(el(document, 'strong', { text: item.name || 'MARVI team member' }));
      if (item.title) info.appendChild(el(document, 'span', { text: item.title }));
      if (item.affiliation) info.appendChild(el(document, 'small', { text: item.affiliation }));
      card.appendChild(info);
      band.appendChild(card);
    });
    return band;
  },

  sourceNote(document, block) {
    const p = el(document, 'p');
    if (block.style) p.setAttribute('style', block.style);
    (block.parts || []).forEach((part) => {
      if (part.link) {
        const a = el(document, 'a', { text: part.link.label });
        a.href = part.link.url || '#';
        if (part.link.download) a.setAttribute('download', '');
        if (part.link.external) {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener');
        }
        p.appendChild(a);
      } else {
        p.appendChild(document.createTextNode(part.text || ''));
      }
    });
    return p;
  },

  video(document, block) {
    return BLOCKS.filmGrid(document, { items: [block] });
  },

  embed(document, block) {
    if (!/^https?:\/\/\S+$/i.test(String(block.url || ''))) return null;
    const wrap = el(document, 'section', { class: 'cms-block cms-block-embed' });
    const frame = el(document, 'iframe');
    frame.src = block.url;
    frame.setAttribute('loading', 'lazy');
    frame.setAttribute('title', block.title || 'Embedded content');
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('style', 'width:100%;aspect-ratio:16/9;border:0;border-radius:12px');
    wrap.appendChild(frame);
    return wrap;
  },

  /* --- the CMS "flexible section" types, markup-identical to the old
   *     renderFlexibleSections so their existing CSS applies --- */

  text(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-text' });
    cmsCopy(document, section, block);
    return section;
  },

  imageText(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-imageText' });
    section.setAttribute('data-photo-side', block.photoSide || 'left');
    cmsPhoto(document, section, block.photo || {});
    cmsCopy(document, section, block);
    return section;
  },

  gallery(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-gallery' });
    if (block.heading) section.appendChild(el(document, 'h2', { text: block.heading }));
    const gallery = el(document, 'div', { class: 'cms-block-gallery' });
    (block.photos || []).forEach((entry) => {
      const figure = el(document, 'figure');
      figure.appendChild(photo(document, entry, { alt: '' }));
      gallery.appendChild(figure);
    });
    section.appendChild(gallery);
    return section;
  },

  callout(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-callout' });
    section.setAttribute('data-tone', block.tone || 'blue');
    if (block.heading) section.appendChild(el(document, 'h2', { text: block.heading }));
    cmsParagraphs(document, section, block.body);
    return section;
  },

  button(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-button' });
    if (block.heading) section.appendChild(el(document, 'h2', { text: block.heading }));
    const link = el(document, 'a', { class: 'button primary', text: (block.label || 'Learn more') + ' ↗' });
    link.href = block.url || '#';
    section.appendChild(link);
    return section;
  }
};

const cmsParagraphs = (document, root, value) => {
  String(value || '').split(/\n\s*\n/).filter(Boolean).forEach((paragraph) => {
    root.appendChild(el(document, 'p', { text: paragraph.trim() }));
  });
};
const cmsCopy = (document, section, block) => {
  const copy = el(document, 'div', { class: 'cms-block-copy' });
  copy.setAttribute('data-align', block.align || 'left');
  if (block.eyebrow) copy.appendChild(el(document, 'p', { class: 'eyebrow', text: block.eyebrow }));
  if (block.heading) copy.appendChild(el(document, 'h2', { text: block.heading }));
  cmsParagraphs(document, copy, block.body);
  section.appendChild(copy);
};
const cmsPhoto = (document, section, entry) => {
  const frame = el(document, 'div', { class: 'cms-block-photo' });
  frame.appendChild(photo(document, entry, { alt: '' }));
  section.appendChild(frame);
};

export const BLOCK_TYPES = Object.keys(BLOCKS);

/* The "flexible section" types render appended after the section body inside
 * a .cms-sections wrapper — that is where their CSS expects them. */
const FLEX_TYPES = new Set(['text', 'imageText', 'gallery', 'callout', 'button', 'embed']);

/* ---------- page renderers ---------- */

const standardHead = (document, page, { index, total }) => {
  const head = el(document, 'header', { class: 'page-head' });
  head.appendChild(el(document, 'span', {
    class: 'section-index',
    text: String(index).padStart(2, '0') + ' / ' + String(total).padStart(2, '0')
  }));
  const inner = el(document, 'div');
  const intro = page.intro || {};
  if (intro.eyebrow != null) inner.appendChild(el(document, 'p', { class: 'eyebrow', text: intro.eyebrow }));
  inner.appendChild(el(document, 'h1', { text: intro.title || page.menuName }));
  if (intro.lede != null) inner.appendChild(el(document, 'p', { class: 'lede', text: intro.lede }));
  head.appendChild(inner);
  applyTextControls(head, intro);
  applyCoverControls(head, page.heroImage);
  return head;
};

const homeHero = (document, page, ctx) => {
  const hero = page.hero || {};
  const intro = page.intro || {};
  const t = (path) => hero.i18n?.[path];

  const wrap = el(document, 'div', { class: 'home-hero' });
  const copy = el(document, 'div', { class: 'hero-copy' });
  const inner = el(document, 'div', { class: 'hero-copy-inner' });
  inner.appendChild(el(document, 'p', { class: 'eyebrow', text: intro.eyebrow }));
  inner.appendChild(multiline(document, el(document, 'h1'), intro.title));
  inner.appendChild(el(document, 'p', { class: 'lede', text: intro.lede }));
  const actions = el(document, 'div', { class: 'hero-actions' });
  (hero.actions || []).forEach((a) => actions.appendChild(pageLink(document, ctx, a)));
  inner.appendChild(actions);
  copy.appendChild(inner);
  applyTextControls(copy, intro);
  wrap.appendChild(copy);

  const stage = el(document, 'div', { class: 'hero-image-stage' });
  if (hero.stageAlt) stage.setAttribute('aria-label', hero.stageAlt);
  stage.appendChild(photo(document, page.heroImage || {}, { alt: hero.imageAlt || '', lazy: false, className: 'hero-image-main' }));
  if (hero.label) {
    stage.appendChild(multiline(document, el(document, 'div', { class: 'hero-image-label', key: t('label') }), hero.label));
  }
  const index = el(document, 'div', { class: 'hero-image-index', text: '↓' });
  index.setAttribute('aria-hidden', 'true');
  stage.appendChild(index);
  if (hero.caption) {
    stage.appendChild(multiline(document, el(document, 'div', { class: 'hero-image-caption', key: t('caption') }), hero.caption));
  }
  wrap.appendChild(stage);
  return wrap;
};

/**
 * Render one page into a <section class="panel"> element.
 * ctx: { index, total, urlFor(pageId) }
 */
export function renderPage(document, page, ctx) {
  const section = el(document, 'section', { class: 'panel' });
  section.id = 'panel-' + page.slug;
  section.setAttribute('data-panel', page.slug);
  section.setAttribute('role', 'tabpanel');
  section.setAttribute('tabindex', '0');

  const blockCtx = (block, i) => ({
    urlFor: ctx.urlFor,
    t: (path) => block.i18n?.[path] || `page.${page.slug}.b${i}.${path}`
  });

  const core = [];
  const flex = [];
  (page.blocks || []).forEach((block, i) => {
    const render = BLOCKS[block?.type];
    if (!render) return;
    const node = render(document, block, blockCtx(block, i));
    if (!node) return;
    (FLEX_TYPES.has(block.type) ? flex : core).push(node);
  });

  if (page.template === 'home') {
    section.appendChild(homeHero(document, page, ctx));
    core.forEach((n) => section.appendChild(n));
    if (flex.length) section.appendChild(flexWrap(document, flex));
    return section;
  }

  const wrap = el(document, 'div', { class: 'content-wrap' });
  wrap.appendChild(standardHead(document, page, ctx));
  const body = el(document, 'div', { class: 'section-body' });
  core.forEach((n) => body.appendChild(n));
  wrap.appendChild(body);
  if (flex.length) wrap.appendChild(flexWrap(document, flex));
  section.appendChild(wrap);
  return section;
}

const flexWrap = (document, nodes) => {
  const wrap = el(document, 'div', { class: 'cms-sections' });
  nodes.forEach((n) => wrap.appendChild(n));
  return wrap;
};
