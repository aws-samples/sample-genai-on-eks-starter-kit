// Fails the build when the App Router's /page client-reference manifest has no
// app client components. `next build` can exit 0 while emitting such a manifest
// (seen with Next 15.5 when a client module lived at
// src/components/EngineTable.tsx); the server then throws "Could not find the
// module ... in the React Client Manifest" on every request to /.
import { readFileSync } from "node:fs";

const file = ".next/server/app/page_client-reference-manifest.js";
globalThis.__RSC_MANIFEST = {};
// The file assigns into globalThis.__RSC_MANIFEST; evaluating it is the
// simplest faithful way to read it.
new Function(readFileSync(file, "utf8"))();
const manifest = globalThis.__RSC_MANIFEST["/page"];
const appModules = Object.keys(manifest?.clientModules ?? {}).filter(
  (k) => k.includes("/src/components/"),
);
if (appModules.length === 0) {
  console.error(
    `[check-client-manifest] ${file} lists no /src/components/ client modules — the / page would fail to render. Aborting.`,
  );
  process.exit(1);
}
console.log(`[check-client-manifest] ok: ${appModules.length} app client module(s) in /page manifest`);
