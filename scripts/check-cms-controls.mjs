import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const config = read('admin/config.yml');
const admin = read('admin/index.html');
const failures = [];
const expectMatch = (value, pattern, message) => {
  if (!pattern.test(value)) failures.push(message);
};
const pageKeys = ['home', 'approach', 'bjs', 'groundwater', 'mywell', 'media', 'films', 'game', 'people', 'archive'];
let preview = '';
try {
  preview = read('admin/preview.js');
} catch {
  // Assertions below report the missing preview integration clearly.
}

expectMatch(config, /name: "pages"\s+label: "Pages"/, 'the CMS must expose one page-centric Pages collection');
for (const key of pageKeys) {
  expectMatch(
    config,
    new RegExp(`file: "content/pages/${key}\\.json"`),
    `the Pages collection must include ${key}.json`,
  );
  try {
    const page = JSON.parse(read(`content/pages/${key}.json`));
    if (!page.intro || !page.menuImage) failures.push(`${key}.json must own its intro and menu image`);
    if (page.intro?.titleSize !== 70) failures.push(`${key}.json must default its title to 70%`);
  } catch (error) {
    failures.push(`${key}.json must be valid JSON: ${error.message}`);
  }
}
for (const legacyFile of ['homepage', 'sections', 'media', 'films', 'partners', 'images', 'portraits', 'menu', 'gallery']) {
  if (existsSync(new URL(`../content/${legacyFile}.json`, import.meta.url))) {
    failures.push(`legacy content/${legacyFile}.json must be migrated into its owning page file`);
  }
}

const peoplePage = JSON.parse(read('content/pages/people.json'));
if (!Array.isArray(peoplePage.partners) || !Array.isArray(peoplePage.portraits)) {
  failures.push('people.json must own both partners and portraits');
}

for (const field of ['eyebrowSize', 'titleSize', 'ledeSize']) {
  const block = config.match(new RegExp(`name: "${field}"[\\s\\S]{0,220}`))?.[0] ?? '';
  expectMatch(block, /widget: "number"/, `${field} must use a numeric CMS widget`);
  const expectedDefault = field === 'titleSize' ? 70 : 100;
  expectMatch(
    block,
    new RegExp(`default: ${expectedDefault}`),
    `${field} must default to ${expectedDefault}%`,
  );
}

expectMatch(admin, /preview\.js/, 'the CMS admin must load its custom preview integration');
expectMatch(
  preview,
  /CMS\.registerPreviewTemplate\(key, createPagePreview\(key\)\)/,
  'each page file must register its own custom preview',
);

for (const field of ['eyebrowSize', 'titleSize', 'ledeSize', 'textAlign', 'textPosition']) {
  expectMatch(preview, new RegExp(field), `the preview must render changes to ${field}`);
}

if (preview) {
  const templates = {};
  const previewStyles = [];
  const element = (type, props, ...children) => ({ type, props: props || {}, children });
  const context = {
    CMS: {
      registerPreviewStyle(path) {
        previewStyles.push(path);
      },
      registerPreviewTemplate(name, component) {
        templates[name] = component;
      },
    },
    createClass(definition) {
      return definition;
    },
    h: element,
  };
  vm.runInNewContext(preview, context, { filename: 'admin/preview.js' });
  if (Object.keys(templates).sort().join(',') !== pageKeys.slice().sort().join(',')) {
    failures.push('all ten page files must register individual preview templates');
  }
  if (previewStyles.join(',') !== 'preview.css') {
    failures.push('the custom previews must register preview.css');
  }

  const previewProps = (data) => ({
    entry: { get: () => ({ toJS: () => data }) },
    getAsset: (path) => ({ toString: () => `resolved:${path}` }),
  });
  const walk = (node, type, results = []) => {
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, type, results));
      return results;
    }
    if (!node || typeof node !== 'object') return results;
    if (node.type === type) results.push(node);
    node.children?.forEach((child) => walk(child, type, results));
    return results;
  };

  const titleBases = { home: 5, ...Object.fromEntries(pageKeys.slice(1).map((key) => [key, 3.4])) };
  for (const [index, key] of pageKeys.entries()) {
    try {
      const data = JSON.parse(read(`content/pages/${key}.json`));
      const titleSize = 40 + index * 10;
      data.intro = {
        ...data.intro,
        eyebrowSize: 75,
        titleSize,
        ledeSize: 125,
        textAlign: 'center',
        textPosition: 'middle',
      };
      const rendered = templates[key].render.call({ props: previewProps(data) });
      const titles = walk(rendered, 'h1');
      const title = titles.find((node) => node.children.includes(data.intro.title));
      if (titles.length !== 1 || !title) {
        failures.push(`${key} preview must render its page title exactly once`);
      }
      const expectedTitleSize = `${Number((titleBases[key] * titleSize / 100).toFixed(3))}rem`;
      if (title?.props?.style?.fontSize !== expectedTitleSize) {
        failures.push(`${key} preview must apply its numeric title percentage`);
      }
      const intro = walk(rendered, 'div').find((node) => node.props.className === 'preview-intro');
      if (
        intro?.props?.style?.alignItems !== 'center' ||
        intro?.props?.style?.justifyContent !== 'center' ||
        intro?.props?.style?.textAlign !== 'center'
      ) {
        failures.push(`${key} preview must apply alignment and position controls`);
      }
      const hero = walk(rendered, 'section').find((node) => node.props.className === 'preview-hero');
      const expectedImage = key === 'home' ? data.heroImage?.image : data.menuImage?.image;
      if (!hero?.props?.style?.backgroundImage?.includes(`resolved:${expectedImage}`)) {
        failures.push(`${key} preview must resolve and render its editable page image`);
      }
      const summaries = walk(rendered, 'span').filter(
        (node) => node.props.className === 'preview-content-count',
      );
      if (summaries.length !== 1 || typeof summaries[0].children[0] !== 'string') {
        failures.push(`${key} preview must render its page-content summary`);
      }
    } catch (error) {
      failures.push(`${key} custom preview must render with its real page data: ${error.message}`);
    }
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log('All ten CMS page previews render with real content and editable controls.');
