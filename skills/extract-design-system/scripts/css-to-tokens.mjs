#!/usr/bin/env node
// Turn a project's CSS custom properties into a draft tokens.json in the Design System type's shape:
// themes from :root / .dark / [data-theme] / prefers-color-scheme, colour aliases, calc() radii, Tailwind v4
// @theme scales, @font-face files. The draft keeps the source's names, values and order; usage notes are
// the source's comments. Writing real usage notes and semantic type styles is still the agent's job.
import fs from 'node:fs';
import path from 'node:path';
import {
  COLOR_FN, HEX, classifyContext, evalCalcs, isLength, listFiles, luminance, parseColor, parseCss, readText, replaceVars,
} from './lib.mjs';

const USAGE = `Usage: node css-to-tokens.mjs <file.css>... [options]
  --out <path>       write tokens.json here (default: stdout)
  --name <name>      the system's name (tokens.json "name")
  --src <repo-dir>   count where each token is used (var(--x) and Tailwind utilities); paths are relative to it
  --resolve <file>   extra CSS read only to resolve var() references (e.g. node_modules/tailwindcss/theme.css); repeatable
  --report <path>    write the full report (skipped, unplaced, usages, font files) as JSON`;

const opt = { files: [], resolve: [], out: null, name: null, src: null, report: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') opt.out = argv[++i];
  else if (a === '--name') opt.name = argv[++i];
  else if (a === '--src') opt.src = argv[++i];
  else if (a === '--resolve') opt.resolve.push(argv[++i]);
  else if (a === '--report') opt.report = argv[++i];
  else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
  else if (a.startsWith('--')) { console.error(`Unknown option ${a}\n${USAGE}`); process.exit(2); }
  else opt.files.push(a);
}
if (!opt.files.length) { console.error(USAGE); process.exit(2); }
const base = path.resolve(opt.src ?? '.');
const relTo = (f) => path.relative(base, path.resolve(f)) || f;

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const TYPE_ATTR = /--(line-height|letter-spacing|font-weight|font-variation-settings|font-feature-settings)$/;
const NAMED = new Set(('red green blue gray grey silver orange yellow purple pink brown cyan magenta navy teal olive '
  + 'maroon lime aqua fuchsia gold indigo violet coral salmon tomato crimson khaki beige ivory lavender plum orchid '
  + 'tan wheat chocolate sienna peru slategray slategrey lightgray lightgrey darkgray darkgrey whitesmoke gainsboro').split(' '));

const report = {
  files: opt.files.map(relTo), themes: [], converted: [], skipped: [], unplaced: [], scoped: {},
  tailwindMappings: [], fontFiles: [], usages: {}, unused: [],
};

const parseFile = (f) => parseCss(fs.readFileSync(f, 'utf8'), { lineComments: /\.(scss|sass|less)$/i.test(f) });

// 1. Collect declarations per theme key ('root' | 'dark' | 'light' | <name>), last one wins.
const defaults = new Map();
for (const f of opt.resolve) for (const d of parseFile(f).decls) defaults.set(d.name, d.value);
const tables = new Map();
const order = [];
const seen = new Set();
const themeWhere = new Map();
const fontFaces = [];
const utilities = [];
for (const file of opt.files) {
  const { decls, fontFaces: faces, utilities: utils } = parseFile(file);
  for (const face of faces) fontFaces.push({ ...face, cssFile: file });
  for (const u of utils) utilities.push({ ...u, where: `${relTo(file)}:${u.line}` });
  for (const d of decls) {
    const where = `${relTo(file)}:${d.line}`;
    const c = classifyContext(d.context);
    if (c.skip) {
      const s = (report.scoped[c.skip] ??= { count: 0, examples: [] });
      s.count++;
      if (s.examples.length < 3) s.examples.push(`--${d.name} (${where})`);
      continue;
    }
    if (/^tw-/.test(d.name)) continue;
    if (c.tw) {
      const target = d.value.match(/^var\(\s*--([\w-]+)\s*\)$/)?.[1];
      if (target && target !== d.name && d.name.endsWith(target)) { report.tailwindMappings.push(`--${d.name} → --${target}`); continue; }
    }
    if (!tables.has(c.theme)) tables.set(c.theme, new Map());
    tables.get(c.theme).set(d.name, { ...d, where });
    if (!themeWhere.has(c.theme)) themeWhere.set(c.theme, `${d.context.join(' › ') || '(top level)'} in ${relTo(file)}`);
    if (!seen.has(d.name)) { seen.add(d.name); order.push(d.name); }
  }
}

const rawIn = (name, key) => tables.get(key)?.get(name)?.value;
const lookup = (name, key) => rawIn(name, key) ?? rawIn(name, 'root') ?? defaults.get(name) ?? null;
function resolveValue(value, key, depth = 0) {
  if (value == null || depth > 20) return null;
  return replaceVars(value, (n, fallback) => {
    const raw = lookup(n, key);
    if (raw != null) return resolveValue(raw, key, depth + 1);
    return fallback != null ? resolveValue(fallback, key, depth + 1) : null;
  });
}
const literal = (name, key) => {
  const v = resolveValue(lookup(name, key), key);
  return v == null ? null : evalCalcs(v.replace(/\s+/g, ' ').trim());
};

// 2. Themes: the root block is the first theme; it is "dark" only when its ground is dark and no .dark exists.
if (!tables.has('root')) tables.set('root', new Map());
const bgName = ['background', 'bg', 'bg-app', 'bg-base', 'bg-page', 'bg-surface', 'surface', 'color-background', 'canvas']
  .find((n) => lookup(n, 'root') != null);
const bg = bgName ? parseColor(literal(bgName, 'root') ?? '') : null;
const rootId = bg && luminance(bg) < 0.18 && !tables.has('dark') ? 'dark' : 'light';
if (tables.has(rootId)) {
  for (const [k, v] of tables.get(rootId)) tables.get('root').set(k, v);
  tables.delete(rootId);
}
const themeKeys = ['root', ...[...tables.keys()].filter((k) => k !== 'root')];
const idOf = (key) => (key === 'root' ? rootId : key);
const themes = themeKeys.map((k) => ({ id: idOf(k), name: idOf(k).replace(/(^|-)(\w)/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase()) }));
report.themes = themeKeys.map((k) => `${idOf(k)}: ${themeWhere.get(k) ?? '(no declarations)'}`);

// 3. Colours first, so aliases know which names are colours.
function normalizeColor(lit, name) {
  const s = lit.trim();
  if (HEX.test(s)) return { value: s.toLowerCase() };
  const named = { white: '#ffffff', black: '#000000', transparent: '#00000000' }[s.toLowerCase()];
  if (named) return { value: named, converted: `"${s}" written as hex` };
  const m = s.match(COLOR_FN);
  if (m) return /var|calc|from/i.test(m[2]) ? { skip: 'colour function with var()/calc()/from' } : { value: s.replace(/^[a-z]+/i, (f) => f.toLowerCase()) };
  if (/^-?[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%(\s*\/\s*[\d.]+%?)?$/.test(s)) return { value: `hsl(${s})`, converted: 'bare HSL channels wrapped in hsl()' };
  if (/^\d{1,3}(\s*,\s*|\s+)\d{1,3}(\s*,\s*|\s+)\d{1,3}$/.test(s) && /color|rgb|bg|fg|text|border|ring|primary|secondary|accent|muted|foreground|background|surface|ink/i.test(name)) {
    return { value: `rgb(${s.replace(/\s*,\s*/g, ' ')})`, converted: 'bare RGB channels wrapped in rgb()' };
  }
  if (/^(color-mix|light-dark|currentcolor|inherit|initial|unset|revert)\b/i.test(s)) return { skip: `${s.split('(')[0]} cannot be stored: write each theme's value by hand` };
  if (NAMED.has(s.toLowerCase())) return { skip: `named colour "${s}": write it as hex by hand` };
  return null;
}

const outName = (n) => n.replace(/[/.]/g, '-');
const colorNames = new Set();
const verdicts = new Map();
for (const n of order) {
  if (TYPE_ATTR.test(n)) continue;
  const lit = themeKeys.map((k) => literal(n, k)).find((v) => v != null);
  if (lit == null) {
    report.skipped.push({ name: n, reason: 'references a variable no CSS file defines (set at runtime, e.g. next/font?)', raw: lookup(n, 'root') ?? rawIn(n, themeKeys[1]) });
    verdicts.set(n, 'done');
    continue;
  }
  const c = normalizeColor(lit, n);
  if (c?.skip) { report.skipped.push({ name: n, reason: c.skip, raw: lit }); verdicts.set(n, 'done'); continue; }
  if (c) colorNames.add(n);
}

const emitted = new Set();
const entry = (n, value) => {
  const decl = tables.get('root').get(n) ?? themeKeys.map((k) => tables.get(k)?.get(n)).find(Boolean);
  const name = outName(n);
  if (!NAME_RE.test(name) || emitted.has(name)) { report.skipped.push({ name: n, reason: NAME_RE.test(name) ? 'duplicate name' : 'name the page cannot store' }); return null; }
  emitted.add(name);
  return { name, value, usage: decl?.comment ?? '' };
};
const perTheme = (vals) => {
  const ids = themes.map((t) => t.id);
  const first = vals[0];
  if (vals.every((v) => v === first)) return first;
  const o = {};
  vals.forEach((v, i) => { if (v != null && (i === 0 || v !== first)) o[ids[i]] = v; });
  return o;
};

const colors = [];
for (const n of order) {
  if (!colorNames.has(n)) continue;
  const vals = themeKeys.map((k) => {
    const raw = rawIn(n, k) ?? (k === 'root' ? null : rawIn(n, 'root'));
    const target = raw?.match(/^var\(\s*--([\w-]+)\s*\)$/)?.[1];
    if (target && colorNames.has(target)) return `{${outName(target)}}`;
    const lit = literal(n, k);
    const c = lit == null ? null : normalizeColor(lit, n);
    if (c?.converted) report.converted.push(`--${n}: ${c.converted}`);
    return c?.value ?? null;
  });
  if (vals.every((v) => v == null)) continue;
  const e = entry(n, perTheme(vals));
  if (e) colors.push(e);
}
report.converted = [...new Set(report.converted)];

// 4. Everything else, by name.
function familyOf(n, lit) {
  if (/^(text|font-size|fs|type-size)-/.test(n) && isLength(lit)) return 'typeSize';
  if (/^(font-?weight|fw)(-|$)|^font-(thin|extralight|light|normal|regular|medium|semibold|bold|extrabold|black)$/.test(n)) return 'unplaced:a font weight: set it on the type styles that use it';
  if (/^(leading|line-height|lh)(-|$)/.test(n)) return 'unplaced:a line height: pair it with a font size in a type style';
  if (/^(tracking|letter-spacing|ls)(-|$)/.test(n)) return 'unplaced:a letter spacing: set it on the type styles that use it';
  if (/^font(-|$)/.test(n)) return 'family';
  if (/(^|-)(animate|animation|ease|easing|duration|transition|motion|delay|keyframes)(-|$)/.test(n)) return 'unplaced:motion: the type has no motion family; describe it under Motion in the README';
  if (/(^|-)(shadow|elevation)(-|$)/.test(n)) return 'shadow';
  if (/(^|-)(radius|rounded|corner)(-|$)/.test(n)) return 'radius';
  if (/^(space|spacing|gap|gutter|pad|padding|inset|margin|stack)(-|$)/.test(n)) return 'spacing';
  if (/^(z|z-index|zindex|layer)(-|$)/.test(n) && /^-?\d+$/.test(lit)) return 'zIndex';
  if (/^(opacity|alpha)(-|$)/.test(n)) return 'opacity';
  if (/^(breakpoint|screen|bp)(-|$)/.test(n)) return 'breakpoint';
  if (isLength(lit)) return 'size';
  return 'unplaced:no family fits; place it by hand or leave it out';
}
const OTHER_VALUE = /^[A-Za-z0-9 #%(),./+_-]{1,200}$/;
const lists = { spacing: [], radius: [], shadow: [], size: [], zIndex: [], opacity: [], breakpoint: [] };
const families = {};
const styles = [];
for (const n of order) {
  if (colorNames.has(n) || verdicts.has(n) || TYPE_ATTR.test(n)) continue;
  const vals = themeKeys.map((k) => literal(n, k));
  const lit = vals.find((v) => v != null);
  const fam = familyOf(n, lit);
  const where = tables.get('root').get(n)?.where;
  if (fam.startsWith('unplaced:')) { report.unplaced.push({ name: n, value: lit, reason: fam.slice(9), where }); continue; }
  if (fam === 'family') {
    const key = n.replace(/^font-?/, '').toLowerCase() || 'sans';
    if (lit.length > 200 || /[;{}<>\\()]/.test(lit) || (lit.match(/"/g) ?? []).length % 2 || (lit.match(/'/g) ?? []).length % 2) {
      report.unplaced.push({ name: n, value: lit, reason: 'not a plain font stack', where });
    } else families[key] = lit;
    continue;
  }
  if (fam === 'typeSize') {
    const s = { name: outName(n), fontSize: lit };
    const lh = literal(`${n}--line-height`, 'root');
    if (lh != null) s.lineHeight = /^\d*\.?\d+$/.test(lh) ? Number(lh) : lh;
    const ls = literal(`${n}--letter-spacing`, 'root');
    if (ls != null && isLength(ls)) s.letterSpacing = ls;
    const fw = literal(`${n}--font-weight`, 'root');
    if (fw != null && /^\d{1,4}$/.test(fw)) s.fontWeight = Number(fw);
    const decl = tables.get('root').get(n);
    if (decl?.comment) s.usage = decl.comment;
    styles.push(s);
    continue;
  }
  if (fam === 'shadow') {
    if (/^-?[\d.]+$/.test(lit)) { report.unplaced.push({ name: n, value: lit, reason: 'a number, not a box-shadow (a multiplier other shadows use?)', where }); continue; }
    if (vals.some((v) => v != null && (/var\(|url\(|color-mix/i.test(v) || v.length > 400))) {
      report.skipped.push({ name: n, reason: 'shadow with var()/url()/color-mix or over 400 chars', raw: lit });
      continue;
    }
    const e = entry(n, perTheme(vals));
    if (e) lists.shadow.push(e);
    continue;
  }
  if (!isLength(lit) && !(fam === 'zIndex' || fam === 'opacity' || fam === 'breakpoint')) {
    report.skipped.push({ name: n, reason: `${fam} value is not a length`, raw: lit });
    continue;
  }
  if (!OTHER_VALUE.test(lit)) { report.skipped.push({ name: n, reason: 'value has characters the page drops', raw: lit }); continue; }
  if (new Set(vals.filter((v) => v != null)).size > 1) report.unplaced.push({ name: n, value: lit, reason: `differs per theme; only the ${rootId} value is kept`, where });
  const e = entry(n, lit);
  if (e) lists[fam].push(e);
}

// Tailwind v4 `@utility shadow-x { box-shadow: … }` blocks are shadow tokens too.
for (const u of utilities) {
  const shadow = u.props['box-shadow'];
  if (!/^(shadow|elevation)(-|$)/.test(u.name) || !shadow) continue;
  const vals = themeKeys.map((k) => { const v = resolveValue(shadow, k); return v == null ? null : evalCalcs(v.replace(/\s+/g, ' ').trim()); });
  if (vals.some((v) => v == null || /var\(|url\(|calc\(|color-mix/i.test(v) || v.length > 400)) {
    report.skipped.push({ name: u.name, reason: `@utility box-shadow the page cannot store (${u.where})`, raw: shadow });
    continue;
  }
  const e = entry(u.name, perTheme(vals));
  if (e) lists.shadow.push(e);
}

// 5. Fonts from @font-face.
const fonts = [];
for (const face of fontFaces) {
  const family = (face['font-family'] ?? '').replace(/^["']|["']$/g, '').trim();
  const urls = [...(face.src ?? '').matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]);
  const pick = ['woff2', 'woff', 'ttf', 'otf'].map((x) => urls.find((u) => u.split('?')[0].toLowerCase().endsWith(`.${x}`))).find(Boolean);
  if (!family || !pick) { report.unplaced.push({ name: `@font-face ${family || '?'}`, value: face.src, reason: 'no font file url', where: `${relTo(face.cssFile)}:${face.line}` }); continue; }
  if (/^(https?:)?\/\//.test(pick)) { report.unplaced.push({ name: `@font-face ${family}`, value: pick, reason: 'remote font file: download it, or name the hosted family in type.families only' }); continue; }
  const from = path.resolve(path.dirname(face.cssFile), pick.split('?')[0]);
  const inside = !path.relative(base, from).startsWith('..');
  const exists = inside && fs.existsSync(from) && !fs.lstatSync(from).isSymbolicLink();
  const file = `fonts/${path.basename(from)}`;
  const weight = String(face['font-weight'] ?? '400').replace(/^normal$/, '400').replace(/^bold$/, '700');
  fonts.push({ family, file, weight, style: face['font-style'] ?? 'normal' });
  report.fontFiles.push({ from: exists ? relTo(from) : null, to: file, note: exists ? undefined : 'not found inside the repo: find it (public/ or a package) or drop this entry' });
}

// 6. Usage counts.
if (opt.src) {
  const SRC = /\.(tsx?|jsx?|mdx|vue|svelte|astro|html?|css|scss|less)$/i;
  const counts = new Map();
  const bump = (key, f) => { let m = counts.get(key); if (!m) counts.set(key, (m = new Map())); m.set(f, (m.get(f) ?? 0) + 1); };
  const UTIL = /(?<![\w-])(?:[\w-]+:)*!?(bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow|inset-shadow|drop-shadow|rounded(?:-(?:tl|tr|bl|br|ss|se|es|ee|[trblse]))?)-([a-z][\w.-]*?)(?:\/[\w.[\]]+)?(?![\w-])/g;
  const TESTISH = /(^|\/)(tests?|__tests__|__mocks__|e2e|fixtures?)\/|\.(test|spec|stories)\.[jt]sx?$/;
  for (const f of listFiles(base).filter((x) => SRC.test(x) && !TESTISH.test(x))) {
    const text = readText(base, f);
    if (!text) continue;
    for (const m of text.matchAll(/var\(\s*--([\w-]+)/g)) bump(m[1], f);
    if (/\.(css|scss|less)$/i.test(f)) {
      for (const m of text.matchAll(/@apply\s+([^;]+);/g)) for (const t of m[1].split(/\s+/)) for (const u of t.matchAll(UTIL)) bump(`${u[1].startsWith('rounded') ? 'radius' : u[1].includes('shadow') ? 'shadow' : 'color'}:${u[2]}`, f);
      continue;
    }
    for (const u of text.matchAll(UTIL)) bump(`${u[1].startsWith('rounded') ? 'radius' : u[1].includes('shadow') ? 'shadow' : 'color'}:${u[2]}`, f);
  }
  const usageOf = (keys) => {
    const per = new Map();
    for (const k of keys) for (const [f, c] of counts.get(k) ?? []) per.set(f, (per.get(f) ?? 0) + c);
    const files = [...per].sort((a, b) => b[1] - a[1]);
    return { count: files.reduce((s, [, c]) => s + c, 0), files: files.slice(0, 3).map(([f, c]) => `${f} (${c})`) };
  };
  const all = [
    ...colors.map((t) => [t.name, [t.name, `color:${t.name.replace(/^color-/, '')}`]]),
    ...lists.radius.map((t) => [t.name, [t.name, `radius:${t.name.replace(/^radius-?/, '')}`]]),
    ...lists.shadow.map((t) => [t.name, [t.name, `shadow:${t.name.replace(/^shadow-?/, '')}`]]),
    ...['spacing', 'size', 'zIndex', 'opacity', 'breakpoint'].flatMap((k) => lists[k].map((t) => [t.name, [t.name]])),
  ];
  for (const [name, keys] of all) {
    const u = usageOf(keys);
    report.usages[name] = u;
    if (!u.count) report.unused.push(name);
  }
}

// 7. Write.
const tokens = { name: opt.name ?? 'Design System', version: 1 };
if (colors.length) tokens.color = { themes, tokens: colors };
if (fonts.length || Object.keys(families).length || styles.length) {
  const famKey = families.sans ? 'sans' : null;
  tokens.type = { fonts, families, groups: styles.length ? [{ name: 'Scale', ...(famKey ? { family: famKey } : {}), styles }] : [] };
}
for (const [k, list] of Object.entries(lists)) if (list.length) tokens[k] = { tokens: list };
tokens.meta = { source: 'code', paths: { tokens: report.files } };

const json = `${JSON.stringify(tokens, null, 2)}\n`;
if (opt.out) { fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true }); fs.writeFileSync(opt.out, json); } else process.stdout.write(json);
if (opt.report) fs.writeFileSync(opt.report, `${JSON.stringify(report, null, 2)}\n`);

const log = (s = '') => console.error(s);
const fam = Object.entries(lists).filter(([, l]) => l.length).map(([k, l]) => `${k} ${l.length}`).join(' · ');
log(`tokens → ${opt.out ?? 'stdout'}`);
log(`themes: ${report.themes.join(' | ')}`);
log(`color ${colors.length} × ${themes.length} theme(s)${fam ? ` · ${fam}` : ''} · type: ${Object.keys(families).length} families, ${styles.length} sizes, ${fonts.length} font files`);
if (report.converted.length) log(`converted ${report.converted.length}: ${report.converted.slice(0, 5).join('; ')}${report.converted.length > 5 ? ' …' : ''}`);
if (report.tailwindMappings.length) log(`Tailwind @theme aliases of these tokens, not repeated: ${report.tailwindMappings.length}`);
for (const [why, s] of Object.entries(report.scoped)) log(`not a theme (${why}): ${s.count} vars, e.g. ${s.examples.join(', ')}`);
if (report.skipped.length) { log(`SKIPPED ${report.skipped.length}:`); for (const s of report.skipped) log(`  --${s.name}: ${s.reason}${s.raw ? ` [${String(s.raw).slice(0, 80)}]` : ''}`); }
if (report.unplaced.length) { log(`UNPLACED ${report.unplaced.length}:`); for (const s of report.unplaced) log(`  ${s.name.startsWith('@') ? s.name : `--${s.name}`} = ${String(s.value).slice(0, 60)}: ${s.reason}`); }
if (report.fontFiles.length) { log('FONT FILES to copy:'); for (const f of report.fontFiles) log(`  ${f.from ?? '?'} → project/${f.to}${f.note ? ` (${f.note})` : ''}`); }
if (opt.src) log(`unused outside tests: ${report.unused.length ? report.unused.join(', ') : 'none'}${opt.report ? '' : '  (pass --report for per-token usage)'}`);
