// Left and right codes of one part are often told apart by a marker in the code: JET-1234L / JET-1234R,
// 3L-100 / 3R-100, ABC-12-LH / ABC-12-RH. What comes out of here is only a suggestion and a person confirms
// every pair, because an L or R inside a code does not always mean a side.
const MARKER_RE = /(?<![A-Z])(LEFT|RIGHT|LH|RH|L|R)(?![A-Z])/g;
const SIDE = { L: 'left', LH: 'left', LEFT: 'left', R: 'right', RH: 'right', RIGHT: 'right' };
const OPPOSITE = { L: 'R', R: 'L', LH: 'RH', RH: 'LH', LEFT: 'RIGHT', RIGHT: 'LEFT' };

// Every side marker found in a code: which side it says, and what the code of the other side would be
function sideMarkers(code) {
  const text = String(code ?? '').toUpperCase();
  return [...text.matchAll(MARKER_RE)].map((m) => ({
    side: SIDE[m[1]],
    partner: `${text.slice(0, m.index)}${OPPOSITE[m[1]]}${text.slice(m.index + m[1].length)}`,
  }));
}

// The side a code looks like (the last marker, since the side usually ends the code), or null
function likelySide(code) {
  const markers = sideMarkers(code);
  return markers.length > 0 ? markers[markers.length - 1].side : null;
}

// Splits codes into suggested { left, right } pairs and the codes left over, keeping the order they came in
function findPairs(codes) {
  const byUpper = new Map(codes.map((code) => [String(code).toUpperCase(), code]));
  const used = new Set();
  const pairs = [];
  for (const code of codes) {
    if (used.has(code)) continue;
    for (const { side, partner } of sideMarkers(code)) {
      const other = byUpper.get(partner);
      if (other === undefined || other === code || used.has(other)) continue;
      used.add(code);
      used.add(other);
      pairs.push(side === 'left' ? { left: code, right: other } : { left: other, right: code });
      break;
    }
  }
  return { pairs, singles: codes.filter((code) => !used.has(code)) };
}

// The same position on the other side: 'left' → 'right', 'front_left' → 'front_right'; null when not split by side
function oppositePosition(position) {
  const match = /^(.*?)(left|right)$/.exec(String(position ?? ''));
  if (!match) return null;
  return `${match[1]}${match[2] === 'left' ? 'right' : 'left'}`;
}

// A code without case or separators, for spotting ABC-123 and abc123 as the same code on different labels
function compactCode(code) {
  return String(code ?? '').toUpperCase().replace(/[\s\-_./]/g, '');
}

module.exports = { sideMarkers, likelySide, findPairs, oppositePosition, compactCode };
