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
