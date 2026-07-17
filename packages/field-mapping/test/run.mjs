#!/usr/bin/env node
/**
 * Engine unit tests — generic, no host-project dependencies. Every mapping
 * primitive gets at least one assertion. Run: node test/run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import {
  runMapping,
  validateMapping,
  slugify,
  splitList,
  parseFaqPairs,
  looksLikeUrl,
} from '../index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${name}`);
    console.error(String(err.message).split('\n').map((l) => `        ${l}`).join('\n'));
  }
};
const M = (fields, extra = {}) => ({ format: 'stardrive-field-mapping/v1', fields, ...extra });

console.log('helpers:');
check('slugify', () => {
  assert.strictEqual(slugify('Acme & Sons, LLC!'), 'acme-and-sons-llc');
});
check('splitList drops filler answers', () => {
  assert.deepStrictEqual(splitList('a; b,none\nc, n/a'), ['a', 'b', 'c']);
});
check('parseFaqPairs handles Q:/A: blocks and alternating lines', () => {
  assert.deepStrictEqual(parseFaqPairs('Q: One?\nA: Yes.'), [{ q: 'One?', a: 'Yes.' }]);
  assert.deepStrictEqual(parseFaqPairs('Two?\nAlso yes.'), [{ q: 'Two?', a: 'Also yes.' }]);
});
check('looksLikeUrl accepts https and www forms only', () => {
  assert.strictEqual(looksLikeUrl('https://x.co'), true);
  assert.strictEqual(looksLikeUrl('www.x.co/page'), true);
  assert.strictEqual(looksLikeUrl('x.co'), false);
});

console.log('resolution:');
check('code prefix match beats fuzzy; Q1 never matches Q10', () => {
  const r = runMapping(
    M([
      { id: 'a', source: { code: 'Q1', hint: 'name' }, target: 'config.a' },
      { id: 'b', source: { code: 'Q10' }, target: 'config.b' },
    ]),
    { 'Q10. The tenth': 'ten', 'Q1. The name': 'one' }
  );
  assert.deepStrictEqual(r.config, { a: 'one', b: 'ten' });
  assert.deepStrictEqual(r.mapReport.map((m) => m.how), ['code', 'code']);
});
check('fuzzy fallback resolves and is reported', () => {
  const r = runMapping(M([{ id: 'a', source: { code: 'Q1', hint: 'business name' }, target: 'config.a' }]), {
    'What is your business name?': 'Acme',
  });
  assert.strictEqual(r.config.a, 'Acme');
  assert.deepStrictEqual(r.mapReport, [{ field: 'a', code: 'Q1', how: 'fuzzy' }]);
});
check('array answers flatten with a comma join', () => {
  const r = runMapping(M([{ id: 'a', source: { code: 'Q1' }, target: 'config.a' }]), { Q1: ['x', 'y'] });
  assert.strictEqual(r.config.a, 'x, y');
});

console.log('value handling:');
check('skipIf, validate, required → unmapped', () => {
  const r = runMapping(
    M([
      { id: 'tag', source: { code: 'Q1' }, skipIf: '^(no|none)$', target: 'config.tag' },
      { id: 'mail', source: { code: 'Q2' }, validate: 'email', target: 'config.mail', required: true },
    ]),
    { Q1: 'None', Q2: 'not-an-email' }
  );
  assert.deepStrictEqual(r.config, {});
  assert.deepStrictEqual(r.unmapped, ['mail (Q2)']);
});
check('fallback scan recovers a value, honoring excludeCodes', () => {
  const r = runMapping(
    M([
      {
        id: 'site',
        source: { code: 'Q1' },
        fallback: { scan: 'values', validate: 'url', trigger: 'empty', excludeCodes: '^SOC' },
        validate: 'url',
        target: 'config.site',
      },
    ]),
    { Q1: '', 'SOC-1': 'https://social.example', Q9: 'https://real.example' }
  );
  assert.strictEqual(r.config.site, 'https://real.example');
});
check('transforms pipeline: splitList → limit → asNames', () => {
  const r = runMapping(
    M([{ id: 'l', source: { code: 'Q1' }, transform: ['splitList', 'limit:2', 'asNames'], target: 'config.l' }]),
    { Q1: 'a, b, c' }
  );
  assert.deepStrictEqual(r.config.l, [{ name: 'a' }, { name: 'b' }]);
});
check('writeEmpty writes empty strings; empty results are dropped otherwise', () => {
  const r = runMapping(
    M([
      { id: 'a', source: { code: 'Q1' }, target: 'contact.name', writeEmpty: true },
      { id: 'b', source: { code: 'Q2' }, target: 'config.b' },
    ]),
    {}
  );
  assert.deepStrictEqual(r.contact, { name: '' });
  assert.deepStrictEqual(r.config, {});
});

console.log('logic:');
check('chain: first match wins, later rules skipped', () => {
  const r = runMapping(
    M([
      { id: 'src', source: { code: 'Q1' } },
      {
        id: 'c',
        chain: {
          input: 'src',
          rules: [
            { match: 'brand', set: [{ target: 'flags.ingest', value: true }] },
            { match: 'teal', set: [{ target: 'config.preset', value: 'slate-teal' }] },
          ],
        },
      },
    ]),
    { Q1: 'Match our brand teal' }
  );
  assert.deepStrictEqual(r.flags, { ingest: true });
  assert.deepStrictEqual(r.config, {});
});
check('table: rules over joined lowercased inputs, default + templated notes', () => {
  const m = M([
    { id: 'a', source: { code: 'Q1' } },
    { id: 'b', source: { code: 'Q2' } },
    {
      id: 't',
      table: {
        inputs: ['a', 'b'],
        target: 'config.pairing',
        rules: [{ value: 'warm', match: 'craft' }],
        default: 'modern',
        noteOnMatch: 'Picked {result} from "{in0|n/a}"{?in1: + "{in1}"}.',
        noteOnDefault: 'Defaulted{!in0: (no direction)}.',
      },
    },
  ]);
  const hit = runMapping(m, { Q1: '', Q2: 'Handmade CRAFT feel' });
  assert.strictEqual(hit.config.pairing, 'warm');
  assert.deepStrictEqual(hit.notes, ['Picked warm from "n/a" + "Handmade CRAFT feel".']);
  const miss = runMapping(m, {});
  assert.strictEqual(miss.config.pairing, 'modern');
  assert.deepStrictEqual(miss.notes, ['Defaulted (no direction).']);
});
check('append sets + array policy (prepend base, note, writeEmpty)', () => {
  const m = M([
    {
      id: 'mod',
      source: { code: 'Q1' },
      set: [{ append: 'config.modules', value: 'menu', when: 'yes' }],
      notes: [{ when: 'unsure', text: 'unsure noted' }],
    },
    {
      id: 'p',
      array: {
        path: 'config.modules',
        prependIfAny: ['core'],
        writeEmpty: true,
        noteIfAny: 'Modules: {items}.',
        noteIfEmpty: 'None.',
      },
    },
  ]);
  const yes = runMapping(m, { Q1: 'Yes please' });
  assert.deepStrictEqual(yes.config.modules, ['core', 'menu']);
  assert.deepStrictEqual(yes.notes, ['Modules: menu.']);
  const unsure = runMapping(m, { Q1: 'Not sure yet' });
  assert.deepStrictEqual(unsure.config.modules, []);
  assert.deepStrictEqual(unsure.notes, ['unsure noted', 'None.']);
});
check('entry when-gates: fieldYes skips the read entirely; outputIncludes sees arrays', () => {
  const m = M([
    { id: 'want', source: { code: 'Q1' } },
    {
      id: 'detail',
      when: { fieldYes: 'want' },
      source: { code: 'Q2' },
      set: [{ target: 'flags.detail', value: '{value|see form}' }],
    },
  ]);
  const no = runMapping(m, { Q1: 'No', Q2: 'ignored' });
  assert.strictEqual(no.mapReport.length, 1);
  assert.deepStrictEqual(no.flags, {});
  const yes = runMapping(m, { Q1: 'Yes', Q2: '' });
  assert.deepStrictEqual(yes.flags, { detail: 'see form' });
});
check('derived + cross-field template refs + writeWhen group gate', () => {
  const m = M(
    [
      { id: 'action', source: { code: 'Q1' } },
      {
        id: 'topics',
        source: { code: 'Q2' },
        transform: ['splitList', 'limit:2'],
        target: 'config.quote.topics',
        writeEmpty: true,
        writeWhen: { anyFieldPresent: ['action', 'topics'] },
        set: [{ target: 'config.quote.enabled', value: true, when: { anyFieldPresent: ['action', 'topics'] } }],
        notes: [
          { when: { fieldPresent: 'action' }, text: 'Action: "{fields.action}"{?quoteFirst: — quote-first}.' },
        ],
      },
    ],
    { derived: [{ id: 'quoteFirst', anyOf: [{ field: 'action', match: 'quote' }, { field: 'topics' }] }] }
  );
  const both = runMapping(m, { Q1: 'Book a call', Q2: 'fences, decks' });
  assert.deepStrictEqual(both.config.quote, { topics: ['fences', 'decks'], enabled: true });
  assert.deepStrictEqual(both.notes, ['Action: "Book a call" — quote-first.']);
  const neither = runMapping(m, {});
  assert.deepStrictEqual(neither.config, {});
});
check('links: labeled codes filtered by validator', () => {
  const r = runMapping(
    M([
      {
        id: 'social',
        links: {
          validate: 'url',
          target: 'config.socialLinks',
          items: [
            { code: 'S1', label: 'Instagram' },
            { code: 'S2', label: 'TikTok' },
          ],
        },
      },
    ]),
    { S1: 'https://instagram.com/x', S2: 'n/a' }
  );
  assert.deepStrictEqual(r.config.socialLinks, [{ label: 'Instagram', href: 'https://instagram.com/x' }]);
  assert.strictEqual(r.mapReport.length, 2);
});
check('note template out.<path> conditionals + {value#N} slice', () => {
  const r = runMapping(
    M([
      { id: 'pre', set: [{ target: 'flags.ingest', value: true }] },
      {
        id: 'a',
        source: { code: 'Q1' },
        target: 'config.a',
        notes: [{ when: 'written', text: '{?flags-missing:never}{?out.flags.ingest:run} it: {value#4}' }],
      },
    ]),
    { Q1: 'abcdefgh' }
  );
  assert.deepStrictEqual(r.notes, ['run it: abcd']);
});
check('context: exact code only, verbatim, present-only', () => {
  const r = runMapping(M([], { context: [{ code: 'Q7', label: 'Story' }, { code: 'Q8', label: 'Empty' }] }), {
    'Q7. Tell us': 'Began in 2010.',
  });
  assert.deepStrictEqual(r.context, { Story: 'Began in 2010.' });
});

console.log('example mapping:');
check('coffee-cart example validates and runs end to end', () => {
  const mapping = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'examples', 'coffee-cart.json'), 'utf-8'));
  assert.deepStrictEqual(validateMapping(mapping).errors, []);
  const r = runMapping(mapping, {
    'C1. Business name': 'Cart & Crema',
    C2: 'Espresso anywhere.',
    C3: 'bad-email',
    C4: 'Weddings and corporate events',
    C5: 'Yes',
    C6: 'Lavender latte, Cortado, Cold brew, Chai',
    C7: 'https://instagram.com/cartcrema',
    C9: 'Sam Bean',
    'C10. Best contact': 'sam@cartcrema.example',
  });
  assert.strictEqual(r.config.siteName, 'Cart & Crema');
  assert.strictEqual(r.config.contactEmail, 'sam@cartcrema.example');
  assert.strictEqual(r.config.pairing, 'quiet-luxury');
  assert.deepStrictEqual(r.config.modules, ['cms-core', 'menu']);
  assert.deepStrictEqual(r.config.menu.highlights, ['Lavender latte', 'Cortado', 'Cold brew']);
  assert.deepStrictEqual(r.config.socialLinks, [{ label: 'Instagram', href: 'https://instagram.com/cartcrema' }]);
  assert.strictEqual(r.contact.name, 'Sam Bean');
  assert.strictEqual(r.notes[0].includes('Event-focused'), true);
});

console.log('validateMapping:');
check('flags every problem, not just the first', () => {
  const v = validateMapping({
    format: 'wrong',
    fields: [
      { source: { code: 'Q1' } },
      { id: 'x', target: 'nope.y', transform: ['zap'], skipIf: '(' },
      { id: 'x', chain: { input: 'later', rules: [{ match: 'ok' }] } },
    ],
  });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.errors.length >= 6, true);
});

if (failures) {
  console.error(`\n${failures} test(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll engine tests passed.');
