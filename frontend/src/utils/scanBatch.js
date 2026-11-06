// Continuous scanning on the receive page: the camera stays open and every label adds one piece.

// a scanned label is the bare code, or JSON on the old wing-arm labels ({"sku": ...}) — the code to use
export function cleanScannedCode(raw) {
  const text = String(raw ?? '').trim();
  if (!text.startsWith('{')) return text;
  try {
    const parsed = JSON.parse(text);
    return String(parsed.sku ?? parsed.model_code ?? parsed.code ?? '').trim();
  } catch {
    return text;
  }
}

// The camera reports a label on every frame it can read it. This decides which reports are a new piece:
// - a code must be read twice in a row, because barcodes held at an angle sometimes misread once
// - while a label stays in view it counts once; it counts again only after being out of view for clearMs
// Returns 'new' (a new piece), 'held' (already counted and still in view) or 'wait' (not sure of it yet).
export function createScanGate({ confirmHits = 2, clearMs = 1200 } = {}) {
  const seen = new Map();
  return (code, now = Date.now()) => {
    const entry = seen.get(code);
    if (!entry || now - entry.lastSeen >= clearMs) {
      seen.set(code, { hits: 1, lastSeen: now, counted: confirmHits <= 1 });
      return confirmHits <= 1 ? 'new' : 'wait';
    }
    entry.hits += 1;
    entry.lastSeen = now;
    if (entry.counted) return 'held';
    if (entry.hits < confirmHits) return 'wait';
    entry.counted = true;
    return 'new';
  };
}

const sameCode = (a, b) => a.toUpperCase() === b.toUpperCase();

// Basket rows are { code, qty }, newest scan first; the same code in any case is one row
export function addToBasket(items, code) {
  const existing = items.find((row) => sameCode(row.code, code));
  const others = items.filter((row) => row !== existing);
  return [{ code: existing ? existing.code : code, qty: (existing ? existing.qty : 0) + 1 }, ...others];
}

export function setBasketQty(items, code, qty) {
  if (qty <= 0) return items.filter((row) => !sameCode(row.code, code));
  return items.map((row) => (sameCode(row.code, code) ? { ...row, qty } : row));
}

export function basketQty(items, code) {
  return items.find((row) => sameCode(row.code, code))?.qty ?? 0;
}

// A note when the left and right of the same axle or level arrived in different numbers, or when only
// one side was scanned. rows: [{ position, qty }]. A warning only: buying a single side is normal.
export function sideBalanceNote(rows) {
  const groups = new Map();
  for (const { position, qty } of rows) {
    const match = /^(.*?)(left|right)$/.exec(position || '');
    if (!match) continue;
    if (!groups.has(match[1])) groups.set(match[1], { left: 0, right: 0 });
    groups.get(match[1])[match[2]] += qty;
  }
  const notes = [];
  for (const { left, right } of groups.values()) {
    if (left === 0 || right === 0) notes.push(`สแกนมาแค่ข้าง${left ? 'ซ้าย' : 'ขวา'} ถ้ามีอีกข้าง สแกนเพิ่มได้`);
    else if (left !== right) notes.push(`ซ้าย ${left} · ขวา ${right} ไม่เท่ากัน`);
  }
  return notes.join(' / ');
}

// The sound has to be unlocked from a tap (phones block audio otherwise), so the scan button calls this first
let audioContext = null;
export function prepareScanSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioContext) audioContext = new AudioCtx();
    if (audioContext.state === 'suspended') audioContext.resume();
  } catch {
    audioContext = null;
  }
}

export function signalScanned() {
  try {
    if (navigator.vibrate) navigator.vibrate(60);
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 1400;
    gain.gain.value = 0.15;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.09);
  } catch {
    // a missing sound must never stop the scan
  }
}
