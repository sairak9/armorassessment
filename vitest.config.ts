import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

// node:sqlite (Node 22.5+) is too new for Vite 5's static built-in list, so
// any import triggers "Failed to load url sqlite".
//
// Fix: intercept both the prefixed and bare form in resolveId, then in load
// emit a shim that calls createRequire at runtime. Vite won't statically
// analyse a string inside a function-call argument, so no circular resolution.
// At runtime inside the Node.js fork process, require('node:sqlite') succeeds.
const nodeSqliteShim: Plugin = {
  name: "node-sqlite-shim",
  enforce: "pre",
  resolveId(id) {
    if (id === "node:sqlite" || id === "sqlite") {
      return "\0node-sqlite-shim";
    }
  },
  load(id) {
    if (id === "\0node-sqlite-shim") {
      return `
import { createRequire } from 'module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
export { DatabaseSync };
`;
    }
  },
};

export default defineConfig({
  plugins: [nodeSqliteShim],
  test: {
    pool: "forks",
  },
});
