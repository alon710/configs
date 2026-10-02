// Prints SVG markup to paste into a film page's <defs>. Use the product's own icon set, nothing else.
//   <name>          lucide icon → <symbol id="i-<name>">, from lucide-react or lucide-static
//   path/to/x.svg   any icon set that ships SVG files (tabler, phosphor, heroicons' optimized/, ...)
//                   → <symbol id="i-x">, keeping the root's fill/stroke attributes
//   social:<name>   a round social icon from react-social-icons: brand-coloured glyph on SOCIAL_BG
// Use a symbol as <svg class="ic" width="20" height="20"><use href="#i-<name>"/></svg>.
// Run from the product repo root (it reads ./node_modules), or set NODE_MODULES:
//   node icons.mjs check arrow-right node_modules/@tabler/icons/icons/outline/bell.svg social:instagram
import fs from 'node:fs';
import path from 'node:path';

const NM = process.env.NODE_MODULES || path.join(process.cwd(), 'node_modules');
const SOCIAL_BG = process.env.SOCIAL_BG || '#F4F4F5';   // set to the product footer's icon background
// react-social-icons ships some dated brand colours; these are the networks' current ones.
// If the product's footer renders different colours, match the footer.
const BRAND = { facebook: '#1877F2', instagram: '#E4405F', tiktok: '#000000', youtube: '#FF0000', linkedin: '#0A66C2', x: '#000000' };
const ROOT_ATTRS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'];

function symbolFromSvg(id, svg) {
  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open) throw new Error(`${id}: not an SVG file`);
  const attr = n => open[0].match(new RegExp(`\\s${n}="([^"]*)"`))?.[1];
  const inner = svg.slice(open.index + open[0].length, svg.lastIndexOf('</svg>'))
    .replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim();
  const keep = ROOT_ATTRS.filter(a => attr(a) !== undefined).map(a => `${a}="${attr(a)}"`).join(' ');
  return `<symbol id="i-${id}" viewBox="${attr('viewBox') || '0 0 24 24'}">${keep ? `<g ${keep}>${inner}</g>` : inner}</symbol>`;
}

function lucide(name) {
  const react = path.join(NM, 'lucide-react/dist/esm/icons', `${name}.js`);
  if (fs.existsSync(react)) {
    const m = fs.readFileSync(react, 'utf8').match(/const __iconNode = (\[[\s\S]*?\]);\n/);
    if (!m) throw new Error(`${react}: unrecognised lucide-react build; install lucide-static and retry`);
    const inner = Function(`return ${m[1]}`)()
      .map(([tag, a]) => `<${tag} ${Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
    return `<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`;
  }
  const svg = path.join(NM, 'lucide-static/icons', `${name}.svg`);
  if (fs.existsSync(svg)) return symbolFromSvg(name, fs.readFileSync(svg, 'utf8'));
  throw new Error(`lucide icon "${name}" not found under ${NM}: install lucide-react or lucide-static, or pass an .svg path`);
}

function social(n) {
  const src = fs.readFileSync(path.join(NM, 'react-social-icons/dist/icons', `${n}.js`), 'utf8');
  const { path: d, color } = JSON.parse(src.match(/register\("[^"]+", (\{.*?\})\);/)[1]);
  // both paths need evenodd, or some glyphs (Instagram) get painted over by the background path
  return `<svg width="34" height="34" viewBox="0 0 64 64" style="border-radius:50%;display:block"><path fill="${BRAND[n] || color}" fill-rule="evenodd" d="M0,0H64V64H0Z${d}"/><path fill="${SOCIAL_BG}" fill-rule="evenodd" d="${d}"/></svg>`;
}

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('social:')) console.log(social(arg.slice(7)));
  else if (arg.endsWith('.svg')) console.log(symbolFromSvg(path.basename(arg, '.svg'), fs.readFileSync(arg, 'utf8')));
  else console.log(lucide(arg));
}
