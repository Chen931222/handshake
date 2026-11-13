import { defineConfig, type Plugin } from "vite";
import { resolve, relative, join } from "node:path";
import { readdirSync, statSync, writeFileSync } from "node:fs";

/**
 * Offline support without a dependency. After the build is written, list the files that are
 * actually in dist/ and emit sw.js to precache them, so the first visit caches everything and
 * later visits need no network (steering: fully offline after first load).
 * It reads the disk, not the bundle: Vite drops empty chunks late, and cache.addAll() fails the
 * whole install if a single listed URL is missing.
 */
function precacheServiceWorker(): Plugin {
  let outDir = "dist";
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return {
    name: "handshake-precache-sw",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = walk(outDir)
        .map((p) => relative(outDir, p).split("\\").join("/"))
        .filter((f) => f !== "sw.js" && !f.endsWith(".map"))
        .sort();
      const urls = ["./", ...files.map((f) => `./${f}`)];
      const version = Date.now().toString(36);
      const source = `// Generated at build time by vite.config.ts. Do not edit.
const CACHE = "handshake-${version}";
const PRECACHE = ${JSON.stringify(urls, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(req)),
  );
});
`;
      writeFileSync(join(outDir, "sw.js"), source);
    },
  };
}

export default defineConfig({
  root: ".",
  base: "./",
  build: {
    outDir: "dist",
    // AudioWorklet modules must stay real files: addModule() with a data: URL is not portable.
    assetsInlineLimit: (file) => (file.endsWith(".js") ? false : undefined),
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        lab: resolve(__dirname, "lab.html"),
        field: resolve(__dirname, "field.html"),
      },
    },
  },
  plugins: [precacheServiceWorker()],
});
