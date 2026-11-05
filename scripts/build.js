const { copyFileSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");

const vendorDirectory = resolve("public/vendor");
mkdirSync(vendorDirectory, { recursive: true });

for (const [source, destination] of [
  ["node_modules/pdfjs-dist/build/pdf.min.mjs", "pdf.min.mjs"],
  ["node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
  ["node_modules/pdfjs-dist/LICENSE", "pdfjs-LICENSE"],
  ["node_modules/mammoth/mammoth.browser.min.js", "mammoth.browser.min.js"],
  ["node_modules/mammoth/LICENSE", "mammoth-LICENSE"]
]) {
  copyFileSync(resolve(source), resolve(vendorDirectory, destination));
}

console.log("Static dashboard ready in ./public");
