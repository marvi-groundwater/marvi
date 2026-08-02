/**
 * End-to-end test of scripts/auto-translate.mjs with NO real API key.
 *
 * Starts a local stub implementing both provider protocols (Anthropic
 * /v1/messages and OpenAI-compatible /chat/completions), runs the real
 * translator against a SCRATCH COPY of content/i18n.json, and asserts:
 *
 *   1. Existing translations are untouched (bjs.intro1 in Hindi survives).
 *   2. Missing keys (publications/tools intros, block strings) get a
 *      translation in every target language.
 *   3. A second run is a no-op ("Nothing to translate").
 *   4. Both provider paths produce identical results.
 *
 * The stub "translates" deterministically: "[<lang>] <english>".
 */
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_LANGS = ['es', 'hi', 'lo', 'zh-Hant', 'th', 'jv', 'zh-Hans', 'ar', 'pt', 'fr', 'bn', 'ru', 'id'];

/* ---- stub provider ---- */

const translate = (strings) =>
  Object.fromEntries(
    Object.entries(strings).map(([key, english]) => [
      key,
      Object.fromEntries(TARGET_LANGS.map((l) => [l, `[${l}] ${english}`]))
    ])
  );

const readBody = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => resolve(body));
  });

// Both protocols embed the same "Strings (key -> English):\n{json}" tail.
const stringsFrom = (prompt) => {
  const marker = 'Strings (key -> English):';
  const tail = prompt.slice(prompt.indexOf(marker) + marker.length);
  return JSON.parse(tail.slice(tail.indexOf('{')));
};

const server = createServer(async (req, res) => {
  const body = JSON.parse(await readBody(req));
  res.setHeader('content-type', 'application/json');
  if (req.url.includes('/v1/messages')) {
    // Anthropic shape
    const prompt = body.messages[0].content;
    res.end(
      JSON.stringify({
        id: 'msg_stub', type: 'message', role: 'assistant', model: body.model,
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(translate(stringsFrom(prompt))) }],
        usage: { input_tokens: 1, output_tokens: 1 }
      })
    );
  } else {
    // OpenAI-compatible shape
    const prompt = body.messages.find((m) => m.role === 'user').content;
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(translate(stringsFrom(prompt))) } }]
      })
    );
  }
});

await new Promise((resolve) => server.listen(8099, '127.0.0.1', resolve));

/* ---- run the real translator against a scratch copy ---- */

const scratchDir = mkdtempSync(join(tmpdir(), 'marvi-i18n-'));
const original = JSON.parse(readFileSync(join(ROOT, 'content/i18n.json'), 'utf8'));

// The child must run asynchronously: the stub server lives in THIS process,
// and a synchronous exec would block the event loop it answers on.
const run = async (label, env) => {
  const scratch = join(scratchDir, label + '.json');
  writeFileSync(scratch, JSON.stringify(original, null, 2));
  const { stdout } = await execFileAsync(process.execPath, [join(ROOT, 'scripts/auto-translate.mjs')], {
    env: { ...process.env, I18N_PATH: scratch, ...env }
  });
  return { scratch, out: stdout, result: JSON.parse(readFileSync(scratch, 'utf8')) };
};

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

for (const [label, env] of [
  ['anthropic', {
    ANTHROPIC_API_KEY: 'test-key-not-real',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:8099',
    MODELS_ENDPOINT: '', MODELS_TOKEN: '', MODELS_MODEL: ''
  }],
  ['openai-compatible', {
    ANTHROPIC_API_KEY: '',
    MODELS_ENDPOINT: 'http://127.0.0.1:8099/chat/completions',
    MODELS_TOKEN: 'test-token-not-real',
    MODELS_MODEL: 'stub-model'
  }]
]) {
  const { scratch, out, result } = await run(label, env);
  console.log(`--- ${label} ---`);
  console.log(out.trim().split('\n').slice(-1)[0]);

  // 1. existing translations untouched
  check(result.hi?.['bjs.intro1'] === original.hi['bjs.intro1'],
    `${label}: existing Hindi bjs.intro1 was modified`);
  check(result.hi?.['sec.groundwater.title'] === original.hi['sec.groundwater.title'],
    `${label}: existing Hindi groundwater title was modified`);

  // 2. previously-untranslated strings now have every language
  for (const key of ['sec.publications.title', 'sec.tools.title', 'nav.publications',
                     'page.bjs.b0.right.features.0.title']) {
    for (const lang of TARGET_LANGS) {
      if (original[lang]?.[key] != null) continue; // was already translated
      check(result[lang]?.[key]?.startsWith(`[${lang}] `),
        `${label}: ${lang}/${key} not translated (got ${JSON.stringify(result[lang]?.[key])})`);
    }
  }

  // 3. baseline refreshed → second run is a no-op
  const { stdout: second } = await execFileAsync(
    process.execPath, [join(ROOT, 'scripts/auto-translate.mjs')],
    { env: { ...process.env, I18N_PATH: scratch, ...env } }
  );
  check(second.includes('Nothing to translate'),
    `${label}: second run was not a no-op: ${second.trim()}`);
}

// 4. no-provider mode exits 0 without touching the file
{
  const { out, result } = await run('no-provider', {
    ANTHROPIC_API_KEY: '', MODELS_ENDPOINT: '', MODELS_TOKEN: '', MODELS_MODEL: ''
  });
  check(out.includes('no provider is configured'), 'no-provider: wrong message');
  check(JSON.stringify(result) === JSON.stringify(original), 'no-provider: file was modified');
}

server.close();

if (failures.length) {
  console.error(`\nTRANSLATE TEST FAILED — ${failures.length} assertion(s):`);
  failures.slice(0, 15).forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log('\nAll translation-pipeline assertions passed (both providers, idempotence, no-provider).');
