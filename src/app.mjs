/**
 * Browser-only behaviour: motion, gallery, search, lightbox, menu.
 *
 * Content and translation are baked in at build time (see hydrate.mjs), so
 * nothing here fetches copy or swaps languages — the language switcher is a
 * plain navigation now. Each built page carries only its own panel, so every
 * lookup below must tolerate its target being absent.
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- motion ---------- */

function setupMotion() {
  document.body.classList.add('motion-ready');
  const motionItems = [
    ...document.querySelectorAll('.project-card, .process-step, .media-card, .video-card, .people-card, .metric')
  ];
  motionItems.forEach((item, index) => {
    item.classList.add('motion-item');
    item.style.setProperty('--motion-delay', (index % 4) * 65 + 'ms');
  });

  if (reduceMotion || !('IntersectionObserver' in window)) {
    motionItems.forEach((item) => item.classList.add('is-inview'));
  } else {
    const motionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-inview');
          motionObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -5% 0px' }
    );
    motionItems.forEach((item) => motionObserver.observe(item));
  }

  const metrics = [...document.querySelectorAll('.metric strong')];
  metrics.forEach((metric) => {
    metric.dataset.value = metric.textContent.trim();
  });
  const animateMetric = (metric) => {
    if (metric.dataset.animated) return;
    metric.dataset.animated = 'true';
    const end = Number(metric.dataset.value);
    if (!Number.isFinite(end) || reduceMotion) return;
    const start = end >= 1000 ? end - 12 : 0;
    const started = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - started) / 1100, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      metric.textContent = Math.round(start + (end - start) * eased).toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const metricRow = document.querySelector('.metric-row');
  if (metricRow && !reduceMotion && 'IntersectionObserver' in window) {
    const metricObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        metrics.forEach(animateMetric);
        metricObserver.disconnect();
      },
      { threshold: 0.4 }
    );
    metricObserver.observe(metricRow);
  }

  if (!reduceMotion && window.matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('.story-card').forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        const bounds = card.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width;
        const y = (event.clientY - bounds.top) / bounds.height;
        card.style.setProperty('--spot-x', (x * 100).toFixed(1) + '%');
        card.style.setProperty('--spot-y', (y * 100).toFixed(1) + '%');
        card.style.transform = `perspective(1000px) rotateX(${((0.5 - y) * 3.5).toFixed(2)}deg) rotateY(${((x - 0.5) * 4.5).toFixed(2)}deg) translateY(-4px)`;
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = '';
        card.style.removeProperty('--spot-x');
        card.style.removeProperty('--spot-y');
      });
    });
  }

  const progressBar = document.getElementById('scroll-progress');
  if (progressBar) {
    let progressFrame = 0;
    const updateProgress = () => {
      progressFrame = 0;
      const distance = document.documentElement.scrollHeight - window.innerHeight;
      const progress = distance > 0 ? Math.min(window.scrollY / distance, 1) : 0;
      progressBar.style.transform = `scaleX(${progress})`;
    };
    window.addEventListener('scroll', () => {
      if (!progressFrame) progressFrame = requestAnimationFrame(updateProgress);
    }, { passive: true });
    window.addEventListener('resize', updateProgress);
    updateProgress();
  }
}

/**
 * Apply the CMS text-size percentages.
 *
 * The percentage is carried on the element as data-cms-text-scale, so this
 * needs no content lookup — it just resolves the designed size (a clamp(), so
 * viewport-dependent) and scales it. The build deliberately ships these
 * unsized: the value can only be computed where CSS is actually resolved,
 * which is why it re-runs on resize.
 */
function refreshTextScales() {
  document.querySelectorAll('[data-cms-text-scale]').forEach((node) => {
    const percentage = Number(node.dataset.cmsTextScale) || 0;
    if (!percentage || percentage === 100) return;
    node.style.fontSize = '';
    const baseline = Number.parseFloat(getComputedStyle(node).fontSize);
    if (Number.isFinite(baseline)) node.style.fontSize = (baseline * percentage) / 100 + 'px';
  });
}

function showReveals(root) {
  root.querySelectorAll('.reveal').forEach((element, index) => {
    window.setTimeout(() => element.classList.add('is-visible'), Math.min(index * 90, 420) + 60);
  });
}

/* ---------- image archive + publications ---------- */
/* Grids, filter buttons and counts are prerendered by the build; this only
 * wires behaviour onto them. */

/* `allKey` is the value that means "show everything". Publications have their
 * own driver (setupPublications) because they also carry a search and a layout
 * switch; this stays the simple one-axis filter the image archive needs. */
function wireFilters({ filterWrap, grid, itemSel, categoryAttr, count, noun, allKey = 'All' }) {
  if (!filterWrap || !grid) return;
  const buttons = [...filterWrap.querySelectorAll('.archive-filter')];
  buttons.forEach((filter) => {
    filter.addEventListener('click', () => {
      // Prefer the data attribute: button labels are translated into 13
      // languages, so matching on what the button says stops working the
      // moment the page is not in English.
      const category = filter.getAttribute('data-filter') ?? filter.textContent.trim();
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === filter)));
      let visible = 0;
      grid.querySelectorAll(itemSel).forEach((item) => {
        const match = category === allKey || item.getAttribute(categoryAttr) === category;
        item.hidden = !match;
        if (match) visible++;
      });
      if (count) count.textContent = `${visible} ${visible === 1 ? noun[0] : noun[1]}`;
    });
  });
}

function setupArchive() {
  const grid = document.getElementById('gallery-grid');
  wireFilters({
    filterWrap: document.getElementById('archive-filters'),
    grid,
    itemSel: '.gallery-item',
    categoryAttr: 'data-category-key',
    count: document.getElementById('gallery-count'),
    noun: ['archived image', 'archived images'],
    allKey: 'all'
  });
  // The old runtime appended pixel dimensions to each label once the image
  // loaded; keep that touch. This reads data-category, not the key beside it:
  // the caption is for a reader, so it wants the label, not the slug.
  grid?.querySelectorAll('.gallery-item img').forEach((image) => {
    const label = image.parentElement.querySelector('span');
    const annotate = () => {
      if (label && image.naturalWidth && image.naturalHeight) {
        label.textContent =
          image.parentElement.getAttribute('data-category') +
          ' · ' + image.naturalWidth + '×' + image.naturalHeight;
      }
    };
    if (image.complete) annotate();
    else image.addEventListener('load', annotate);
  });
}

/* Every token must appear somewhere in the entry, so "book hindi" narrows
 * rather than widens; word order and which field matched do not matter. */
const matchesQuery = (haystack, query) =>
  query.split(/\s+/).every((token) => haystack.includes(token));

/**
 * Publications: a chip row that filters by kind, a text search, and a
 * list/cards layout switch.
 *
 * The chips and the search INTERSECT rather than replace one another, so
 * choosing a kind and then typing narrows within that kind instead of silently
 * discarding it. Everything is recomputed from the two pieces of state on every
 * change rather than toggled incrementally: with two inputs that is cheap, and
 * it removes the whole class of bug where the visible list disagrees with the
 * controls above it.
 */
function setupPublications() {
  const list = document.getElementById('publication-sections');
  const filters = document.getElementById('publication-filters');
  if (!list || !filters) return;
  const search = document.getElementById('publication-search');
  const count = document.getElementById('publication-count');
  const noMatch = document.getElementById('publication-empty');
  const views = document.getElementById('publication-views');
  let kind = 'all';

  const apply = () => {
    const query = search ? search.value.trim().toLowerCase() : '';
    const searching = query.length > 0;
    let shown = 0;
    let scope = 0;

    list.querySelectorAll('.pub-section').forEach((group) => {
      const kindOK = kind === 'all' || kind === group.getAttribute('data-section');
      const cards = [...group.querySelectorAll('.pub-card')];
      if (kindOK) scope += cards.length;

      let visible = 0;
      cards.forEach((card) => {
        const hit =
          kindOK && (!searching || matchesQuery(card.getAttribute('data-search') || '', query));
        card.hidden = !hit;
        if (hit) visible++;
      });
      shown += visible;

      const countNode = group.querySelector('[data-role="count"]');
      if (countNode) {
        const total = countNode.getAttribute('data-total') || String(cards.length);
        countNode.textContent = searching && kindOK ? `${visible} of ${total}` : total;
      }

      const emptyLine = group.querySelector('.pub-section-empty');
      if (!kindOK) {
        // Filtered out by kind — not a result of zero, so say nothing.
        group.hidden = true;
      } else if (visible > 0) {
        group.hidden = false;
        if (emptyLine) emptyLine.hidden = true;
      } else if (searching) {
        // Repeating "no theses yet" under every query would be noise; the
        // page-level line covers a search that matches nothing.
        group.hidden = true;
      } else {
        // Genuinely empty kind, nothing narrowing the view: show it and say so.
        group.hidden = false;
        if (emptyLine) emptyLine.hidden = false;
      }
    });

    if (noMatch) noMatch.hidden = shown > 0 || !searching;
    if (count) {
      count.textContent = searching
        ? `${shown} of ${scope}`
        : `${scope} ${scope === 1 ? 'publication' : 'publications'}`;
    }
  };

  filters.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    kind = chip.getAttribute('data-filter');
    filters
      .querySelectorAll('[data-filter]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b === chip)));
    apply();
  });
  if (search) search.addEventListener('input', apply);

  // The layout switch is a state on one set of markup, not a second rendering,
  // so filtering and counting behave identically in both views.
  if (views) {
    views.addEventListener('click', (event) => {
      const button = event.target.closest('[data-view]');
      if (!button) return;
      list.setAttribute('data-view', button.getAttribute('data-view'));
      views
        .querySelectorAll('[data-view]')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    });
  }

  apply();
}

function setupLightbox() {
  const grid = document.getElementById('gallery-grid');
  const lightbox = document.getElementById('lightbox');
  if (!grid || !lightbox) return;
  const lightboxImage = document.getElementById('lightbox-image');
  const lightboxCaption = document.getElementById('lightbox-caption');
  const lightboxClose = document.getElementById('lightbox-close');

  const closeLightbox = () => {
    lightbox.hidden = true;
    lightboxImage.removeAttribute('src');
  };
  grid.addEventListener('click', (event) => {
    const button = event.target.closest('.gallery-item');
    if (!button) return;
    const img = button.querySelector('img');
    const title = button.getAttribute('data-title') || img.alt;
    const category = button.getAttribute('data-category') || '';
    lightboxImage.src = img.src;
    lightboxImage.alt = title;
    lightboxCaption.textContent = category + ' · ' + title;
    lightboxImage.onload = () => {
      lightboxCaption.textContent =
        category + ' · ' + lightboxImage.naturalWidth + '×' + lightboxImage.naturalHeight;
    };
    lightbox.hidden = false;
    lightboxClose.focus();
  });
  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });
}

/* ---------- media search ---------- */

function setupMediaSearch() {
  const search = document.getElementById('media-search');
  const count = document.getElementById('media-count');
  if (!search) return;
  const cards = [...document.querySelectorAll('.media-card')];
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      const match =
        !query ||
        card.textContent.toLowerCase().includes(query) ||
        (card.dataset.search || '').includes(query);
      card.hidden = !match;
      if (match) visible++;
    });
    if (count) count.textContent = visible + (visible === 1 ? ' story' : ' stories');
  });
}

/* ---------- chrome ---------- */

function setupMenu() {
  const menuButton = document.querySelector('.menu-toggle');
  if (!menuButton) return;
  menuButton.addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-open');
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
}

// Each language is its own URL, so switching is a navigation rather than a
// re-render. data-lang-base is written by the build as the current page's
// path within its language, so the choice lands on the same page.
function setupLanguageSwitcher() {
  const select = document.getElementById('lang-select');
  if (!select) return;
  select.addEventListener('change', () => {
    const lang = select.value;
    const slugPath = select.getAttribute('data-lang-base') || '';
    window.location.href = lang === 'en' ? '/' + slugPath : '/' + lang + '/' + slugPath;
  });
}

/* ---------- boot ---------- */

// Before per-page URLs existed the site routed on #slug. Anyone arriving from
// an old bookmark or shared link lands on the home page with a stale fragment;
// send them to the real URL instead of silently showing the wrong section.
function redirectLegacyHash() {
  const hash = location.hash.slice(1);
  if (!hash) return false;
  const link = document.querySelector('.nav-tab[data-tab="' + CSS.escape(hash) + '"]');
  const href = link && link.getAttribute('href');
  if (!href || href === location.pathname) return false;
  location.replace(href);
  return true;
}

if (!redirectLegacyHash()) {
  refreshTextScales();
  let scaleFrame = 0;
  window.addEventListener('resize', () => {
    if (scaleFrame) return;
    scaleFrame = requestAnimationFrame(() => {
      scaleFrame = 0;
      refreshTextScales();
    });
  });
  setupMotion();
  setupMenu();
  setupLanguageSwitcher();
  setupMediaSearch();
  setupArchive();
  setupPublications();
  setupLightbox();
  showReveals(document);
}
