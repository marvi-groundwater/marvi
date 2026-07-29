import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const config = read('admin/config.yml');
const admin = read('admin/index.html');
const site = read('index.html');
const layoutModel = read('layout-model.js');
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
    if (!page.intro || !page.heroImage || !page.menuImage) {
      failures.push(`${key}.json must own its intro, hero image, and menu image`);
    }
    if (!Array.isArray(page.sections)) failures.push(`${key}.json must expose addable page sections`);
    if (page.intro?.titleSize !== 70) failures.push(`${key}.json must default its title to 70%`);
    for (const field of ['textWidth', 'textOffsetX', 'textOffsetY']) {
      if (!Number.isFinite(page.intro?.[field])) failures.push(`${key}.json must define numeric ${field}`);
    }
    for (const field of ['zoom', 'positionX', 'positionY']) {
      if (!Number.isFinite(page.heroImage?.[field])) {
        failures.push(`${key}.json hero image must define numeric ${field}`);
      }
    }
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
if (peoplePage.partners.some((partner) => !partner.name || !partner.url)) {
  failures.push('every partner must have a name and clickable website URL');
}
if (
  peoplePage.portraits.some(
    (person) => !person.name || !person.title || !person.affiliation || !person.url || !person.image,
  )
) {
  failures.push('every portrait must have editable identity, affiliation, link, and photo data');
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
for (const field of ['textWidth', 'textOffsetX', 'textOffsetY', 'zoom', 'positionX', 'positionY']) {
  const block = config.match(new RegExp(`name: "${field}"[\\s\\S]{0,240}`))?.[0] ?? '';
  expectMatch(block, /widget: "number"/, `${field} must use a numeric CMS widget`);
}

expectMatch(admin, /preview\.js/, 'the CMS admin must load its custom preview integration');
expectMatch(admin, /\.\.\/layout-model\.js/, 'the CMS preview must load the shared layout model');
expectMatch(site, /src="layout-model\.js"/, 'the website must load the shared layout model');
expectMatch(site, /MarviLayout\.photo/, 'the website must apply the shared numeric photo model');
expectMatch(site, /MarviLayout\.text/, 'the website must apply the shared numeric text model');
expectMatch(site, /renderFlexibleSections/, 'the website must render addable page sections');
expectMatch(site, /portrait-card-info/, 'the website must render hover details for each portrait');
expectMatch(site, /Visit.*partner.*website/, 'the website must make configured partner cards clickable');
for (const type of ['text', 'imageText', 'gallery', 'callout', 'button']) {
  expectMatch(config, new RegExp(`name: "${type}"`), `the CMS must offer the ${type} page-section type`);
}
expectMatch(
  preview,
  /CMS\.registerPreviewTemplate\(key, createPagePreview\(key\)\)/,
  'each page file must register its own custom preview',
);

expectMatch(
  preview,
  /marvi:cms-preview/,
  'the CMS preview must send unsaved page data to the live site renderer',
);
expectMatch(
  site,
  /marvi:cms-preview/,
  'the live site renderer must accept unsaved CMS preview data',
);
expectMatch(
  preview,
  /marvi:cms-preview-ready/,
  'the CMS preview must wait until the live site renderer is ready',
);
expectMatch(
  site,
  /marvi:cms-preview-ready/,
  'the live site renderer must announce when it can accept preview data',
);

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
    window: { location: { origin: 'https://preview.example' } },
  };
  vm.runInNewContext(layoutModel, context, { filename: 'layout-model.js' });
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
        textWidth: 65,
        textOffsetX: -20,
        textOffsetY: 15,
      };
      data.heroImage = {
        ...data.heroImage,
        zoom: 135,
        positionX: 27,
        positionY: 68,
        fit: 'contain',
      };
      data.sections = [
        { type: 'text', eyebrow: 'Added', heading: 'Text section', body: 'First paragraph.\\n\\nSecond paragraph.', align: 'center' },
        {
          type: 'imageText',
          heading: 'Image and text',
          body: 'Flexible image copy.',
          photo: { image: '/flexible.jpg', zoom: 120, positionX: 25, positionY: 75, fit: 'cover' },
          photoSide: 'right',
        },
        {
          type: 'gallery',
          heading: 'Gallery',
          photos: [{ image: '/gallery.jpg', zoom: 100, positionX: 50, positionY: 50, fit: 'cover' }],
        },
        { type: 'callout', heading: 'Callout', body: 'Important message.', tone: 'green' },
        { type: 'button', heading: 'Next step', label: 'Learn more', url: 'https://example.com' },
      ];
      const component = templates[key];
      const instance = { ...component, props: previewProps(data), previewFrame: null };
      if (
        typeof component.componentDidMount !== 'function' ||
        typeof component.componentWillUnmount !== 'function'
      ) {
        failures.push(`${key} preview must manage its live-renderer readiness listener`);
      }
      const rendered = component.render.call(instance);
      const frame = walk(rendered, 'iframe').find(
        (node) => node.props.className === 'preview-live-frame',
      );
      if (frame?.props?.src !== `../?cms-preview=1#${key}`) {
        failures.push(`${key} preview must load the matching real website page`);
      }

      const posted = [];
      instance.previewFrame = {
        contentWindow: {
          postMessage(message, origin) {
            posted.push({ message, origin });
          },
        },
      };
      component.sendPreviewData.call(instance);
      const delivery = posted[0];
      const payload = delivery?.message;
      if (
        delivery?.origin !== 'https://preview.example' ||
        payload?.type !== 'marvi:cms-preview' ||
        payload?.key !== key
      ) {
        failures.push(`${key} preview must deliver its unsaved entry to the live renderer`);
      }
      if (
        payload?.data?.intro?.title !== data.intro.title ||
        payload?.data?.intro?.titleSize !== titleSize ||
        payload?.data?.intro?.textWidth !== 65 ||
        payload?.data?.intro?.textOffsetX !== -20 ||
        payload?.data?.intro?.textOffsetY !== 15
      ) {
        failures.push(`${key} preview must preserve all unsaved numeric text controls`);
      }
      if (
        payload?.data?.heroImage?.image !== `resolved:${data.heroImage.image}` ||
        payload?.data?.heroImage?.zoom !== 135 ||
        payload?.data?.heroImage?.positionX !== 27 ||
        payload?.data?.heroImage?.positionY !== 68 ||
        payload?.data?.heroImage?.fit !== 'contain'
      ) {
        failures.push(`${key} preview must preserve and resolve numeric hero photo controls`);
      }
      if (payload?.data?.sections?.[1]?.photo?.image !== 'resolved:/flexible.jpg') {
        failures.push(`${key} preview must resolve photos in added sections`);
      }
      if (key === 'people') {
        const firstPerson = data.portraits[0];
        if (
          payload?.data?.portraits?.[0]?.name !== firstPerson.name ||
          payload?.data?.portraits?.[0]?.url !== firstPerson.url ||
          payload?.data?.partners?.[0]?.url !== data.partners[0].url
        ) {
          failures.push('the People preview must deliver editable identity and link data');
        }
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

console.log('All ten CMS page previews use the live site renderer with editable controls.');
