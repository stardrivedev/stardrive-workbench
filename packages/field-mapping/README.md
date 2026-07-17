# @stardrive/field-mapping

The declarative bridge between **your intake questionnaire** and **your
template's build config**. You describe — in one JSON file a non-engineer can
edit — which question feeds which config slot, how answers are cleaned up,
which answers flip modules on, and what a human reviewer should be told.
The engine executes that description. When your questionnaire changes, you
edit the mapping, never a parser.

Pure ESM, zero dependencies, no Node APIs: the same file runs in a server
route, a CLI, or a browser preview.

```js
import { runMapping, validateMapping } from '@stardrive/field-mapping';

const result = runMapping(mapping, answers);
// → { config, contact, flags, notes, unmapped, context, mapReport, values }
```

`answers` is a flat object. Keys are your question codes — bare (`"Q3-1"`) or
full titles that start with the code (`"Q3-1. What is your business name?"`).
Values are strings (or arrays of strings, joined with `", "`).

## Design rules the engine enforces

- **It proposes; a human disposes.** The output is a *proposed* config plus
  review notes — nothing here should ship a site without an operator's eyes.
- **Never invent a fact.** Every output value is a client's answer, a
  transform of one, or a declared literal. Empty answers stay empty and are
  reported, not guessed.
- **Nothing resolves silently.** Every read lands in `mapReport` as
  `code` (exact), `fuzzy` (keyword rescue), or `none` (missing) — so a form
  edit can never quietly disconnect a field.

## The mapping document

```json
{
  "format": "stardrive-field-mapping/v1",
  "name": "my-agency-intake",
  "version": "1.0.0",
  "derived": [],
  "fields": [],
  "context": []
}
```

`fields` is an ordered list — order is the read order, the note order, and
the report order. Each entry is one of six kinds.

### 1. Source field (the workhorse)

```json
{
  "id": "contactEmail",
  "source": { "code": "Q3-7", "hint": "public email" },
  "fallback": { "scan": "values", "validate": "email", "trigger": "invalid" },
  "validate": "email",
  "skipIf": "^(no|n/a|none)$",
  "transform": ["splitList", "limit:5"],
  "target": "config.contactEmail",
  "required": true,
  "writeEmpty": false,
  "when": { "fieldYes": "someEarlierField" },
  "writeWhen": { "anyFieldPresent": ["a", "b"] },
  "set": [{ "target": "flags.x", "value": "{value|see form}", "when": "yes" }],
  "notes": [{ "when": "written", "text": "Got: {value#80}" }]
}
```

Processing order: read (`code` exact-prefix, then `hint` keyword fallback) →
`fallback` scan → `validate` → `skipIf` → record in `mapReport` →
`required` check → `transform` pipeline → write `target` → apply `set` →
apply `notes`.

- **source.hint** — case-insensitive regex tried against answer *keys* when
  the code is missing.
- **fallback** — rescan every answer *value* for one that passes the
  validator; `trigger: "empty"` (only when the answer was blank) or
  `"invalid"` (when it failed validation); `excludeCodes` is a key regex for
  answers that are legitimately that shape (e.g. social links are URLs).
- **validate** — `email` | `url`; a failing value becomes empty.
- **skipIf** — regex that turns filler answers ("none") into empty.
- **transform** — pipeline of: `splitList` (comma/semicolon/newline list,
  filler dropped), `limit:N`, `truncate:N`, `faqPairs` (free text →
  `{q, a}[]`), `asNames` (strings → `{name}[]`).
- **target** — dot path rooted at `config`, `contact`, or `flags`. Empty
  results aren't written unless `writeEmpty: true`.
- **required** — empty final value adds `"id (CODE)"` to `unmapped`.
- **when** — gates the whole entry, including the read (no `mapReport` row).
  `writeWhen` gates only the target write.
- **set** — extra writes: `target` (assign) or `append` (push to an array
  path); `value` is a literal, or a template when it contains `{`.
- **notes** — reviewer messages (see Templates).

**Conditions** (`when` / `writeWhen` / object-form note & set gates):
`{ "answerYes": "Q1" }`, `{ "answerMatches": { "code": "Q1", "match": "…" } }`,
`{ "fieldYes": "id" }`, `{ "fieldPresent": "id" }`,
`{ "anyFieldPresent": ["id", …] }`,
`{ "outputIncludes": { "path": "config.modules", "value": "menu" } }`.

**String-form** note/set gates judge the entry's own answer: `"always"`,
`"present"`, `"yes"`, `"unsure"`, `"written"` (the target was actually
written), or `{ "match": "regex" }`.

### 2. Chain (an else-if ladder)

First matching rule wins; rules test the *lowercased* value of an
earlier field. For "this answer means one of several exclusive things":

```json
{
  "id": "designChain",
  "chain": {
    "input": "theme",
    "rules": [
      { "match": "match.*brand", "set": [{ "target": "flags.brandIngest", "value": true }], "note": "…" },
      { "match": "teal|cool", "set": [{ "target": "config.themePreset", "value": "slate-teal" }] }
    ]
  }
}
```

### 3. Table (keyword lookup)

Joins the raw values of earlier fields, lowercases, first matching rule
wins, declared default otherwise. Templates see `{result}` and the raw
inputs as `{in0}`, `{in1}`, …

```json
{
  "id": "pairing",
  "table": {
    "inputs": ["theme", "siteWords"],
    "target": "config.pairing",
    "rules": [{ "value": "warm-craft", "match": "warm|craft|handmade" }],
    "default": "modern-signal",
    "noteOnMatch": "Proposed {result} from \"{in0|n/a}\".",
    "noteOnDefault": "No keywords matched; defaulted."
  }
}
```

### 4. Array policy (finalize an appended list)

Placed *after* the fields that `append`. Prepends base dependencies when
anything was selected, writes `[]` (with `writeEmpty`) when nothing was, and
notes either way; `{items}` is the appended list before the prepend.

```json
{
  "id": "modulesPolicy",
  "array": {
    "path": "config.modules",
    "prependIfAny": ["cms-core"],
    "writeEmpty": true,
    "noteIfAny": "Modules: {items} (+ cms-core).",
    "noteIfEmpty": "No modules — a brochure site."
  }
}
```

### 5. Links (labeled URL set)

Each code is read and reported as `id:Label`; only values passing the
validator are kept as `{ label, href }`.

```json
{
  "id": "social",
  "links": {
    "validate": "url",
    "target": "config.socialLinks",
    "items": [{ "code": "Q14-1", "label": "LinkedIn" }]
  }
}
```

### 6. Set-only (constants)

An entry with just `set` (and optionally `when`/`notes`) writes literals —
provenance comments, defaults, feature baselines.

## Derived booleans

Reusable OR-of-tests over field values, referenced by id in templates and
their conditional segments:

```json
"derived": [
  { "id": "quoteFirst", "anyOf": [
    { "field": "primaryAction", "match": "quote|estimate|bid" },
    { "field": "quoteTopics" }
  ] }
]
```

(An entry with `match` is a regex test; without it, a non-empty test.)

## Context

Rich free-text answers preserved verbatim for the human reviewer — never
parsed, never config. Exact-code match only; empty answers omitted.

```json
"context": [{ "code": "Q13-1", "label": "Business story" }]
```

## Templates

Note texts and string `set` values support:

| Syntax | Meaning |
|---|---|
| `{name}` | substitute (empty when absent) |
| `{name\|fallback}` | substitute, or the literal fallback when empty |
| `{name#N}` | substitute, first N characters |
| `{?name:text}` | include `text` only when `name` is truthy/non-empty |
| `{!name:text}` | include `text` only when `name` is falsy/empty |

Names: `value` (this entry's answer), `result`/`in0`/`in1`… (table),
`items` (array policy), `fields.<id>` (another field's answer),
`out.<path>` (anything already written), or a derived id. Conditional
bodies may contain substitutions (not further conditionals).

## Validation

`validateMapping(mapping)` statically checks shape, regex syntax, transform
names, target roots (`config`/`contact`/`flags` only), duplicate ids, and
forward references — and returns *every* problem: `{ ok, errors }`. Run it
in CI and in any authoring UI before accepting a mapping.

## A worked example

`examples/coffee-cart.json` is a complete small mapping (an agency intake
for coffee-cart businesses) exercised end-to-end by `test/run.mjs`. Start
there; copy it; rename the codes to yours.

## Provenance

Extracted from Deneb4 LLC's production intake pipeline, where a mapping
file replaced two hand-synchronized parsers; the extraction is regression-
tested against the original parser's captured outputs.
