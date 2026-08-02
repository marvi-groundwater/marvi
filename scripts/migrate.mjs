/**
 * One-time migration: hand-authored panels + per-page JSON → block pages.
 *
 * Input:  index.html (authored panel markup) + content/pages/<id>.json (v1)
 * Output: content/pages/<id>.json (v2) — { menuName, slug, order, published,
 *         template, intro, heroImage, menuImage, hero?, blocks[] }
 *
 * Two invariants this must hold:
 *
 * 1. NOTHING IS DROPPED. Every visible string, image and link in the authored
 *    panels ends up in a block (scripts/parity.mjs asserts this after build).
 *
 * 2. TRANSLATION KEYS SURVIVE. Authored strings carry data-i18n keys that
 *    content/i18n.json indexes 13 languages by. Each migrated string stores
 *    its legacy key in the block's `i18n` map, and the renderer re-emits it —
 *    with the translation provider dead (GitHub Models retiring), a dropped
 *    key would mean silently losing that string in every language, with no
 *    way to regenerate it.
 *
 * Idempotent: a page whose JSON already has `blocks` is left untouched.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES_DIR = join(ROOT, 'content/pages');

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const doc = parseHTML(html).document;

/* ---------- small extract helpers ---------- */

const txt = (n) => (n ? n.textContent.trim() : undefined);
const key = (n) => (n ? n.getAttribute('data-i18n') || undefined : undefined);
/** Text with <br> preserved as \n (hero title, image labels). */
const multiline = (n) =>
  n
    ? [...n.childNodes].map((c) => (c.nodeName === 'BR' ? '\n' : c.textContent)).join('').trim()
    : undefined;
const src = (n) => (n ? n.getAttribute('src') : undefined);
const panel = (id) => doc.querySelector(`[data-panel="${id}"]`);

/** Collect {text, i18nKey} for a node; push key into the block's i18n map. */
const grab = (i18n, field, node, { ml = false } = {}) => {
  if (!node) return undefined;
  const k = key(node);
  if (k) i18n[field] = k;
  return ml ? multiline(node) : txt(node);
};

/**
 * The authored markup references CMS photo slots via data-img; the JSON keeps
 * the photo entries (image + crop) under page.images. Resolve a slot to its
 * full entry, falling back to the authored src so nothing renders blank.
 */
const slotEntry = (page, imagesKey, imgNode) => {
  const entry = (page.images || {})[imagesKey];
  if (entry && entry.image) return { alt: imgNode?.getAttribute('alt') || '', ...entry };
  return { image: src(imgNode), alt: imgNode?.getAttribute('alt') || '' };
};

/** data-open buttons become page links. */
const actionsFrom = (scope) =>
  [...(scope?.querySelectorAll('[data-open]') || [])].map((b) => ({
    label: (b.childNodes[0] ? b.childNodes[0].textContent : b.textContent).trim(),
    page: b.getAttribute('data-open'),
    primary: b.className.includes('primary')
  }));

/** Trailing source-note <p>: alternate text / link parts. */
const sourceNote = (p) => {
  if (!p) return null;
  const parts = [...p.childNodes].map((n) =>
    n.nodeName === 'A'
      ? {
          link: {
            label: n.textContent.trim(),
            url: n.getAttribute('href'),
            download: n.hasAttribute('download') || undefined,
            external: n.getAttribute('target') === '_blank' || undefined
          }
        }
      : { text: n.textContent }
  ).filter((part) => part.link || part.text.trim() || part.text.includes(' '));
  // keep the authored inline spacing/colour so the note renders identically
  return { type: 'sourceNote', style: p.getAttribute('style') || undefined, parts };
};

/** Codex "flexible sections" already ARE blocks — carry them over verbatim. */
const flexBlocks = (page) =>
  (Array.isArray(page.sections) ? page.sections : []).filter((s) => s && s.type);

/* ---------- per-page extractors (authored structure → blocks) ---------- */

const extractors = {
  home(page) {
    const p = panel('home');
    const i18nHero = {};
    const heroCopy = p.querySelector('.hero-copy-inner');
    const stage = p.querySelector('.hero-image-stage');
    const hero = {
      label: grab(i18nHero, 'label', p.querySelector('.hero-image-label'), { ml: true }),
      caption: grab(i18nHero, 'caption', p.querySelector('.hero-image-caption'), { ml: true }),
      stageAlt: stage?.getAttribute('aria-label') || '',
      imageAlt: p.querySelector('.hero-image-main')?.getAttribute('alt') || '',
      // v1 kept editable button labels at the top level; they win over the
      // authored fallback text, matching the old runtime.
      actions: actionsFrom(heroCopy).map((a, i) => ({
        ...a,
        label: (i === 0 ? page.primaryButtonLabel : page.secondaryButtonLabel) || a.label
      })),
      i18n: i18nHero
    };

    const blocks = [];
    {
      const i18n = {};
      const st = p.querySelector('.home-statement');
      blocks.push({
        type: 'statement',
        label: grab(i18n, 'label', st.querySelector('.meta')),
        quote: grab(i18n, 'quote', st.querySelector('blockquote')),
        metrics: [...st.querySelectorAll('.metric')].map((m, idx) => ({
          value: txt(m.querySelector('strong')),
          label: grab(i18n, `metrics.${idx}.label`, m.querySelector('span'))
        })),
        i18n
      });
    }
    {
      const i18n = {};
      const ex = p.querySelector('.home-explore');
      blocks.push({
        type: 'storyCards',
        eyebrow: grab(i18n, 'eyebrow', ex.querySelector('.explore-head .eyebrow')),
        title: grab(i18n, 'title', ex.querySelector('.explore-head h2')),
        lede: grab(i18n, 'lede', ex.querySelector('.explore-head > p, .explore-head p:last-child')),
        items: [...ex.querySelectorAll('.story-card')].map((card, idx) => {
          const img = card.querySelector('img');
          return {
            page: card.getAttribute('data-open'),
            label: grab(i18n, `items.${idx}.label`, card.querySelector('.meta')),
            title: grab(i18n, `items.${idx}.title`, card.querySelector('strong')),
            photo: slotEntry(page, 'story' + capital(card.getAttribute('data-open')), img)
          };
        }),
        i18n
      });
    }
    return { template: 'home', hero, blocks: [...blocks, ...flexBlocks(page)] };
  },

  approach(page) {
    const p = panel('approach');
    const blocks = [];
    {
      const i18n = {};
      const cols = [...p.querySelectorAll('.split > .prose')];
      blocks.push({
        type: 'split',
        left: { kind: 'prose', lead: grab(i18n, 'left.lead', cols[0].querySelector('p.large')) },
        right: {
          kind: 'prose',
          paragraphs: [...cols[1].querySelectorAll('p')].map((n, idx) =>
            grab(i18n, `right.paragraphs.${idx}`, n)
          )
        },
        i18n
      });
    }
    blocks.push(cardsBlock(p));
    {
      const figs = [...p.querySelectorAll('.editorial-images figure')];
      const i18n = {};
      blocks.push({
        type: 'imagePair',
        look: 'editorial',
        items: figs.map((f, idx) => ({
          photo: slotEntry(page, 'editorial' + (idx + 1), f.querySelector('img')),
          caption: grab(i18n, `items.${idx}.caption`, f.querySelector('figcaption'))
        })),
        i18n
      });
    }
    blocks.push(stepsBlock(p));
    return { template: 'standard', blocks: [...blocks, ...flexBlocks(page)] };
  },

  bjs(page) {
    const p = panel('bjs');
    const i18n = {};
    const dp = p.querySelector('.image-data-panel');
    const prose = p.querySelector('.split .prose');
    const block = {
      type: 'split',
      left: {
        kind: 'dataPanel',
        photo: slotEntry(page, 'dataPanel', dp.querySelector('img')),
        stat: txt(dp.querySelector('.image-data-overlay strong')),
        caption: grab(i18n, 'left.caption', dp.querySelector('.image-data-overlay span'))
      },
      right: {
        kind: 'prose',
        lead: grab(i18n, 'right.lead', prose.querySelector('p.large')),
        paragraphs: [...prose.querySelectorAll(':scope > p:not(.large)')].map((n, idx) =>
          grab(i18n, `right.paragraphs.${idx}`, n)
        ),
        features: [...prose.querySelectorAll('.feature-item')].map((f, idx) => ({
          number: txt(f.querySelector(':scope > span')),
          title: grab(i18n, `right.features.${idx}.title`, f.querySelector('strong')),
          text: grab(i18n, `right.features.${idx}.text`, f.querySelector('small'))
        }))
      },
      i18n
    };
    return { template: 'standard', blocks: [block, ...flexBlocks(page)] };
  },

  groundwater(page) {
    const p = panel('groundwater');
    const blocks = [];
    blocks.push({
      type: 'photoRibbon',
      items: [...p.querySelectorAll('.photo-ribbon figure img')].map((img, idx) =>
        ({ photo: slotEntry(page, 'ribbon' + (idx + 1), img) })
      )
    });
    blocks.push(bannerBlock(p.querySelector('.dark-block')));
    blocks.push(cardsBlock(p));
    return { template: 'standard', blocks: [...blocks, ...flexBlocks(page)] };
  },

  mywell(page) {
    const p = panel('mywell');
    const blocks = [];
    {
      const i18n = {};
      const prose = p.querySelector('.split .prose');
      const logo = prose.querySelector('img.app-logo');
      blocks.push({
        type: 'split',
        left: {
          kind: 'prose',
          logo: logo ? { image: src(logo), alt: logo.getAttribute('alt') || '' } : undefined,
          lead: grab(i18n, 'left.lead', prose.querySelector('p.large')),
          paragraphs: [...prose.querySelectorAll(':scope > p:not(.large)')].map((n, idx) =>
            grab(i18n, `left.paragraphs.${idx}`, n)
          ),
          actions: actionsFrom(prose)
        },
        right: {
          kind: 'image',
          look: 'app-shot',
          photo: slotEntry(page, 'main', p.querySelector('.app-shot img'))
        },
        i18n
      });
    }
    blocks.push({
      type: 'imagePair',
      look: 'screens',
      items: [...p.querySelectorAll('.app-screen-strip figure img')].map((img, idx) => ({
        photo: slotEntry(page, 'strip' + (idx + 1), img)
      }))
    });
    blocks.push(stepsBlock(p));
    return { template: 'standard', blocks: [...blocks, ...flexBlocks(page)] };
  },

  media(page) {
    const p = panel('media');
    return {
      template: 'standard',
      blocks: [
        { type: 'mediaStories', items: page.items || [] },
        sourceNote(p.querySelector('.section-body > p')),
        ...flexBlocks(page)
      ].filter(Boolean)
    };
  },

  films(page) {
    const p = panel('films');
    return {
      template: 'standard',
      blocks: [
        { type: 'filmGrid', items: page.items || [] },
        sourceNote(p.querySelector('.section-body > p')),
        ...flexBlocks(page)
      ].filter(Boolean)
    };
  },

  game(page) {
    const p = panel('game');
    const img = p.querySelector('.game-frame img');
    return {
      template: 'standard',
      blocks: [
        { type: 'framedShot', photo: slotEntry(page, 'game', img) },
        cardsBlock(p),
        ...flexBlocks(page)
      ]
    };
  },

  people(page) {
    const p = panel('people');
    return {
      template: 'standard',
      blocks: [
        { type: 'portraitBand', items: page.portraits || [] },
        { type: 'partnerList', items: page.partners || [] },
        bannerBlock(p.querySelector('.dark-block')),
        ...flexBlocks(page)
      ]
    };
  },

  archive(page) {
    const p = panel('archive');
    return {
      template: 'standard',
      blocks: [
        { type: 'photoArchive', items: page.items || [] },
        sourceNote(p.querySelector('.section-body > p')),
        ...flexBlocks(page)
      ].filter(Boolean)
    };
  },

  publications(page) {
    const p = panel('publications');
    return {
      template: 'standard',
      blocks: [
        { type: 'publicationList', items: page.items || [] },
        sourceNote(p.querySelector('.section-body > p')),
        ...flexBlocks(page)
      ].filter(Boolean)
    };
  },

  tools(page) {
    return {
      template: 'standard',
      blocks: [{ type: 'toolList', items: page.items || [] }, ...flexBlocks(page)]
    };
  }
};

/* shared structures that repeat across panels */

function capital(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function cardsBlock(p) {
  const i18n = {};
  const block = {
    type: 'cards',
    items: [...p.querySelectorAll('.grid-3 .project-card')].map((card, idx) => ({
      number: txt(card.querySelector('.card-number')),
      title: grab(i18n, `items.${idx}.title`, card.querySelector('h3')),
      text: grab(i18n, `items.${idx}.text`, card.querySelector('p'))
    })),
    i18n
  };
  return block;
}

function stepsBlock(p) {
  const i18n = {};
  return {
    type: 'steps',
    items: [...p.querySelectorAll('.process-step')].map((s, idx) => ({
      title: grab(i18n, `items.${idx}.title`, s.querySelector('h3')),
      text: grab(i18n, `items.${idx}.text`, s.querySelector('p'))
    })),
    i18n
  };
}

function bannerBlock(darkBlock) {
  const i18n = {};
  const eyebrow = darkBlock.querySelector('.eyebrow');
  // groundwater's eyebrow carries a one-off accent colour inline.
  const accentMatch = (eyebrow?.getAttribute('style') || '').match(/color:\s*([^;]+)/);
  return {
    type: 'banner',
    eyebrow: grab(i18n, 'eyebrow', eyebrow),
    accent: accentMatch ? accentMatch[1].trim() : undefined,
    title: grab(i18n, 'title', darkBlock.querySelector('h2')),
    lede: grab(i18n, 'lede', darkBlock.querySelector('.lede')),
    i18n
  };
}

/* ---------- nav order + names come from the authored sidebar ---------- */

const navTabs = [...doc.querySelectorAll('.nav-tab')];
const navOrder = navTabs.map((t) => t.getAttribute('data-tab'));
const navName = Object.fromEntries(
  navTabs.map((t) => [t.getAttribute('data-tab'), txt(t.querySelector('.nav-name'))])
);

/* ---------- run ---------- */

const prune = (v) => {
  // strip undefined and empty i18n maps so the files stay readable
  if (Array.isArray(v)) return v.map(prune);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) continue;
      if (k === 'i18n' && val && Object.keys(val).length === 0) continue;
      out[k] = prune(val);
    }
    return out;
  }
  return v;
};

let migrated = 0;
for (const file of readdirSync(PAGES_DIR).filter((f) => f.endsWith('.json'))) {
  const id = file.replace(/\.json$/, '');
  const path = join(PAGES_DIR, file);
  const page = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(page.blocks)) {
    console.log(`skip ${id} (already migrated)`);
    continue;
  }
  const extract = extractors[id];
  if (!extract) {
    console.warn(`no extractor for "${id}" — leaving as-is`);
    continue;
  }
  const { template, hero, blocks } = extract(page);
  const v2 = prune({
    menuName: navName[id] || id,
    slug: id,
    order: navOrder.indexOf(id) + 1 || 99,
    published: true,
    template,
    intro: page.intro,
    heroImage: page.heroImage,
    menuImage: page.menuImage,
    ...(hero ? { hero } : {}),
    blocks
  });
  writeFileSync(path, JSON.stringify(v2, null, 2) + '\n');
  migrated++;
  console.log(`migrated ${id}: ${blocks.length} block(s)`);
}
console.log(`\n${migrated} page(s) migrated.`);
