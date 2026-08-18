/**
 * Stand-ins for two third-party packages, so the lab can practise both AMBIENT DECLARATION and
 * AUGMENTATION against something real.
 *
 * In a project this file lives in `types/` (or `@types/`), and `tsconfig.json` picks it up via
 * `include`. A `declare module` in a file with NO top-level import/export is an ambient
 * declaration — the same syntax inside a module file means augmentation instead, which is the
 * single most common reason "declare module doesn't work".
 */

declare module 'some-http-lib' {
  export interface Request { url: string; method: string }
  export function handle(req: Request): void;
}

declare module 'untyped-date-lib' {
  export const PATTERNS: readonly string[];
  export default function formatDate(d: Date, pattern?: string): string;
}
