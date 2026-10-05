// Storyboard data -> HyperFrames composition (spec-card animatic).
// Shared by the browser preview and the render worker, so it stays dependency-free and
// uses only erasable TypeScript (the worker runs it with Node's type stripping).

export type Aspect = '16:9' | '9:16';
export type Shot = {
  description: string; magnification: string; movement: string; lens: string; angle: string;
  position: string; lighting: string; notes: string; audio: string; duration: number;
};
export type Scene = { heading: string; lighting: string; shots: Shot[] };
export type Storyboard = { title: string; aspect: Aspect; brief?: string; scenes: Scene[] };

export const GSAP_CDN = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';
const ID = 'storyboard';
const SHOT_FIELDS = ['description', 'magnification', 'movement', 'lens', 'angle', 'position', 'lighting', 'notes', 'audio'] as const;
export const MAX_SECONDS = 1800;

export function totalSeconds(sb: Storyboard): number {
  return sb.scenes.reduce((sum, scene) => sum + scene.shots.reduce((s, shot) => s + shot.duration, 0), 0);
}

// Job input crosses a trust boundary (browser -> worker), so check its shape before rendering.
export function parseStoryboard(value: unknown): Storyboard {
  const fail = (why: string): never => { throw new Error(`Invalid storyboard: ${why}`); };
  const text = (v: unknown, max: number, what: string) => typeof v === 'string' && v.length <= max ? v : fail(what);
  const sb = value as Storyboard;
  if (!sb || typeof sb !== 'object' || !Array.isArray(sb.scenes) || !sb.scenes.length) fail('no scenes');
  if (sb.aspect !== '16:9' && sb.aspect !== '9:16') fail('aspect');
  const scenes = sb.scenes.map((scene, i) => {
    if (!scene || !Array.isArray(scene.shots) || !scene.shots.length) fail(`scene ${i + 1} has no shots`);
    return {
      heading: text(scene.heading, 300, `scene ${i + 1} heading`), lighting: text(scene.lighting, 2000, `scene ${i + 1} lighting`),
      shots: scene.shots.map((shot, j) => {
        const out = { duration: Number.isInteger(shot?.duration) && shot.duration >= 1 && shot.duration <= 120 ? shot.duration : fail(`shot ${j + 1} duration`) } as Shot;
        for (const f of SHOT_FIELDS) out[f] = text(shot[f], 2000, `scene ${i + 1} shot ${j + 1} ${f}`);
        return out;
      }),
    };
  });
  const parsed: Storyboard = { title: text(sb.title, 200, 'title'), aspect: sb.aspect, scenes };
  if (sb.brief !== undefined) parsed.brief = text(sb.brief, 5000, 'brief');
  if (totalSeconds(parsed) > MAX_SECONDS) fail(`longer than ${MAX_SECONDS / 60} minutes`);
  return parsed;
}

// Stand-in figure for the shot size (codes from shot-breakdown shot-codes.md), as fractions of
// frame height. Close sizes pin the head near the top and let the frame cut the body where that
// size cuts it (MLS at the knees, MS at the waist...); wide sizes stand a small figure in the set.
export function figureBox(magnification: string): { height: number; top: number } {
  const codes = magnification.toUpperCase().split(/[\s/+,]+/);
  const cut = (visible: number, top: number) => ({ height: (1 - top) / visible, top });
  const table: [string, { height: number; top: number }][] = [
    ['ECU', cut(0.1, 0.02)], ['CU', cut(0.2, 0.1)], ['MCU', cut(0.33, 0.12)], ['MS', cut(0.5, 0.12)], ['MLS', cut(0.75, 0.1)],
    ['FS', { height: 0.8, top: 0.1 }], ['WS', { height: 0.35, top: 0.4 }], ['LS', { height: 0.35, top: 0.4 }],
    ['EWS', { height: 0.1, top: 0.6 }], ['ELS', { height: 0.1, top: 0.6 }],
  ];
  for (const [code, box] of table) if (codes.includes(code)) return box;
  return cut(0.5, 0.12);
}

type Pose = { scale: number; x: number; y: number };
// Camera move from the movement text. Combined moves ("push in + tilt down") merge.
export function cameraMove(movement: string): { from: Pose; to: Pose; handheld: boolean } {
  const m = movement.toLowerCase(), from = { scale: 1, x: 0, y: 0 }, to = { scale: 1, x: 0, y: 0 };
  if (/push|dolly in|zoom in|crash zoom|snap zoom/.test(m)) to.scale = 1.25;
  else if (/pull|dolly out|zoom out|reveal/.test(m)) from.scale = 1.25;
  if (/pan|track|truck|arc|follow|lead|slider/.test(m)) { const dir = /left/.test(m) ? -1 : 1; from.x = 60 * dir; to.x = -60 * dir; }
  if (/tilt down|crane down|jib down/.test(m)) { from.y = 50; to.y = -50; }
  else if (/tilt up|crane up|jib up|rise/.test(m)) { from.y = -50; to.y = 50; }
  return { from, to, handheld: /handheld|nervous/.test(m) };
}

function horizon(angle: string): number {
  const a = angle.toLowerCase();
  if (/top|bird|high/.test(a)) return 0.22;
  if (/worm|low|child/.test(a)) return 0.78;
  return 0.5;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
// JSON inside <script>: stop "</script>" and friends from closing the tag.
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

function splitAudio(audio: string): [string, string] {
  const i = audio.indexOf(':');
  return i > 0 && i < 40 ? [audio.slice(0, i).trim(), audio.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] : ['', audio];
}

export function buildComposition(sb: Storyboard, gsapSrc = GSAP_CDN): string {
  const portrait = sb.aspect === '9:16';
  const W = portrait ? 1080 : 1920, H = portrait ? 1920 : 1080;
  // Frame window keeps the deliverable's aspect; specs beside it, caption below.
  const win = portrait ? { x: 60, y: 140, w: 560, h: 996 } : { x: 60, y: 110, w: 1120, h: 630 };
  const specs = { x: win.x + win.w + 40, y: win.y, w: W - win.x - win.w - 100 };
  const capY = win.y + win.h + 50;

  let t = 0, n = 0;
  const clips: string[] = [], data: object[] = [];
  for (const scene of sb.scenes) for (const shot of scene.shots) {
    n++;
    const id = `s${n}`, box = figureBox(shot.magnification), gfx = /GFX/i.test(shot.magnification);
    const hz = horizon(shot.angle), dutch = /dutch/i.test(shot.angle);
    const [who, line] = splitAudio(shot.audio);
    const rows: [string, string][] = [['Framing', shot.magnification], ['Lens', shot.lens.match(/^\d+$/) ? `${shot.lens}mm` : shot.lens], ['Angle', shot.angle], ['Camera', shot.position], ['Move', shot.movement], ['Light', shot.lighting]];
    // .set is inset -10% (room for camera moves), so place the figure in frame coordinates + 10%.
    const fh = win.h * box.height, fw = fh * 0.38, fx = win.w * 0.1 + (win.w - fw) / 2, fy = win.h * 0.1 + win.h * box.top;
    clips.push(`<div class="clip shot" id="${id}" data-start="${t}" data-duration="${shot.duration}" data-track-index="0">
  <div class="head"><b>${String(n).padStart(2, '0')}</b><span>${esc(scene.heading)}</span></div>
  <div class="win"><div class="cam" data-layout-allow-overflow><div class="set" data-layout-allow-overflow${dutch ? ' style="rotate:8deg"' : ''}>
    <div class="sky" style="height:${hz * 100}%"></div>
    ${gfx ? '<div class="gfx">GRAPHICS</div>' : `<svg class="fig" viewBox="0 0 38 100" style="left:${fx}px;top:${fy}px;width:${fw}px;height:${fh}px"><circle cx="19" cy="12" r="10"/><path d="M4 100 L4 40 Q4 26 19 26 Q34 26 34 40 L34 100 Z"/></svg>`}
  </div></div><div class="desc">${esc(shot.description)}</div></div>
  <dl class="specs">${rows.map(([k, v]) => `<div class="row"><dt>${k}</dt><dd>${esc(v || '—')}</dd></div>`).join('')}</dl>
  <div class="cap">${who ? `<b>${esc(who)}</b>` : ''}<span>${esc(line)}</span></div>
</div>`);
    data.push({ id, start: t, dur: shot.duration, ...cameraMove(shot.movement) });
    t += shot.duration;
  }

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${W}, height=${H}">
<title>${esc(sb.title)}</title>
<script src="${esc(gsapSrc)}"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#0d0b0c}
#root{position:relative;width:100%;height:100%;overflow:hidden;background:#0d0b0c;color:#fff;font-family:sans-serif}
.clip{position:absolute;inset:0}
.head{position:absolute;left:60px;top:40px;right:60px;display:flex;gap:20px;align-items:baseline;white-space:nowrap;overflow:hidden}
.head b{font:700 40px monospace;color:#ff6d29}.head span{font-size:24px;color:#bababa;overflow:hidden;text-overflow:ellipsis}
.win{position:absolute;left:${win.x}px;top:${win.y}px;width:${win.w}px;height:${win.h}px;overflow:hidden;border:3px solid #ff6d29;border-radius:6px;background:#2a2320}
.cam{position:absolute;inset:0}
.set{position:absolute;inset:-10%}
.sky{position:absolute;left:0;right:0;top:0;background:#3b302b;border-bottom:2px solid #6b5a52}
.fig{position:absolute;fill:#d9cbc2;opacity:.9}
.gfx{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 64px monospace;color:#ff6d29;letter-spacing:.2em}
.desc{position:absolute;left:0;right:0;bottom:0;padding:14px 20px;background:rgba(13,11,12,.82);font-size:${portrait ? 30 : 26}px;line-height:1.3}
.specs{position:absolute;left:${specs.x}px;top:${specs.y}px;width:${specs.w}px;display:flex;flex-direction:column;gap:${portrait ? 10 : 14}px}
.row{display:flex;flex-direction:column;gap:2px;opacity:0}
.row dt{font:600 18px monospace;color:#ff6d29;letter-spacing:.12em;text-transform:uppercase}
.row dd{font-size:${portrait ? 26 : 24}px;line-height:1.25;color:#fff;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.cap{position:absolute;left:60px;right:60px;top:${capY}px;display:flex;flex-direction:column;gap:6px;opacity:0}
.cap b{font:600 20px monospace;color:#bababa;letter-spacing:.12em;text-transform:uppercase}
.cap span{font-size:${portrait ? 34 : 32}px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
</style></head>
<body>
<div id="root" data-composition-id="${ID}" data-start="0" data-duration="${t}" data-width="${W}" data-height="${H}">
${clips.join('\n')}
</div>
<script>
(function(){
  var SHOTS = ${scriptJson(data)};
  var tl = gsap.timeline({paused:true});
  SHOTS.forEach(function(s){
    var el = document.getElementById(s.id), cam = el.querySelector('.cam');
    tl.fromTo(cam, s.from, Object.assign({}, s.to, {duration:s.dur, ease:'none'}), s.start);
    if (s.handheld) tl.fromTo(cam, {rotation:0}, {keyframes:[{rotation:.6},{rotation:-.5},{rotation:.4},{rotation:0}], duration:s.dur, ease:'none'}, s.start);
    tl.fromTo(el.querySelectorAll('.row'), {opacity:0}, {opacity:1, duration:.25, stagger:.08}, s.start + .1);
    tl.fromTo(el.querySelector('.cap'), {opacity:0}, {opacity:1, duration:.3}, s.start + .2);
  });
  window.__timelines["${ID}"] = tl;
})();
</script>
</body></html>
`;
}
