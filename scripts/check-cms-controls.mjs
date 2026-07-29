import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const config = read('admin/config.yml');
const admin = read('admin/index.html');
const failures = [];
const expectMatch = (value, pattern, message) => {
  if (!pattern.test(value)) failures.push(message);
};
let preview = '';
try {
  preview = read('admin/preview.js');
} catch {
  // Assertions below report the missing preview integration clearly.
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
  /CMS\.registerPreviewTemplate\(['"]homepage['"]/,
  'the Homepage editor must register a custom preview',
);
expectMatch(
  preview,
  /CMS\.registerPreviewTemplate\(['"]sections['"]/,
  'the Section intros editor must register a custom preview',
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
    const homepage = templates.homepage.render.call({
      props: previewProps({
        heroImage: '/hero.jpg',
        heroTitle: 'Numeric title',
        heroBody: 'Numeric intro',
        eyebrow: 'Numeric eyebrow',
        eyebrowSize: 75,
        titleSize: 50,
        ledeSize: 125,
        textAlign: 'center',
        textPosition: 'middle',
      }),
    });
    const homepageTitle = walk(homepage, 'h1')[0];
    if (homepageTitle?.props?.style?.fontSize !== '2.5rem') {
      failures.push('the Homepage preview must apply numeric title percentages');
    }

    const sections = templates.sections.render.call({
      props: previewProps({
        mywell: {
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
    const mywellTitle = walk(sections, 'h1').find((node) => node.children.includes('MyWell title'));
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
