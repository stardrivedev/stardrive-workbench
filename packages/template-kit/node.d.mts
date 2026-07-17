/** Type declarations for the Node-only template-kit helpers (node.mjs). */
import type { TemplateBundle } from './index.mjs';

export function bundleFromDir(dir: string): TemplateBundle;
export function writeBundleToDir(bundle: TemplateBundle, destDir: string): void;
