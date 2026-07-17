/** Type declarations for the Stardrive template-kit (index.mjs). */

export interface BundleFile {
  path: string;
  content?: string;
  contentBase64?: string;
}

export interface TemplateBundle {
  manifest: Record<string, unknown>;
  files: BundleFile[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface BundleValidationResult extends ValidationResult {
  warnings: string[];
}

export interface LintResult {
  errors: string[];
  warnings: string[];
}

export const REQUIRED_SITE_FILES: string[];

export function validateManifest(manifest: unknown): ValidationResult;
export function validateBundle(bundle: unknown): BundleValidationResult;
export function lintTemplateFiles(files: BundleFile[]): LintResult;
export function isSafeBundlePath(p: unknown): boolean;
export function decodeFileContent(file: BundleFile): string;
