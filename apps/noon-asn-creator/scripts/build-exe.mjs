import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const compiledEntry = resolve(root, "dist", "src", "main.js");
const entry = resolve(root, "dist", "pkg", "main.cjs");
const contract = resolve(root, "contracts", "noon-uae-asn.v1.json");
const release = resolve(root, "release", "NoonASNCreator");
const output = resolve(release, "NoonASNCreator.exe");
const pkgBin = resolve(root, "node_modules", "@yao-pkg", "pkg", "lib-es5", "bin.js");
const target = "node22-win-x64";
const args = [
  pkgBin,
  entry,
  "--targets", target,
  "--output", output,
  "--config", resolve(root, "package.json"),
  "--sea",
];

if (process.argv.includes("--dry-run")) {
  process.stdout.write(`${JSON.stringify({ command: process.execPath, target, entry, output, args })}\n`);
  process.exit(0);
}

await rm(resolve(root, "dist"), { recursive: true, force: true });
await run(process.execPath, [resolve(root, "node_modules", "typescript", "bin", "tsc"), "-p", resolve(root, "tsconfig.build.json")], {
  cwd: root,
  windowsHide: true,
});
await build({
  entryPoints: [compiledEntry],
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  define: { "import.meta.url": '""' },
  external: [
    "chromium-bidi/lib/cjs/bidiMapper/BidiMapper",
    "chromium-bidi/lib/cjs/cdp/CdpConnection",
  ],
  sourcemap: false,
  logLevel: "warning",
});
const playwrightPackageText = await readFile(resolve(root, "node_modules", "playwright-core", "package.json"), "utf8");
const browsersText = await readFile(resolve(root, "node_modules", "playwright-core", "browsers.json"), "utf8");
const playwrightPackage = JSON.stringify(JSON.parse(playwrightPackageText));
const browsers = JSON.stringify(JSON.parse(browsersText));
let bundledSource = await readFile(entry, "utf8");
bundledSource = bundledSource
  .replace('require(import_path9.default.join(packageRoot, "package.json"))', playwrightPackage)
  .replaceAll('require(import_path20.default.join(packageRoot, "browsers.json"))', browsers)
  .replaceAll('require(import_path20.default.join(linkTarget, "browsers.json"))', browsers);
if (bundledSource.includes('require(import_path9.default.join(packageRoot, "package.json"))') ||
    bundledSource.includes('require(import_path20.default.join(packageRoot, "browsers.json"))')) {
  throw new Error("Playwright metadata could not be inlined into the packaged bundle");
}
await writeFile(entry, bundledSource, "utf8");
const parsed = JSON.parse(await readFile(contract, "utf8"));
if (parsed.version !== 1 || parsed.site !== "UAE" || !parsed.operations?.find || !parsed.operations?.create ||
    !parsed.operations?.details || !parsed.operations?.seal || !parsed.workflow?.eligible || !parsed.workflow?.classify || !parsed.workflow?.route ||
    !parsed.workflow?.createLines || !parsed.workflow?.storageCheck) {
  throw new Error("Verified Noon ASN contract is missing or invalid");
}

await mkdir(release, { recursive: true });
await run(process.execPath, args, { cwd: root, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
await copyFile(contract, resolve(release, "noon-uae-asn.v1.json"));
await copyFile(resolve(root, "docs", "operations.md"), resolve(release, "操作说明.txt"));
await writeFile(resolve(release, "LICENSES.txt"), [
  "NoonASNCreator third-party runtime dependencies",
  "",
  "@xmldom/xmldom - MIT",
  "exceljs - MIT",
  "jszip - MIT OR GPL-3.0-or-later",
  "playwright-core - Apache-2.0",
  "Node.js runtime - MIT",
  "",
].join("\r\n"), "utf8");
process.stdout.write(`${output}\n`);
