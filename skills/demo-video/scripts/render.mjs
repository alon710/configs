// Renders a film folder's index.html to <folder>/<folder-name>.mp4.
//   The page declares window.FILM = { width, height, fps = 60, seconds, sub = 4, bar? } and window.seek(t),
//   and resolves window.ready once fonts and images have loaded.
//   Captures `sub` subframes per output frame, blends them with tmix and keeps every `sub`-th frame,
//   then encodes H.264 yuv420p crf 16 (bt709) with the folder's audio.wav as AAC 192k (faststart).
//
// Usage (from anywhere; env from setup.sh):
//   PW_MODULE=… FFMPEG=… node render.mjs <film-dir> [--events | --stills | --encode-only]
//     --events       write <film-dir>/events.json from window.SOUND_EVENTS (for audio.py)
//     --stills       write <film-dir>/stills/sNN.png at window.STILL_TIMES (+ times.json);
//                    with STILLS_EVERY=0.1, every 0.1 s into <work-dir>/motion/ instead (motion scan)
//     --encode-only  re-encode from the segments already in the work dir
//   WORKERS=4, WORK_DIR=<film-dir>/.work, PW_CHANNEL=chrome ('' = Playwright's bundled Chromium)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PW_MODULE || 'playwright');
const DIR = path.resolve(process.argv.slice(2).find(a => !a.startsWith('--')) || '.');
const NAME = path.basename(DIR);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const WORK = process.env.WORK_DIR || path.join(DIR, '.work');
const PAGE = 'file://' + path.join(DIR, 'index.html');
const WORKERS = Number(process.env.WORKERS || 4);
const CHANNEL = process.env.PW_CHANNEL ?? 'chrome';
const ARGS = ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])];
const mode = ['--events', '--stills', '--encode-only'].find(m => process.argv.includes(m));
const launch = () => chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), args: ARGS });

async function openPage(browser, film) {
  const page = await browser.newPage({ viewport: { width: film?.width || 1920, height: film?.height || 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => { console.error('pageerror:', e.message); process.exitCode = 1; });
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto(PAGE);
  await page.evaluate(() => window.ready);
  return page;
}

const run = args => new Promise((res, rej) => {
  spawn(FFMPEG, args, { stdio: ['ignore', 'inherit', 'inherit'] }).on('exit', c => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c))));
});

const browser0 = await launch();
const probe = await openPage(browser0);
const FILM = { fps: 60, sub: 4, ...(await probe.evaluate(() => window.FILM)) };
if (!FILM.seconds) throw new Error('index.html must set window.FILM = { width, height, seconds }');

// The page cannot read music.json (file:// blocks fetch), so its constants are copied by hand: check them.
const mj = path.join(DIR, 'music.json');
if (fs.existsSync(mj)) {
  const m = JSON.parse(fs.readFileSync(mj, 'utf8'));
  if (m.length && Math.abs(m.length - FILM.seconds) > 1e-3) console.warn(`warning: music.json length ${m.length} s ≠ FILM.seconds ${FILM.seconds} s`);
  if (FILM.bar && m.bar && Math.abs(m.bar - FILM.bar) * (FILM.seconds / m.bar) > 0.5 / FILM.fps) {
    console.warn(`warning: BAR ${FILM.bar} s in index.html ≠ music.json bar ${m.bar} s; the picture drifts off the beat`);
  }
}

if (mode === '--events') {
  const ev = await probe.evaluate(() => window.SOUND_EVENTS || []);
  fs.writeFileSync(path.join(DIR, 'events.json'), JSON.stringify(ev, null, 1));
  console.log(`events.json: ${ev.length} cues`);
  await browser0.close();
} else if (mode === '--stills') {
  await browser0.close();
  const browser = await launch();
  const page = await openPage(browser, FILM);
  const every = Number(process.env.STILLS_EVERY || 0);
  const times = every > 0
    ? Array.from({ length: Math.floor(FILM.seconds / every) + 1 }, (_, i) => +(i * every).toFixed(4))
    : await page.evaluate(() => window.STILL_TIMES || []);
  const out = every > 0 ? path.join(WORK, 'motion') : path.join(DIR, 'stills');
  fs.mkdirSync(out, { recursive: true });
  for (const [i, t] of times.entries()) {
    await page.evaluate(t => window.seek(t), t);
    await page.screenshot({ path: path.join(out, `s${String(i + 1).padStart(2, '0')}.png`) });
  }
  fs.writeFileSync(path.join(out, 'times.json'), JSON.stringify(times));
  await browser.close();
  console.log(`stills → ${out} (${times.length})`);
} else {
  await browser0.close();
  const { fps, sub, seconds } = FILM;
  const frames = Math.round(fps * seconds);
  fs.mkdirSync(WORK, { recursive: true });
  // Stream frame n sits at t = (n − (sub + 1)/2)/(fps·sub), so after dropping the first partial tmix
  // frame, output frame j is the mean of stream frames sub·j+1 … sub·j+sub, centred on j/fps.
  const tOf = n => Math.max(0, (n - (sub + 1) / 2) / (fps * sub));
  const total = frames * sub + sub, per = Math.ceil(total / WORKERS);
  const worker = async (w, from, to) => {
    const browser = await launch();
    const page = await openPage(browser, FILM);
    const seg = path.join(WORK, `seg${w}.mkv`);
    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps * sub), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264rgb', '-preset', 'ultrafast', '-qp', '0', seg], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res, rej) => ff.on('exit', c => (c === 0 ? res() : rej(new Error('segment ffmpeg ' + c)))));
    const t0 = Date.now();
    for (let n = from; n < to; n++) {
      await page.evaluate(t => window.seek(t), tOf(n));
      const png = await page.screenshot({ type: 'png' });
      if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
      if ((n - from) % 480 === 0) console.log(`worker ${w}: ${n - from}/${to - from}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await done;
    await browser.close();
    return seg;
  };
  const segs = mode === '--encode-only'
    ? fs.readdirSync(WORK).filter(f => /^seg\d+\.mkv$/.test(f))
      .sort((a, b) => parseInt(a.slice(3), 10) - parseInt(b.slice(3), 10)).map(f => path.join(WORK, f))
    : await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w, w * per, Math.min(total, (w + 1) * per))));
  const list = path.join(WORK, 'list.txt');
  fs.writeFileSync(list, segs.map(s => `file '${s}'`).join('\n') + '\n');
  const audio = path.join(DIR, 'audio.wav');
  const out = path.join(DIR, `${NAME}.mp4`);
  const hasAudio = fs.existsSync(audio);
  await run(['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, ...(hasAudio ? ['-i', audio] : []),
    '-filter_complex',
    `[0:v]tmix=frames=${sub},select='not(mod(n\\,${sub}))',trim=start_frame=1,setpts=N/${fps}/TB,` +
    'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv[v]',
    '-map', '[v]', ...(hasAudio ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k'] : []), '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(seconds), out]);
  console.log(`video → ${out}${hasAudio ? '' : ' (no audio.wav found: silent)'}`);
}
