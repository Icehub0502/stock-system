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

// What a person has decided on the review screen, kept apart from what the server sorted, so going back to scan more
// and returning (a fresh sort) does not ask everything again. Every key is an upper-case code.
//   chosen   { item_id, position } picked for a code that needed choosing
//   asNew    "not that item, it is new", or a suggested pair that was turned down
//   attached yes to filling the blank side of an existing item
//   pairs    { left, right, confirmed }: pairs made by hand, confirmed or swapped
export const NO_DECISIONS = { chosen: {}, asNew: {}, attached: {}, pairs: [] };

// The server's sort + the decisions + what is still in the basket → the lists the review screen shows
export function applyReviewDecisions(resolved, decisions, hasCode) {
  const up = (code) => code.toUpperCase();
  const known = resolved.known.filter((row) => hasCode(row.code));
  const choose = [];
  const attach = [];
  let singles = resolved.singles.filter((row) => hasCode(row.code));
  let pairs = [];
  const asPlainSingle = (code, origin) => ({ code, side: null, partner: null, origin });

  for (const entry of resolved.choose) {
    if (!hasCode(entry.code)) continue;
    const picked = decisions.chosen[up(entry.code)];
    const match = picked && entry.matches.find((m) => m.item_id === picked.item_id && m.position === picked.position);
    if (match) known.push({ code: entry.code, match });
    else if (decisions.asNew[up(entry.code)]) singles.push(asPlainSingle(entry.code, { like: entry.matches[0].code }));
    else choose.push(entry);
  }
  for (const row of resolved.attach) {
    if (!hasCode(row.code)) continue;
    if (decisions.asNew[up(row.code)]) singles.push(asPlainSingle(row.code, { like: row.description || row.partner_code }));
    else attach.push({ ...row, accepted: Boolean(decisions.attached[up(row.code)]) });
  }
  for (const pair of resolved.pairs) {
    const both = hasCode(pair.left) && hasCode(pair.right);
    if (both && !decisions.asNew[up(pair.left)] && !decisions.asNew[up(pair.right)]) {
      pairs.push({ left: pair.left, right: pair.right, confirmed: false });
    } else {
      [pair.left, pair.right].filter(hasCode).forEach((code) => singles.push(asPlainSingle(code)));
    }
  }

  // saved pairs win over suggestions, as long as both codes are still new codes in this round
  for (const saved of decisions.pairs) {
    const inRound = (code) => singles.some((row) => up(row.code) === up(code))
      || pairs.some((p) => up(p.left) === up(code) || up(p.right) === up(code));
    if (!inRound(saved.left) || !inRound(saved.right)) continue;
    const taken = new Set([up(saved.left), up(saved.right)]);
    const freed = pairs.filter((p) => taken.has(up(p.left)) || taken.has(up(p.right)))
      .flatMap((p) => [p.left, p.right]).filter((code) => !taken.has(up(code)));
    // a confirmed or swapped pair keeps its place in the list
    const place = pairs.findIndex((p) => taken.has(up(p.left)) || taken.has(up(p.right)));
    pairs = pairs.filter((p) => !taken.has(up(p.left)) && !taken.has(up(p.right)));
    singles = singles.filter((row) => !taken.has(up(row.code)));
    freed.forEach((code) => singles.push(asPlainSingle(code)));
    pairs.splice(place < 0 ? pairs.length : place, 0, { left: saved.left, right: saved.right, confirmed: saved.confirmed });
  }
  return { known, choose, attach, pairs, singles };
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
