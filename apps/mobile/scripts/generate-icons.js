/**
 * Generates all required app icons from the Litara brand SVG.
 * Requires: npx sharp-cli (auto-downloaded via npx)
 *
 * Usage: node scripts/generate-icons.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets', 'images');
const tmpDir = path.join(__dirname, '..', '.tmp-icon-svgs');

if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

// Litara logo — three stacked book spines (from apps/web/public/logo.svg)
// Original canvas: 56×56. Content spans x=4..52 (48u wide), y=14..52 (38u tall).
const RECTS = [
  { x: 4,  y: 42, w: 48, h: 10, rx: 3, fill: '#228be6' }, // bottom (widest, darkest)
  { x: 8,  y: 28, w: 36, h: 10, rx: 3, fill: '#339af0' }, // middle
  { x: 14, y: 14, w: 28, h: 10, rx: 3, fill: '#74c0fc' }, // top (narrowest, lightest)
];

const CONTENT_X_MIN = 4;  // leftmost rect starts here
const CONTENT_W    = 48;  // 52 - 4
const CONTENT_Y_MIN = 14; // topmost rect starts here
const CONTENT_H    = 38;  // 52 - 14

/**
 * Build an SVG string.
 * @param {object} opts
 * @param {number} opts.canvasSize   - Output canvas px (square)
 * @param {string|null} opts.bg      - Background fill colour, or null for transparent
 * @param {number} opts.logoPx       - Target width of the logo content area in px
 * @param {string|null} opts.monoFill - If set, override all rect fills with this colour
 */
function buildSvg({ canvasSize, bg, logoPx, monoFill }) {
  const scale = logoPx / CONTENT_W;
  const scaledH = CONTENT_H * scale;

  // Translate so the content area is centred on the canvas
  const tx = (canvasSize - logoPx) / 2 - CONTENT_X_MIN * scale;
  const ty = (canvasSize - scaledH) / 2 - CONTENT_Y_MIN * scale;

  const bgRect = bg
    ? `<rect width="${canvasSize}" height="${canvasSize}" fill="${bg}"/>`
    : '';

  const rects = RECTS.map(r =>
    `    <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.rx}" fill="${monoFill ?? r.fill}"/>`
  ).join('\n');

  return `<svg width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}" xmlns="http://www.w3.org/2000/svg">
  ${bgRect}
  <g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(6)})">
${rects}
  </g>
</svg>`;
}

// ─── Icon specifications ────────────────────────────────────────────────────

const ICONS = [
  {
    // iOS app icon — solid background required, no transparency
    file: 'icon.png',
    canvasSize: 1024,
    bg: '#0a0a0a',
    logoPx: 600,      // ~58% of canvas
  },
  {
    // Expo splash screen centre image — transparent bg (bgcolor set in app.json).
    // imageWidth in app.json is 200dp; logo fills ~80% of canvas so it renders ~160dp wide.
    file: 'splash-icon.png',
    canvasSize: 1024,
    bg: null,
    logoPx: 820,
  },
  {
    // Android adaptive icon foreground — must stay within inner 66% safe zone
    // Safe zone = 340px of 512. Use 300px for breathing room.
    file: 'android-icon-foreground.png',
    canvasSize: 512,
    bg: null,
    logoPx: 300,
  },
  {
    // Android adaptive icon background — solid brand dark colour
    file: 'android-icon-background.png',
    canvasSize: 512,
    bg: '#0a0a0a',
    logoPx: 0,        // background only
    bgOnly: true,
  },
  {
    // Android themed/monochrome icon — white logo on transparent bg
    file: 'android-icon-monochrome.png',
    canvasSize: 432,
    bg: null,
    logoPx: 260,
    monoFill: '#ffffff',
  },
  {
    // Web favicon
    file: 'favicon.png',
    canvasSize: 64,
    bg: '#0a0a0a',
    logoPx: 40,
  },
];

// ─── Generate ───────────────────────────────────────────────────────────────

let ok = 0;
let fail = 0;

for (const icon of ICONS) {
  const svgPath = path.join(tmpDir, icon.file.replace('.png', '.svg'));
  const outPath = path.join(assetsDir, icon.file);

  // Build SVG
  let svg;
  if (icon.bgOnly) {
    svg = `<svg width="${icon.canvasSize}" height="${icon.canvasSize}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${icon.canvasSize}" height="${icon.canvasSize}" fill="${icon.bg}"/>
</svg>`;
  } else {
    svg = buildSvg(icon);
  }

  fs.writeFileSync(svgPath, svg, 'utf8');

  try {
    execSync(`npx --yes sharp-cli -i "${svgPath}" -o "${outPath}"`, {
      stdio: 'pipe',
      cwd: path.join(__dirname, '..'),
    });
    console.log(`  ✓  ${icon.file}  (${icon.canvasSize}×${icon.canvasSize})`);
    ok++;
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString().trim().split('\n').slice(-3).join(' | ');
    console.error(`  ✗  ${icon.file}: ${msg}`);
    fail++;
  }
}

// Cleanup temp SVGs
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${ok} generated, ${fail} failed.`);
if (fail > 0) process.exit(1);
