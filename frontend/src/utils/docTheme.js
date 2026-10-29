// Colour theme of the printed quotation / receipt, derived from one accent colour chosen by the shop.
// The page sets these as CSS variables on .doc-page; receipt.css falls back to the original colours when they are unset.

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const isHexColor = (value) => HEX_RE.test(String(value || ''));

function toRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function toHex(rgb) {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

// t = 0 → the colour itself, 1 → white
function lighten(hex, t) {
  return toHex(toRgb(hex).map((v) => v + (255 - v) * t));
}

// t = 0 → the colour itself, 1 → black
function darken(hex, t) {
  return toHex(toRgb(hex).map((v) => v * (1 - t)));
}

// WCAG relative luminance, 0 (black) … 1 (white)
function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// darken until the colour is dark enough to read as text on the light tint
function readableDark(hex) {
  let color = hex;
  for (let step = 0; step < 12 && luminance(color) > 0.12; step += 1) color = darken(color, 0.15);
  return color;
}

// Inline style (CSS variables) for .doc-page, or undefined to keep the stylesheet's default colours.
export function docThemeStyle(accent) {
  if (!isHexColor(accent)) return undefined;
  const strong = readableDark(accent);
  return {
    '--doc-rule': strong,
    '--doc-strong': strong,
    '--doc-meta-label': strong,
    '--doc-tint': lighten(accent, 0.88),
    '--doc-tint-border': lighten(accent, 0.55),
    '--doc-th-bg': accent,
    '--doc-th-text': luminance(accent) > 0.4 ? '#17171a' : '#ffffff',
  };
}
