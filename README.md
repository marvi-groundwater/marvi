# marvi

## How the site is built (block pages)

Every page is one file in `content/pages/` — `{ menuName, slug, order,
published, template, intro, heroImage, menuImage, blocks[] }`. The build
renders those files into `_site/`, one real URL per page per language:

```
npm run build     # content/pages/*.json -> _site/ (168 files)
npm run verify    # structural checks; fails rather than ship broken pages
node scripts/parity.mjs   # nothing the old site showed may be missing
npm run serve     # build + serve on :8912
```

**index.html is the chrome template only** (head, CSS, sidebar, footer,
lightbox). The panel markup still inside it is the migration's frozen input —
the build strips it and renders panels from the page files via
`src/templates.mjs`. Editing a panel in index.html changes nothing on the
built site; edit the page's JSON (or the CMS) instead.

Translation keys: strings translated under the old system keep their legacy
`data-i18n` keys via each block's `i18n` map — do not strip those maps, they
are what keep 13 languages alive while the translation provider is down.

**Those map keys use `__` where the field path has a dot** — `right__paragraphs__0`,
not `right.paragraphs.0`. Call sites still pass the dotted path; `i18nKey()` in
`src/templates.mjs` escapes it on the way in. This is not cosmetic. A CMS that
holds draft content flattened by `.` — Sveltia does — unflattens
`{"right.paragraphs.0": k}` into `{right: {paragraphs: [k]}}` on save, after
which the lookup returns `undefined` and the string silently loses its curated
translation in all 13 languages. A key with no dot is a fixed point of that
round trip. Keep it that way: if you add an `i18n` entry by hand, escape the
dots.

## Publication sections

The `publicationList` block holds ONE flat `items[]`; the headed sections on
the page are derived from each entry's `kind`, laid out in the order of
`sections[]` (`{ kind, title, note, empty }`). The grouping is computed, never
stored, which is what guarantees every publication appears exactly once — an
entry cannot be filed under two headings, and one whose `kind` matches no
section falls into the `otherLabel` catch-all rather than disappearing. An
editor is free to introduce a new kind; `scripts/parity.mjs` fails the deploy
if any publication ever stops appearing.

A section listed in `sections[]` stays on the page while it is empty: its chip
reads 0 and it shows its `empty` line. An empty section advertises that the
kind exists and can be filled, which a missing one cannot. The generated
catch-all is the exception — it appears only once something lands in it.

The chip filter and the search **intersect** rather than replace one another,
so picking a kind and then typing narrows within that kind. Both are
recomputed from the two pieces of state on every change rather than toggled
incrementally, which removes the class of bug where the visible list disagrees
with the controls above it.

`defaultView` (`list` | `cards`) decides how the page opens; the List/Cards
buttons switch `data-view` on `#publication-sections`. **Both views are the
same markup restyled** — nothing is re-rendered, so filtering, counting and
searching cannot disagree between them.

Sections are `<details>` and rest closed (`startCollapsed`, default on), so the
page opens as a contents list. Closed is a rendering state, not a filter: the
entries stay in the DOM, which is what lets the search reach them and what
keeps `parity.mjs` able to see every title. A search opens the sections holding
matches — it would look broken otherwise — and picking a single kind opens that
one. Returning to All resets to the resting state.

Chips match on `data-filter` / `data-section` — never on the button's text,
which is translated into 13 languages. The search *placeholder* is the one
string here that stays English on translated pages: `data-i18n` moves
textContent, and there is no placeholder equivalent (the media search has the
same gap).

## The brand badge

`content/site.json` holds `brand: { shape, tone }`, and `brandMark()` in
`src/templates.mjs` draws the badge from them at build time — an SVG, not an
uploaded image, so it stays sharp at every size and in the site's own colours.

The drawing is a section through the ground: the land surface, the water table
mounded under the middle, and the well descending through the crest. Two things
about it are load-bearing rather than decorative:

- **The land-surface line.** Without it a filled mound reads as a hill against
  a sky and the mark becomes a generic sunrise logo. With it, everything below
  is underground.
- **The well is a shaft, not a staked marker.** A stem standing above the
  ground with a ball on top reads as a map pin. It was one, briefly.

The drawing fills the badge and is clipped by it, so the water finds its level
in whatever silhouette holds it. That is why `shape` is safe to expose in the
CMS: every option is the same mark in a different vessel. Sizing belongs to the
`.brand-mark` box alone, so a smaller screen changes two numbers rather than
re-placing the artwork by hand.

## Translation

`scripts/auto-translate.mjs` translates new or changed strings into the 13
target languages, keyed on the English they were translated from — only the
delta is ever sent. Body-string keys are harvested from the rendered pages
themselves, so the translator and the renderer cannot disagree.

Provider (first match wins):

- `ANTHROPIC_API_KEY` → Claude via the official SDK (`claude-opus-5`;
  override with `TRANSLATE_MODEL`). In CI this comes from the repo secret of
  the same name — Settings → Secrets and variables → Actions.
- `MODELS_ENDPOINT` + `MODELS_TOKEN` + `MODELS_MODEL` → any OpenAI-compatible
  chat endpoint.
- Neither set → clean no-op; untranslated strings fall back to English.

Test the whole pipeline without a key (local stub, scratch i18n copy):

```
node scripts/test-translate.mjs
```

## The CMS

Sveltia CMS, vendored at `admin/sveltia-cms.js` rather than loaded from a CDN —
the build copies `admin/` into `_site/`, so it publishes with the site and
cannot change underfoot. It reads the same `admin/config.yml` Decap did.

**Signing in.** Editors need write access to this repository, then a GitHub
fine-grained personal access token — github.com/settings/personal-access-tokens,
scoped to this repository only, **Contents: read and write** — pasted into
"Sign In Using Access Token". There is no OAuth app and no server in the flow,
which is why there is no longer a Cloudflare Worker. GitHub caps these tokens
at about a year; when one expires the CMS simply stops saving with no warning,
and the fix is a new token.

`auth_methods: [token]` in the config is load-bearing. Remove it and Sveltia
falls back to Netlify's hosted OAuth client, which cannot work here.

**Editing locally** is "Work with Local Repository" (Chromium only, on
localhost — `npm run serve`, then http://127.0.0.1:8912/admin/). Pick the
**repository root**, not `_site/`, or you will edit files the next build
overwrites. `local_backend` / `decap-server` no longer applies; Sveltia ignores
it by design.

**The editor preview** is Sveltia's built-in one, styled with the site's own
CSS via `registerPreviewStyle` in `admin/preview.js`. The custom template that
rendered entries through `src/templates.mjs` is registered only behind
`/admin/?customPreview=1`, because Sveltia has been measured to accept such a
registration and never call it — and registering one replaces the working
built-in preview with a blank pane. If it ever does render, make it
unconditional again.

## Deployment

Push to `main` → `deploy.yml` builds, verifies (structure + migration
parity), and publishes `_site/` to GitHub Pages. `translate.yml` runs on
content changes; its commit triggers a second deploy carrying the new
translations. Publishing takes a minute or two.

Pages must be set to **Source: GitHub Actions** (not "deploy from a branch").
