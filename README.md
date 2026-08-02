# marvi

The MARVI project site — [testpage.marvi.org.in](https://testpage.marvi.org.in)

A static site built from `index.html` plus the JSON files in `content/`. Editors
change content through the CMS at `/admin/`; a GitHub Action rebuilds and
deploys on every push to `main`.

## How it fits together

```
index.html          the template: all markup, all CSS. Not served directly.
content/*.json      everything editable, written by the CMS
  pages.json          the page registry — which pages exist, order, templates
src/hydrate.mjs     applies content + translations to a document
src/templates.mjs   renders CMS-created pages from blocks
src/app.mjs         browser behaviour (motion, gallery, lightbox, search)
scripts/build.mjs   renders _site/ — one file per page per language
scripts/verify.mjs  post-build checks; fails the deploy rather than shipping broken
```

`index.html` is a **template, not a page**. Opening it directly shows every
section stacked with no content applied. Build first, then look at `_site/`.

### Why there is a build

Pages used to be `#hash` routes in a single document. Fragments never reach the
server and are ignored for indexing, so the whole site — ten sections, fourteen
languages — was one indexable URL in English. The build emits a real document
per page per language (140 files) with its own title, description, canonical,
`hreflang` set and social card.

### Isomorphic rendering

`src/hydrate.mjs` and `src/templates.mjs` take an explicit `document` and touch
no globals, so the same code runs in the browser and under linkedom at build
time. Keep it that way — no `fetch`, no `localStorage`, no `window`. It is what
makes fourteen languages cheap: the build calls `applyLanguage()` once per
language before splitting into pages.

## Working on it

```bash
npm install
npm run build     # writes _site/
npm run serve     # build, then serve _site at http://localhost:8899
node scripts/verify.mjs
```

## Adding a page

Through the CMS: **Pages & navigation → Add page**, pick a template, fill in
the fields. It appears in the menu, gets its own URL, and is translated into
every language on the next build.

In the repo: add an entry to `content/pages.json`.

Pages marked `"template": "builtin"` are the ten original sections, whose
markup lives in `index.html`; only their menu name and position are editable.

## Adding a block type

Three places, deliberately — a block type is a code change, not a content one:

1. a renderer in `src/templates.mjs`
2. its text fields in `TEXT_FIELDS` (so the strings get translated)
3. a variant under `types:` in `admin/config.yml`

`scripts/verify.mjs` fails the build if the renderer and the translator
disagree about which strings a page has.

## Translation

`scripts/auto-translate.mjs` translates new or changed strings into 13
languages via GitHub Models, keyed on the English they were translated from, so
only the delta is ever sent. It runs on push; its commit triggers a second
deploy carrying the new translations.

English is always the runtime fallback — a missing translation shows English
rather than an empty page.

## Deployment

Push to `main` → `auto-translate` and `deploy` both run → `deploy` builds,
verifies, and publishes `_site/` to GitHub Pages. Publishing takes a minute or
two; it is no longer instant, which is the cost of pre-rendered pages.

Pages must be configured with **Source: GitHub Actions** (not "deploy from a
branch") for this to work.
