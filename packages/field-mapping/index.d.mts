/** Type declarations for the Stardrive field-mapping engine (index.mjs). */

export type Answers = Record<string, string | string[] | undefined>;

export type HowResolved = 'code' | 'fuzzy' | 'none';

export interface MapReportEntry {
  field: string;
  code: string;
  how: HowResolved;
}

export interface MappingResult {
  /** Build-config slots the mapping wrote (target root "config"). */
  config: Record<string, unknown>;
  /** Contact-record slots (target root "contact"). */
  contact: Record<string, string>;
  /** Decision flags for the operator (target root "flags"). */
  flags: Record<string, unknown>;
  /** Human-review notes, in mapping order. */
  notes: string[];
  /** required fields that resolved empty, as "id (CODE)" labels. */
  unmapped: string[];
  /** Verbatim rich answers from the mapping's context section. */
  context: Record<string, string>;
  /** How every read field resolved (exact code, fuzzy hint, or not found). */
  mapReport: MapReportEntry[];
  /** Raw (post-validation) string value of every read field, by field id. */
  values: Record<string, string>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** A stardrive-field-mapping/v1 document. See README.md for the format. */
export interface FieldMapping {
  format: 'stardrive-field-mapping/v1';
  name?: string;
  version?: string;
  derived?: Array<{
    id: string;
    anyOf: Array<{ field: string; match?: string }>;
  }>;
  fields: Array<Record<string, unknown>>;
  context?: Array<{ code: string; label: string }>;
}

export function runMapping(mapping: FieldMapping, answers: Answers): MappingResult;
export function validateMapping(mapping: unknown): ValidationResult;

export function slugify(name: string): string;
export function isYes(v: string): boolean;
export function isUnsure(v: string): boolean;
export function looksLikeEmail(v: string): boolean;
export function looksLikeUrl(v: string): boolean;
export function splitList(raw: string): string[];
export function parseFaqPairs(raw: string): Array<{ q: string; a: string }>;
export function flattenAnswer(v: string | string[] | undefined): string;
