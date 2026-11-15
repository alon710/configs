// Shared helpers for the extract-design-system scripts: list a repo's files, read text safely,
// parse CSS custom properties and @font-face rules, tell which theme a rule belongs to, and parse colours.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.output', '.svelte-kit', '.turbo', '.vercel', '.cache',
  'dist', 'build', 'out', 'coverage', 'vendor', 'storybook-static', '.expo', 'ios', 'android',
]);

/** Repo-relative paths of tracked and untracked-but-not-ignored files, minus build output. */
export function listFiles(root) {
  let files;
  try {
    files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\0').filter(Boolean);
  } catch {
    files = [];
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.storybook')) continue;
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) files.push(p);
      }
    };
    walk('');
  }
  return [...new Set(files)].filter((f) => !f.split('/').some((s) => SKIP_DIRS.has(s) || (s.startsWith('.') && s !== '.storybook')));
}

/** File text, or null for symlinks, missing files and files over `max` bytes. */
export function readText(root, rel, max = 2_000_000) {
  const abs = path.join(root, rel);
  try {
    const st = fs.lstatSync(abs);
    if (!st.isFile() || st.size > max) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

export function isSymlink(root, rel) {
  try { return fs.lstatSync(path.join(root, rel)).isSymbolicLink(); } catch { return false; }
}

/** Every `var(--x[, fallback])` in `str` replaced by fn(name, fallback); null from fn → null overall. */
export function replaceVars(str, fn, depth = 0) {
  if (depth > 20) return null;
  let out = '';
  let i = 0;
  for (;;) {
    const at = str.indexOf('var(', i);
    if (at < 0) return out + str.slice(i);
    let d = 0;
    let j = at + 3;
    let comma = -1;
    for (; j < str.length; j++) {
      const c = str[j];
      if (c === '(') d++;
      else if (c === ')') { d--; if (d === 0) break; }
      else if (c === ',' && d === 1 && comma < 0) comma = j;
    }
    if (d !== 0) return null;
    const inner = str.slice(at + 4, j);
    const name = (comma < 0 ? inner : str.slice(at + 4, comma)).trim().replace(/^--/, '');
    const fallback = comma < 0 ? null : str.slice(comma + 1, j).trim();
    const rep = fn(name, fallback, depth + 1);
    if (rep == null) return null;
    out += str.slice(i, at) + rep;
    i = j + 1;
  }
}

/**
 * Parse CSS/SCSS text into custom-property declarations (with their rule context and nearby comment),
 * @font-face rules and Tailwind v4 @utility blocks. Not a full CSS parser: it tracks braces, strings,
 * parens and comments.
 */
export function parseCss(text, { lineComments = false } = {}) {
  const nl = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') nl.push(i);
  const lineOf = (pos) => {
    let lo = 0;
    let hi = nl.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < pos) lo = m + 1; else hi = m; }
    return lo + 1;
  };
  const decls = [];
  const fontFaces = [];
  const utilities = [];
  const comments = [];
  const stack = [];
  let buf = '';
  let bufStart = -1;
  let paren = 0;

  const flush = (endPos) => {
    const s = buf.trim();
    const start = bufStart;
    buf = '';
    bufStart = -1;
    if (!s) return;
    const m = s.match(/^(--[A-Za-z0-9_-][\w-]*|[A-Za-z-]+)\s*:\s*([\s\S]*)$/);
    if (!m) return;
    const top = stack[stack.length - 1];
    if (top?.fontFace) { top.fontFace[m[1].toLowerCase()] = m[2].trim(); return; }
    if (top?.utility && !m[1].startsWith('--')) { top.utility.props[m[1].toLowerCase()] = m[2].replace(/\s*!important\s*$/i, '').trim(); return; }
    if (!m[1].startsWith('--')) return;
    decls.push({
      name: m[1].slice(2),
      value: m[2].replace(/\s*!important\s*$/i, '').trim(),
      line: lineOf(start),
      endPos,
      context: stack.map((x) => x.prelude),
    });
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end;
      comments.push({ text: text.slice(i + 2, stop).replace(/^\s*\*+\s?/gm, '').trim(), start: i, end: stop });
      i = stop + 1;
      buf += ' ';
      continue;
    }
    if (lineComments && c === '/' && text[i + 1] === '/' && paren === 0 && text[i - 1] !== ':') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      comments.push({ text: text.slice(i + 2, stop).trim(), start: i, end: stop });
      i = stop - 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      if (bufStart < 0) bufStart = i;
      buf += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '(') paren++;
    else if (c === ')') paren = Math.max(0, paren - 1);
    if (paren === 0 && c === '{') {
      const prelude = buf.trim().replace(/\s+/g, ' ');
      const entry = { prelude, start: i };
      if (/^@font-face\b/i.test(prelude)) entry.fontFace = { line: lineOf(i) };
      const util = prelude.match(/^@utility\s+([\w-]+)$/);
      if (util) entry.utility = { name: util[1], props: {}, line: lineOf(i) };
      stack.push(entry);
      buf = '';
      bufStart = -1;
      continue;
    }
    if (paren === 0 && c === '}') {
      flush(i);
      const done = stack.pop();
      if (done?.fontFace) fontFaces.push(done.fontFace);
      if (done?.utility) utilities.push(done.utility);
      continue;
    }
    if (paren === 0 && c === ';') { flush(i); continue; }
    if (bufStart < 0 && !/\s/.test(c)) bufStart = i;
    buf += c;
  }

  // Attach a comment: one on the same line after the declaration, or a 4+ word comment on the line above.
  for (const d of decls) {
    const endLine = lineOf(d.endPos);
    const trailing = comments.find((k) => k.start > d.endPos && lineOf(k.start) === endLine);
    const leading = comments.find((k) => lineOf(k.end) === d.line - 1 && k.text.split(/\s+/).length >= 4);
    const note = trailing ?? leading;
    const text = note?.text.replace(/[─━═│┄┈]+|-{3,}|={3,}|\*{3,}/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) d.comment = text;
    delete d.endPos;
  }
  return { decls, fontFaces, utilities };
}

const ROOT_ATOM = String.raw`(?::root|html|body|:host|&)`;
const THEME_ATOM = String.raw`(?:\.([\w-]+)|\[data-(?:theme|mode|color-scheme|color-mode)=["']?([\w-]+)["']?\]|\[class~=["']?([\w-]+)["']?\])`;
const PART_RE = new RegExp(`^${ROOT_ATOM}?${THEME_ATOM}?$`);

function partTheme(part) {
  const p = part.replace(/:not\([^)]*\)/g, '').replace(/:(where|is)\(([^)]*)\)/g, '$2').trim();
  if (!p) return null;
  const m = p.match(PART_RE);
  if (!m) return null;
  const cls = m[1] ?? m[3];
  const data = m[2];
  if (!cls && !data) return 'root';
  const v = (cls ?? data).toLowerCase();
  if (/^(dark|theme-dark|dark-mode|dark-theme)$/.test(v)) return 'dark';
  if (/^(light|theme-light|light-mode|light-theme)$/.test(v)) return 'light';
  if (data) return v;
  const named = v.match(/^theme-([\w-]+)$/) ?? v.match(/^([\w-]+)-theme$/);
  return named ? named[1] : null;
}

/**
 * Which theme a declaration's rule context belongs to.
 * → { theme: 'root' | 'dark' | 'light' | <name>, tw?: 'theme' | 'inline' } or { skip: reason }.
 */
export function classifyContext(context) {
  let theme = null;
  let tw = null;
  const sels = [];
  for (const p of context) {
    if (p.startsWith('@')) {
      if (/^@theme\b/i.test(p)) { tw = /\binline\b/.test(p) ? 'inline' : 'theme'; continue; }
      if (/^@(layer|supports|scope)\b/i.test(p)) continue;
      if (/^@media\b/i.test(p) && /prefers-color-scheme\s*:\s*dark/i.test(p)) { theme = 'dark'; continue; }
      if (/^@media\b/i.test(p) && /prefers-color-scheme\s*:\s*light/i.test(p)) { theme = theme ?? 'root'; continue; }
      return { skip: `inside ${p}` };
    }
    sels.push(p);
  }
  if (tw) return { theme: 'root', tw };
  if (!sels.length) return theme ? { theme } : { skip: 'outside any rule' };
  for (const s of sels) {
    const themes = new Set(s.split(',').map(partTheme).filter(Boolean));
    if (!themes.size) return { skip: `scoped to ${sels.join(' ')}` };
    const named = [...themes].find((t) => t !== 'root');
    if (named) theme = named;
    else theme = theme ?? 'root';
  }
  return { theme: theme ?? 'root' };
}

// ---------- colour ----------

export const COLOR_FN = /^(rgba?|hsla?|oklch|oklab|lab|lch|color)\(([^()]*)\)$/i;
export const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** True when the Design System page accepts `v` as a literal colour value. */
export function isColorSyntax(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (HEX.test(s)) return true;
  const m = s.match(COLOR_FN);
  return !!m && !/var|url|calc|from/i.test(m[2]);
}

const num = (s, pctScale = 1) => {
  if (s === 'none') return 0;
  return s.endsWith('%') ? (parseFloat(s) / 100) * pctScale : parseFloat(s);
};
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const encode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const decode = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hue(s) {
  const v = parseFloat(s);
  if (s.endsWith('turn')) return v * 360;
  if (s.endsWith('rad')) return (v * 180) / Math.PI;
  if (s.endsWith('grad')) return v * 0.9;
  return s === 'none' ? 0 : v;
}

function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => clamp01(encode(clamp01(c))));
}

/** Parse a colour into gamma-encoded sRGB 0..1 plus alpha. Null for lab/lch/color() and anything unknown. */
export function parseColor(input) {
  const v = String(input).trim().toLowerCase();
  if (v === 'white') return { r: 1, g: 1, b: 1, a: 1 };
  if (v === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (HEX.test(v)) {
    let h = v.slice(1);
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
  }
  const m = v.match(COLOR_FN);
  if (!m || /var|calc|from/.test(m[2])) return null;
  let parts = m[2].replace(/,/g, ' ').replace(/\//g, ' / ').trim().split(/\s+/);
  let alpha = 1;
  const slash = parts.indexOf('/');
  if (slash >= 0) { alpha = num(parts[slash + 1] ?? '1'); parts = parts.slice(0, slash); }
  else if (parts.length === 4) { alpha = num(parts[3]); parts = parts.slice(0, 3); }
  if (parts.length !== 3) return null;
  const fn = m[1];
  let rgb;
  if (fn === 'rgb' || fn === 'rgba') rgb = parts.map((p) => clamp01(num(p, 255) / 255));
  else if (fn === 'hsl' || fn === 'hsla') {
    const h = ((hue(parts[0]) % 360) + 360) % 360;
    const s = clamp01(num(parts[1], 100) / 100);
    const l = clamp01(num(parts[2], 100) / 100);
    const f = (n) => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    rgb = [f(0), f(8), f(4)];
  } else if (fn === 'oklch') {
    const L = parts[0].endsWith('%') ? parseFloat(parts[0]) / 100 : num(parts[0]);
    const C = parts[1].endsWith('%') ? (parseFloat(parts[1]) / 100) * 0.4 : num(parts[1]);
    const H = (hue(parts[2]) * Math.PI) / 180;
    rgb = oklabToRgb(L, C * Math.cos(H), C * Math.sin(H));
  } else if (fn === 'oklab') {
    const L = parts[0].endsWith('%') ? parseFloat(parts[0]) / 100 : num(parts[0]);
    const ab = (s) => (s.endsWith('%') ? (parseFloat(s) / 100) * 0.4 : num(s));
    rgb = oklabToRgb(L, ab(parts[1]), ab(parts[2]));
  } else return null;
  if (rgb.some(Number.isNaN) || Number.isNaN(alpha)) return null;
  return { r: rgb[0], g: rgb[1], b: rgb[2], a: clamp01(alpha) };
}

/** `fg` painted over `bg` (both from parseColor); a translucent bg is first laid on `base`. */
export function composite(fg, bg, base = { r: 1, g: 1, b: 1, a: 1 }) {
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  const ground = bg.a < 1 ? over(bg, base) : bg;
  return { fg: fg.a < 1 ? over(fg, ground) : fg, bg: ground };
}

export const luminance = ({ r, g, b }) => 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---------- lengths ----------

export const LENGTH = /^-?(\d+\.?\d*|\.\d+)(px|rem|em|%)$/;
export const isLength = (v) => typeof v === 'number' || (typeof v === 'string' && (LENGTH.test(v.trim()) || v.trim() === '0'));

/** Evaluate a calc() over px/rem/em/% and unitless numbers (rem→px at 16px when units mix). Null if it can't. */
export function evalCalc(expr) {
  const src = expr.trim().replace(/^calc\(/i, '(').replace(/calc\(/gi, '(');
  const toks = src.match(/(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%)?|[()+\-*/]/g);
  if (!toks || toks.join('') !== src.replace(/\s+/g, '')) return null;
  let i = 0;
  const unitOf = (t) => (t.match(/(px|rem|em|%)$/) || [, ''])[1];
  const add = (a, b, sign) => {
    if (!a || !b) return null;
    if (a.u === b.u) return { v: a.v + sign * b.v, u: a.u };
    if (!a.u && a.v === 0) return { v: sign * b.v, u: b.u };
    if (!b.u && b.v === 0) return a;
    const px = (x) => (x.u === 'rem' ? x.v * 16 : x.u === 'px' ? x.v : null);
    const [pa, pb] = [px(a), px(b)];
    return pa == null || pb == null ? null : { v: pa + sign * pb, u: 'px' };
  };
  const factor = () => {
    const t = toks[i++];
    if (t === '(') { const r = sum(); i++; return r; }
    if (t === '-') { const r = factor(); return r && { v: -r.v, u: r.u }; }
    if (t == null || /^[()+*/]$/.test(t)) return null;
    return { v: parseFloat(t), u: unitOf(t) };
  };
  const term = () => {
    let r = factor();
    while (r && (toks[i] === '*' || toks[i] === '/')) {
      const op = toks[i++];
      const b = factor();
      if (!b) return null;
      if (op === '*') { if (r.u && b.u) return null; r = { v: r.v * b.v, u: r.u || b.u }; }
      else { if (b.u || b.v === 0) return null; r = { v: r.v / b.v, u: r.u }; }
    }
    return r;
  };
  const sum = () => {
    let r = term();
    while (r && (toks[i] === '+' || toks[i] === '-')) {
      const op = toks[i++];
      r = add(r, term(), op === '+' ? 1 : -1);
    }
    return r;
  };
  const r = sum();
  if (!r || i !== toks.length) return null;
  const v = Math.round(r.v * 10000) / 10000;
  return r.u ? `${v}${r.u}` : String(v);
}

/** Replace every computable calc(…) inside `str` with its value; the rest stays as written. */
export function evalCalcs(str) {
  let out = str;
  let from = 0;
  for (let guard = 0; guard < 100; guard++) {
    const i = out.slice(from).search(/calc\(/i);
    if (i < 0) return out;
    const at = from + i;
    let d = 0;
    let j = at + 4;
    for (; j < out.length; j++) {
      if (out[j] === '(') d++;
      else if (out[j] === ')') { d--; if (d === 0) break; }
    }
    if (d !== 0) return out;
    const v = evalCalc(out.slice(at, j + 1));
    if (v == null) { from = j + 1; continue; }
    out = out.slice(0, at) + v + out.slice(j + 1);
    from = at + v.length;
  }
  return out;
}
