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
  const element = (type, props, ...children) => ({ type, props: props || {}, children });
  const context = {
    CMS: {
      registerPreviewStyle() {},
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

  const previewProps = (data) => ({
    entry: { get: () => ({ toJS: () => data }) },
    getAsset: (path) => ({ toString: () => path }),
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

  try {
    const homepage = templates.home.render.call({
      props: previewProps({
        heroImage: { image: '/hero.jpg' },
        intro: {
          title: 'Numeric title',
          lede: 'Numeric intro',
          eyebrow: 'Numeric eyebrow',
          eyebrowSize: 75,
          titleSize: 50,
          ledeSize: 125,
          textAlign: 'center',
          textPosition: 'middle',
        },
      }),
    });
    const homepageTitle = walk(homepage, 'h1')[0];
    if (homepageTitle?.props?.style?.fontSize !== '2.5rem') {
      failures.push('the Homepage preview must apply numeric title percentages');
    }

    const mywell = templates.mywell.render.call({
      props: previewProps({
        menuImage: { image: '/menu.jpg' },
        intro: {
          title: 'MyWell title',
          lede: 'MyWell intro',
          eyebrow: 'MyWell',
          eyebrowSize: 100,
          titleSize: 150,
          ledeSize: 100,
          textAlign: 'right',
          textPosition: 'top',
        },
      }),
    });
    const mywellTitle = walk(mywell, 'h1').find((node) => node.children.includes('MyWell title'));
    if (mywellTitle?.props?.style?.fontSize !== '5.1rem') {
      failures.push('the Section preview must apply numeric title percentages');
    }
  } catch (error) {
    failures.push(`the custom previews must render without errors: ${error.message}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log('CMS numeric controls and live previews are configured.');
