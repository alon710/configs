#!/usr/bin/env node
// Inventory a project's design sources before building a Design System from it: token files and theme blocks,
// fonts, logos and icons, UI and icon libraries, components ranked by how many files import them, stories,
// design docs, UI copy, text direction, and which Tailwind steps the UI actually uses.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { classifyContext, isSymlink, listFiles, parseCss, readText } from './lib.mjs';

const USAGE = 'Usage: node scan.mjs [repo-dir] [--out inventory.json]';
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) { console.log(USAGE); process.exit(0); }
const outAt = argv.indexOf('--out');
const out = outAt >= 0 ? argv[outAt + 1] : null;
const root = path.resolve(argv.find((a, i) => !a.startsWith('--') && i !== outAt + 1) ?? '.');

const files = listFiles(root);
const ext = (f) => path.extname(f).toLowerCase();
const base = (f) => path.basename(f);
const TESTISH = /(^|\/)(tests?|__tests__|__mocks__|e2e|fixtures?|mocks?)\/|\.(test|spec|stories|story)\.[jt]sx?$/;
const CODE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.mdx']);
const UI_EXT = new Set(['.tsx', '.jsx', '.vue', '.svelte', '.astro', '.html', '.mdx']);
const git = (...a) => { try { return execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

const inv = {
  root,
  git: (() => {
    const remote = git('remote', 'get-url', 'origin');
    return {
      repo: remote?.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null,
      branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
      sha: git('rev-parse', '--short', 'HEAD'),
      dirty: !!git('status', '--porcelain'),
    };
  })(),
  packages: [], libraries: {}, iconLibraries: {}, shadcn: null, tailwind: null,
  tokenSources: [], fonts: { files: [], fontFace: [], nextFont: [], googleFonts: [] },
  assets: { marks: [], iconDirs: [] }, components: [], stories: [], docs: [], copy: [], direction: [],
  utilities: {}, skipped: [],
};

// ---------- packages and libraries ----------
const UI_LIBS = {
  tailwindcss: 'Tailwind', '@radix-ui/': 'Radix', '@base-ui-components/react': 'Base UI', '@base-ui/react': 'Base UI',
  '@mui/material': 'MUI', '@chakra-ui/react': 'Chakra', '@mantine/core': 'Mantine', '@headlessui/react': 'Headless UI',
  daisyui: 'daisyUI', 'styled-components': 'styled-components', '@emotion/react': 'Emotion', '@vanilla-extract/css': 'vanilla-extract',
  '@stitches/react': 'Stitches', 'class-variance-authority': 'cva', 'tailwind-variants': 'tailwind-variants', '@pandacss/dev': 'Panda',
  'react-native': 'React Native', antd: 'Ant Design', bootstrap: 'Bootstrap', 'framer-motion': 'Framer Motion', motion: 'Motion',
  'next-themes': 'next-themes', 'react-aria-components': 'React Aria', vuetify: 'Vuetify', '@angular/material': 'Angular Material',
};
const ICON_LIBS = {
  'lucide-react': 'Lucide', lucide: 'Lucide', 'lucide-vue-next': 'Lucide', '@heroicons/react': 'Heroicons', '@tabler/icons-react': 'Tabler',
  'react-icons': 'react-icons', '@phosphor-icons/react': 'Phosphor', '@radix-ui/react-icons': 'Radix Icons', '@mui/icons-material': 'Material Icons',
  '@iconify/react': 'Iconify', 'iconoir-react': 'Iconoir', '@fortawesome/react-fontawesome': 'Font Awesome', 'material-symbols': 'Material Symbols',
};
for (const f of files.filter((x) => base(x) === 'package.json')) {
  let pkg;
  try { pkg = JSON.parse(readText(root, f) ?? ''); } catch { continue; }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  inv.packages.push({ path: f, name: pkg.name ?? null, exports: !!(pkg.exports || pkg.main || pkg.module) });
  for (const [d, v] of Object.entries(deps)) {
    for (const [k, label] of Object.entries(UI_LIBS)) if (d === k || (k.endsWith('/') && d.startsWith(k))) inv.libraries[label] = v;
    if (ICON_LIBS[d]) inv.iconLibraries[ICON_LIBS[d]] = v;
  }
  if (deps.tailwindcss) inv.tailwind = { version: deps.tailwindcss, defaults: fs.existsSync(path.join(root, path.dirname(f), 'node_modules/tailwindcss/theme.css')) ? path.join(path.dirname(f), 'node_modules/tailwindcss/theme.css') : null };
}
for (const f of files.filter((x) => base(x) === 'components.json')) {
  try { const c = JSON.parse(readText(root, f) ?? ''); if (c.$schema?.includes('shadcn') || c.aliases) inv.shadcn = { path: f, style: c.style, baseColor: c.tailwind?.baseColor, css: c.tailwind?.css, iconLibrary: c.iconLibrary, aliases: c.aliases }; } catch { /* not shadcn */ }
}

// ---------- token sources ----------
for (const f of files) {
  if (isSymlink(root, f)) { inv.skipped.push(`${f} (symlink)`); continue; }
  const e = ext(f);
  if (['.css', '.scss', '.sass', '.less', '.pcss'].includes(e)) {
    const t = readText(root, f);
    if (!t) continue;
    const { decls, fontFaces } = parseCss(t, { lineComments: e !== '.css' && e !== '.pcss' });
    const themes = {};
    let scoped = 0;
    for (const d of decls) {
      const c = classifyContext(d.context);
      if (c.skip) { scoped++; continue; }
      const k = c.tw ? `@theme${c.tw === 'inline' ? ' inline' : ''}` : c.theme;
      themes[k] = (themes[k] ?? 0) + 1;
    }
    for (const ff of fontFaces) inv.fonts.fontFace.push({ file: f, line: ff.line, family: ff['font-family'], weight: ff['font-weight'], style: ff['font-style'], src: ff.src?.slice(0, 160) });
    if (decls.length || fontFaces.length) inv.tokenSources.push({ path: f, kind: 'css', vars: decls.length, themes, scoped, fontFaces: fontFaces.length, tailwindV4: /@import\s+["']tailwindcss|@theme\b/.test(t) });
  } else if (/^tailwind\.config\.(js|cjs|mjs|ts)$/.test(base(f))) inv.tokenSources.push({ path: f, kind: 'tailwind-config' });
  else if (/(^|[.-])tokens?\.json$|design-tokens|\.tokens\.json$/i.test(base(f))) inv.tokenSources.push({ path: f, kind: 'token-json' });
  else if (CODE.has(e) && /(^|\/)(theme|tokens?|colors?|palette|design-system)\.(ts|js|mjs)$/i.test(f) && !TESTISH.test(f)) inv.tokenSources.push({ path: f, kind: 'theme-object' });
}

// ---------- fonts ----------
for (const f of files) {
  const e = ext(f);
  if (['.woff2', '.woff', '.ttf', '.otf'].includes(e)) inv.fonts.files.push({ path: f, bytes: fs.statSync(path.join(root, f)).size });
  if (!CODE.has(e) && !['.html', '.css'].includes(e)) continue;
  if (TESTISH.test(f)) continue;
  const t = readText(root, f);
  if (!t) continue;
  for (const m of t.matchAll(/fonts\.googleapis\.com\/css2?\?[^"'`)\s]+/g)) inv.fonts.googleFonts.push({ file: f, url: m[0] });
  if (/next\/font\/(google|local)/.test(t)) {
    const names = [...t.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean));
    for (const m of t.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(\w+)\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      const [, local, fn, body] = m;
      if (!names.includes(fn) && fn !== 'localFont') continue;
      inv.fonts.nextFont.push({
        file: f, family: fn === 'localFont' ? null : fn.replace(/_/g, ' '), local,
        variable: body.match(/variable\s*:\s*["'`]([^"'`]+)/)?.[1] ?? null,
        weight: body.match(/weight\s*:\s*(\[[^\]]*\]|["'`][^"'`]+["'`])/)?.[1] ?? null,
        subsets: body.match(/subsets\s*:\s*(\[[^\]]*\])/)?.[1] ?? null,
        src: fn === 'localFont' ? body.match(/src\s*:\s*(["'`][^"'`]+["'`]|\[[\s\S]*?\])/)?.[1]?.slice(0, 200) : undefined,
      });
    }
  }
}

// ---------- marks, icons, direction ----------
const IMG = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.avif']);
const svgDirs = new Map();
for (const f of files) {
  if (!IMG.has(ext(f)) || TESTISH.test(f)) continue;
  if (ext(f) === '.svg') svgDirs.set(path.dirname(f), (svgDirs.get(path.dirname(f)) ?? 0) + 1);
  if (/screenshots?\//i.test(f)) continue;
  if (/logo|brand|wordmark|lockup|emblem|(^|\/)(logo)?mark[\w-]*\.|favicon|apple-(touch-)?icon|(^|\/)icon\.(svg|png)|opengraph|og-image/i.test(f)) {
    inv.assets.marks.push({ path: f, bytes: fs.statSync(path.join(root, f)).size });
  }
}
inv.assets.iconDirs = [...svgDirs].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]).map(([d, n]) => ({ dir: d, svgs: n }));
const dirs = new Set();
for (const f of files.filter((x) => /(layout|_document|_app|app|root|index)\.(tsx|jsx|html|vue|svelte|astro)$|\.html$/.test(base(x)) && !TESTISH.test(x))) {
  const t = readText(root, f);
  if (!t) continue;
  for (const m of t.matchAll(/<html[^>]*>/g)) {
    const d = m[0].match(/\bdir=\{?["'`]?(\w+)/)?.[1];
    const l = m[0].match(/\blang=\{?["'`]?([\w-]+)/)?.[1];
    dirs.add(`${f}: lang=${l ?? '?'} dir=${d ?? '(none: ltr)'}`);
  }
}
inv.direction = [...dirs];

// ---------- components ----------
const tsconfigAliases = [];
for (const f of files.filter((x) => /^tsconfig(\.[\w-]+)?\.json$|^jsconfig\.json$/.test(base(x)))) {
  try {
    const raw = (readText(root, f) ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1');
    const co = JSON.parse(raw).compilerOptions ?? {};
    const baseUrl = path.posix.join(path.posix.dirname(f), co.baseUrl ?? '.');
    for (const [k, v] of Object.entries(co.paths ?? {})) if (k.endsWith('/*') && v?.[0]) tsconfigAliases.push([k.slice(0, -1), path.posix.normalize(path.posix.join(baseUrl, v[0].replace(/\*$/, '')))]);
  } catch { /* unparseable tsconfig */ }
}
if (!tsconfigAliases.length) tsconfigAliases.push(['@/', ''], ['~/', ''], ['@/', 'src/']);
const noExt = (p) => p.replace(/\.(tsx?|jsx?|vue|svelte|astro|mjs|cjs)$/, '');
const compFiles = files.filter((f) => UI_EXT.has(ext(f)) && ext(f) !== '.html' && ext(f) !== '.mdx' && !TESTISH.test(f) && !/(^|\/)(app|pages|routes)\//.test(f) && !/(^|\/)(page|layout|route|loading|error|not-found|template)\.(tsx|jsx)$/.test(f));
const byModule = new Map();
for (const f of compFiles) {
  const t = readText(root, f);
  if (!t) continue;
  let names = [];
  if (/\.(tsx|jsx)$/.test(f)) {
    for (const m of t.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Z][A-Za-z0-9]*)/g)) names.push(m[1]);
    for (const m of t.matchAll(/export\s*\{([^}]*)\}/g)) names.push(...m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter((s) => /^[A-Z]/.test(s)));
  } else if (/^[A-Z]/.test(base(f))) names = [noExt(base(f))];
  names = [...new Set(names)].filter((n) => !/(Props|Context|Provider)$/.test(n));
  if (!names.length) continue;
  const c = { path: f, exports: names.slice(0, 12), importedBy: 0, primitive: /(^|\/)(ui|primitives|design-system|ds)\//.test(f) };
  inv.components.push(c);
  byModule.set(noExt(f), c);
  if (/\/index$/.test(noExt(f))) byModule.set(path.posix.dirname(f), c);
}
for (const f of files.filter((x) => CODE.has(ext(x)) && !TESTISH.test(x))) {
  const t = readText(root, f);
  if (!t) continue;
  const seenHere = new Set();
  for (const m of t.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)) {
    const spec = m[1];
    const cands = [];
    if (spec.startsWith('.')) cands.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), spec)));
    else for (const [pre, to] of tsconfigAliases) if (spec.startsWith(pre)) cands.push(path.posix.normalize(path.posix.join(to, spec.slice(pre.length))));
    for (const cnd of cands) {
      const c = byModule.get(noExt(cnd)) ?? byModule.get(cnd);
      if (c && c.path !== f && !seenHere.has(c.path)) { seenHere.add(c.path); c.importedBy++; break; }
    }
  }
}
inv.components.sort((a, b) => b.importedBy - a.importedBy || a.path.localeCompare(b.path));
for (const f of files.filter((x) => /\.stories\.[jt]sx?$|\.stories\.mdx$/.test(x))) {
  inv.stories.push({ path: f, title: readText(root, f)?.match(/title\s*:\s*["'`]([^"'`]+)/)?.[1] ?? null });
}

// ---------- docs and copy ----------
const DOC_HEAD = /^#{1,4}\s.*\b(design|ui|ux|colou?rs?|typograph\w*|type|fonts?|brand\w*|tokens?|copy|voice|tone|writing|a11y|accessib\w*|icons?|layout|spacing|components?|theme|dark mode|rtl|motion)\b/gim;
for (const f of files.filter((x) => /\.mdx?$/i.test(x) && !/(^|\/)(node_modules|CHANGELOG)/i.test(x))) {
  const named = /(^|\/)(readme|agents|claude|design|brand|style-?guide|ui|ux|tokens|voice|tone|copy|writing|a11y|accessibility|contributing)[^/]*\.mdx?$/i.test(f);
  if (!named && !/(^|\/)docs?\//i.test(f)) continue;
  const t = readText(root, f);
  if (!t) continue;
  const heads = [...t.matchAll(DOC_HEAD)].map((m) => m[0].trim()).slice(0, 12);
  if (named || heads.length) inv.docs.push({ path: f, bytes: t.length, designHeadings: heads });
}
for (const f of files.filter((x) => /(^|\/)(messages|locales?|i18n|lang|translations|dictionaries)\/.+\.(json|ya?ml|po|ts)$/i.test(x) && !TESTISH.test(x))) {
  inv.copy.push({ path: f, bytes: fs.statSync(path.join(root, f)).size });
}

// ---------- Tailwind utility usage ----------
const FAMILIES = {
  spacing: /^-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)-(.+)$/,
  radius: /^rounded(-[a-z]{1,2})?(-.+)?$/,
  textSize: /^text-(xs|sm|base|lg|[2-9]?xl|\d*xs|\[[^\]]+\]|[a-z0-9-]+(?=$))$/,
  fontWeight: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[[^\]]+\])$/,
  fontFamily: /^font-(sans|serif|mono|display|heading|body|[a-z]+)$/,
  leading: /^leading-(.+)$/,
  tracking: /^tracking-(.+)$/,
  shadow: /^(shadow|drop-shadow|inset-shadow)(-.+)?$/,
  colorUse: /^(bg|text|border|ring|fill|stroke|outline|divide|from|via|to)-([a-z][\w-]*?)(\/[\w.[\]]+)?$/,
  size: /^(size|w|h|min-w|max-w|min-h|max-h)-(.+)$/,
};
const counts = Object.fromEntries(Object.keys(FAMILIES).map((k) => [k, new Map()]));
let arbitrary = 0;
for (const f of files.filter((x) => UI_EXT.has(ext(x)) && !TESTISH.test(x))) {
  const t = readText(root, f);
  if (!t) continue;
  for (const m of t.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){2,400})\1/g)) {
    for (let tok of m[2].split(/\s+/)) {
      tok = tok.replace(/^!|!$/g, '').split(':').pop();
      if (!tok || tok.length > 60 || /[{}$]/.test(tok)) continue;
      for (const [fam, re] of Object.entries(FAMILIES)) {
        if (!re.test(tok)) continue;
        if (fam === 'fontFamily' && FAMILIES.fontWeight.test(tok)) continue;
        if (fam === 'colorUse' && (FAMILIES.textSize.test(tok) && /^text-(xs|sm|base|lg|[2-9]?xl)$/.test(tok) || /^(border|outline|ring|divide)-(\d+|x|y|[trblse]|solid|dashed|dotted|none|hidden|collapse|separate|inset|offset-\d+)$/.test(tok) || /^text-(left|right|center|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/.test(tok))) continue;
        if (fam === 'textSize' && !/^text-(xs|sm|base|lg|[2-9]?xl|\[)/.test(tok)) continue;
        const k = fam === 'colorUse' ? tok.replace(/^(bg|text|border|ring|fill|stroke|outline|divide|from|via|to)-/, '').replace(/\/.*$/, '') : tok;
        counts[fam].set(k, (counts[fam].get(k) ?? 0) + 1);
        if (/\[/.test(tok)) arbitrary++;
        break;
      }
    }
  }
}
for (const [fam, m] of Object.entries(counts)) inv.utilities[fam] = [...m].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => `${k} ×${n}`);
inv.utilities.arbitraryValues = arbitrary;

// ---------- output ----------
if (out) fs.writeFileSync(out, `${JSON.stringify(inv, null, 2)}\n`);
const p = (s = '') => console.log(s);
const g = inv.git;
p(`scan ${root}${g.repo ? ` — ${g.repo}` : ''}${g.sha ? ` @ ${g.branch}@${g.sha}${g.dirty ? ' (uncommitted changes)' : ''}` : ''}`);
p(`files: ${files.length}${inv.skipped.length ? ` · skipped ${inv.skipped.length} symlinks` : ''}`);
p(`libraries: ${Object.entries(inv.libraries).map(([k, v]) => `${k} ${v}`).join(', ') || 'none found'}`);
p(`icons: ${Object.entries(inv.iconLibraries).map(([k, v]) => `${k} ${v}`).join(', ') || 'no icon package'}${inv.assets.iconDirs.length ? ` · SVG folders: ${inv.assets.iconDirs.slice(0, 4).map((d) => `${d.dir} (${d.svgs})`).join(', ')}` : ''}`);
if (inv.shadcn) p(`shadcn: ${inv.shadcn.path} style=${inv.shadcn.style ?? '?'} css=${inv.shadcn.css ?? '?'}`);
if (inv.tailwind) p(`tailwind ${inv.tailwind.version}${inv.tailwind.defaults ? ` · defaults: ${inv.tailwind.defaults} (pass to css-to-tokens --resolve)` : ''}`);
p('\nTOKEN SOURCES');
for (const t of inv.tokenSources) p(`  ${t.path} [${t.kind}]${t.vars !== undefined ? ` ${t.vars} vars · themes ${JSON.stringify(t.themes)}${t.scoped ? ` · ${t.scoped} scoped` : ''}${t.fontFaces ? ` · ${t.fontFaces} @font-face` : ''}` : ''}`);
p('\nFONTS');
for (const n of inv.fonts.nextFont) p(`  next/font ${n.family ?? `localFont ${n.src ?? ''}`} var=${n.variable ?? '-'} weight=${n.weight ?? '-'} (${n.file})`);
for (const ff of inv.fonts.fontFace.slice(0, 12)) p(`  @font-face ${ff.family} ${ff.weight ?? ''} ${ff.style ?? ''} (${ff.file}:${ff.line})`);
for (const gf of inv.fonts.googleFonts.slice(0, 6)) p(`  Google Fonts ${gf.url} (${gf.file})`);
p(`  font files: ${inv.fonts.files.length ? inv.fonts.files.slice(0, 10).map((f) => f.path).join(', ') : 'none'}`);
p(`\nMARKS (${inv.assets.marks.length})`);
for (const a of inv.assets.marks.slice(0, 25)) p(`  ${a.path} (${Math.round(a.bytes / 1024)} KB)`);
p(`\nDIRECTION: ${inv.direction.join(' | ') || 'no <html lang/dir> found'}`);
p(`\nCOMPONENTS (${inv.components.length}; top 50 by importing files, ★ = primitive folder)`);
for (const c of inv.components.slice(0, 50)) p(`  ${String(c.importedBy).padStart(4)}  ${c.primitive ? '★' : ' '} ${c.path}  ${c.exports.join(', ')}`);
if (inv.stories.length) p(`stories: ${inv.stories.length}`);
p('\nDOCS');
for (const d of inv.docs.slice(0, 20)) p(`  ${d.path}${d.designHeadings.length ? ` — ${d.designHeadings.slice(0, 5).join(' · ')}` : ''}`);
p(`\nCOPY: ${inv.copy.length ? inv.copy.slice(0, 8).map((c) => c.path).join(', ') : 'no i18n files: take strings from the components'}`);
p('\nTAILWIND USAGE (top 12 per family)');
for (const [fam, list] of Object.entries(inv.utilities)) if (Array.isArray(list) && list.length) p(`  ${fam}: ${list.slice(0, 12).join(', ')}`);
p(`  arbitrary values ([…]): ${arbitrary}`);
if (out) p(`\nfull inventory → ${out}`);
