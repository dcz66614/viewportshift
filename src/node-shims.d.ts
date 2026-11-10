/**
 * P021 ViewportShift — minimal local type declarations for the Node
 * built-ins used by `src/cli.ts` only (T011, T010 P2-3).
 *
 * This project deliberately ships no `@types/node` (no new
 * dependency), so the three `node:` imports in `src/cli.ts` previously
 * needed per-import ignore directives. These declarations cover exactly the
 * members the CLI uses (`createHash(...).update(...).digest(...)`,
 * `fs.mkdirSync` / `fs.writeFileSync`, `path.resolve` / `path.join`)
 * and nothing else — they are not a substitute for `@types/node`
 * anywhere else in the project. If the CLI ever uses another Node
 * API, extend this file (or revisit the `@types/node` decision with
 * Sam / the coordinator) rather than re-adding ignore directives.
 */

declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(data: string, encoding: string): { digest(encoding: string): string };
  };
}

declare module "node:fs" {
  const fs: {
    mkdirSync(path: string, options: { recursive: boolean }): void;
    writeFileSync(path: string, data: string, encoding: string): void;
  };
  export default fs;
}

declare module "node:path" {
  const path: {
    resolve(...paths: Array<string>): string;
    join(...paths: Array<string>): string;
  };
  export default path;
}
