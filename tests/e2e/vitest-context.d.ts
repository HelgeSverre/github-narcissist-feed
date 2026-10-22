/**
 * Values the e2e global setup hands to the test files with `project.provide(...)` and the helpers read with `inject(...)`.
 * Lives in a declaration file so the augmentation is in scope for every file under tests/, not only for whoever imports
 * global-setup.ts. The import makes this a module, so the block below augments "vitest" instead of redeclaring it.
 */
import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    /** Absolute path of the Chrome for Testing executable for this platform. */
    chromeExecutable: string;
    /** Absolute path of the built, unpacked extension (dist/). */
    extensionDir: string;
  }
}
