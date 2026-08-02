# marvi

The MARVI project site — [testpage.marvi.org.in](https://testpage.marvi.org.in)

A static site built from `index.html` plus the JSON files in `content/pages/`.
Editors change content through the CMS at `/admin/`; a GitHub Action rebuilds
and deploys on every push to `main`.

## How it fits together

```
index.html            the template: markup, CSS, and the hydration/i18n code
layout-model.js       CMS layout values -> concrete photo/text placement
content/pages/*.json  one file per page, written by the CMS
content/i18n.json     translations, maintained by auto-translate
src/registry.mjs      derives the page list + order (shared by build & verify)
src/templates.mjs     renders CMS-created pages from blocks
src/app.mjs           browser behaviour after prerender (motion, lightbox, search)
scripts/prerender.mjs runs index.html in jsdom, once per language
scripts/build.mjs     splits each rendered document into one file per page
scripts/verify.mjs    post-build checks; fails the deploy rather than shipping broken
```

`index.html` is a **template, not a page**. Build first, then look at `_site/`.

### Why there is a build

Pages used to be `#hash` routes in a single document. Fragments never reach the
server and are ignored for indexing, so the whole site — twelve sections,
fourteen languages — was one indexable URL in English. The build emits a real
document per page per language (168 files) with its own title, description,
canonical, `hreflang` set and social card.

### Why it prerenders instead of re-implementing

The site already knows how to hydrate and translate itself, in the inline
scripts in `index.html`. `prerender.mjs` runs *that* code in jsdom rather than
keeping a second copy in Node — a second copy would drift the moment anyone
edited the page. Language selection works by seeding `localStorage` before the
scripts run, because that is how the page already chooses a language.

Consequence worth knowing: the build depends on those inline scripts staying
runnable outside a browser. `scripts/prerender.mjs` stubs the browser APIs they
touch (`matchMedia`, `IntersectionObserver`, `fetch`). If you add a new browser
API to that code, add a stub too, or the build fails loudly.

## Working on it

```bash
npm install
npm run build     # writes _site/
npm run serve     # build, then serve _site
node scripts/verify.mjs
```

## Adding a page

Add a file to `content/pages/`. The build reads the directory, so no code
change is needed — `index.html` carries a hardcoded fallback list only for
viewing the page unbuilt.

A page file with `template` and `blocks` is rendered by `src/templates.mjs`
from the block palette (text, heading, photo, photo pair, quote, numbers,
video, cards, steps, embed). The twelve original sections have hand-authored
markup in `index.html` instead.

Order follows the authored list first, then new pages alphabetically.

## Adding a block type

Three places, deliberately — a block type is a code change, not a content one:

1. a renderer in `src/templates.mjs`
2. its text fields in `TEXT_FIELDS` (so the strings get translated)
3. a variant under `types:` in `admin/config.yml`

`scripts/verify.mjs` fails the build if the renderer and the translator
disagree about which strings a page has.

## Translation

`scripts/auto-translate.mjs` translates new or changed strings, keyed on the
English they were translated from, so only the delta is ever sent. English is
always the runtime fallback.

> **Currently broken.** It calls GitHub Models, which is being retired
> (`github_models_retirement_brownout`). Runs have failed since 2026-07-31, so
> `publications` and `tools` have no translations yet. This needs a replacement
> provider.

## Deployment

Push to `main` → build → verify → publish `_site/` to GitHub Pages. Publishing
takes a minute or two; it is no longer instant, which is the cost of
pre-rendered pages.

Pages must be set to **Source: GitHub Actions**, not "deploy from a branch".
