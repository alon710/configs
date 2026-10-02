// Renders a design-variants board and checks it before it is shown to anyone.
//   Wraps the fragment in a document skeleton (as artifact hosts do) and writes <out>/preview.html.
//   For each width (1280 desktop, 390 mobile) it saves v<n>-<width-name>.png per [data-variant] section,
//   plus board-<width-name>.png of the whole page.
//   Fails (exit 1) on page errors, console errors, failed requests, unloaded images,
//   leftover {{placeholders}} or TODO markers, and horizontal scroll at mobile width.
//
// Usage: PW_MODULE=… node shoot.mjs <board.html> [out-dir]   (out-dir defaults to <board-name>-shots/)
//   PW_CHANNEL=chrome by default ('' = Playwright's bundled Chromium)
import fs from "node:fs";
import path from "node:path";

const { chromium } = await import(process.env.PW_MODULE || "playwright");
const BOARD = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(BOARD)) {
  console.error("usage: node shoot.mjs <board.html> [out-dir]");
  process.exit(2);
}
const OUT = path.resolve(
  process.argv[3] || BOARD.replace(/\.html?$/, "") + "-shots",
);
const CHANNEL = process.env.PW_CHANNEL ?? "chrome";
const WIDTHS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const source = fs.readFileSync(BOARD, "utf8");
const problems = [];
const leftovers = source.match(/\{\{[^}]*\}\}|\bTODO\b/g);
if (leftovers)
  problems.push(`placeholders left: ${[...new Set(leftovers)].join(", ")}`);

const wrapped = /^\s*<!doctype/i.test(source)
  ? source
  : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${source}</body></html>`;
fs.mkdirSync(OUT, { recursive: true });
const preview = path.join(OUT, "preview.html");
fs.writeFileSync(preview, wrapped);
console.log(`board ${Math.round(Buffer.byteLength(source) / 1024)} KB`);

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
for (const view of WIDTHS) {
  const page = await browser.newPage({
    viewport: { width: view.width, height: view.height },
  });
  page.on("pageerror", (error) =>
    problems.push(`${view.name} page error: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      problems.push(`${view.name} console: ${message.text()}`);
  });
  page.on("requestfailed", (request) =>
    problems.push(
      `${view.name} request failed: ${request.url().slice(0, 120)}`,
    ),
  );
  await page.goto("file://" + preview, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const report = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    broken: [...document.images].filter(
      (image) => !image.complete || image.naturalWidth === 0,
    ).length,
    variants: document.querySelectorAll("[data-variant]").length,
  }));
  if (report.variants === 0) problems.push("no [data-variant] sections found");
  if (report.broken)
    problems.push(`${view.name}: ${report.broken} image(s) failed to load`);
  if (view.name === "mobile" && report.overflow > 0) {
    const culprits = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter(
          (node) =>
            node.getBoundingClientRect().right > window.innerWidth + 1 ||
            node.getBoundingClientRect().left < -1,
        )
        .slice(0, 5)
        .map(
          (node) =>
            node.tagName.toLowerCase() +
            (node.className && typeof node.className === "string"
              ? "." + node.className.split(" ")[0]
              : ""),
        ),
    );
    problems.push(
      `mobile: horizontal scroll of ${report.overflow}px (${culprits.join(", ")})`,
    );
  }
  await page.screenshot({
    path: path.join(OUT, `board-${view.name}.png`),
    fullPage: true,
  });
  const sections = await page.$$("[data-variant]");
  for (const section of sections) {
    const id = await section.getAttribute("data-variant");
    await section.screenshot({
      path: path.join(OUT, `v${id}-${view.name}.png`),
    });
  }
  console.log(`${view.name}: ${sections.length} variants → ${OUT}`);
  await page.close();
}
await browser.close();

if (problems.length) {
  console.error("\n✗ " + problems.join("\n✗ "));
  process.exit(1);
}
console.log("✓ no errors, no placeholders, no overflow");
