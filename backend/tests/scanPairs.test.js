const { sideMarkers, likelySide, findPairs, oppositePosition, compactCode } = require('../src/utils/scanPairs');

describe('scanPairs — suggesting which scanned codes are the left and right of one part', () => {
  test('pairs codes that differ only by a side marker, wherever it sits', () => {
    expect(findPairs(['JET-1234L', 'JET-1234R']).pairs).toEqual([{ left: 'JET-1234L', right: 'JET-1234R' }]);
    expect(findPairs(['ABC-12-RH', 'ABC-12-LH']).pairs).toEqual([{ left: 'ABC-12-LH', right: 'ABC-12-RH' }]);
    expect(findPairs(['L1234', 'R1234']).pairs).toEqual([{ left: 'L1234', right: 'R1234' }]);
    expect(findPairs(['X-LEFT', 'X-RIGHT']).pairs).toEqual([{ left: 'X-LEFT', right: 'X-RIGHT' }]);
  });

  test('ignores case but keeps each code as it was scanned', () => {
    expect(findPairs(['jet-9l', 'JET-9R']).pairs).toEqual([{ left: 'jet-9l', right: 'JET-9R' }]);
  });

  test('an L or R inside a word is not a side', () => {
    expect(sideMarkers('BALL-100')).toEqual([]);
    expect(sideMarkers('RACK12')).toEqual([]);
    expect(likelySide('PLR-1')).toBeNull();
    expect(findPairs(['ALT-1', 'ART-1']).pairs).toEqual([]);
  });

  test('different families or different parts do not pair; leftovers stay in scan order', () => {
    expect(findPairs(['X-L', 'X-RH']).pairs).toEqual([]);
    const { pairs, singles } = findPairs(['A-1L', 'B-7', 'A-2R', 'C-1L', 'C-1R']);
    expect(pairs).toEqual([{ left: 'C-1L', right: 'C-1R' }]);
    expect(singles).toEqual(['A-1L', 'B-7', 'A-2R']);
  });

  test('a number and a letter opening the code is a part family, not a side (333: 3L link, 3R rack end)', () => {
    expect(sideMarkers('3L-H540')).toEqual([]);
    expect(likelySide('3R-1234')).toBeNull();
    expect(findPairs(['3L-H540', '3R-H540']).pairs).toEqual([]);
    // a side at the end of such a code still counts
    expect(findPairs(['3L-12R', '3L-12L']).pairs).toEqual([{ left: '3L-12L', right: '3L-12R' }]);
    // without a separator after it, a leading L or R is still read as a side
    expect(likelySide('L1234')).toBe('left');
  });

  test('a code joins only one pair', () => {
    const { pairs, singles } = findPairs(['A-12R', 'A-12L', 'A-12-L']);
    expect(pairs).toHaveLength(1);
    expect(singles).toHaveLength(1);
  });

  test('likelySide takes the last marker; oppositePosition keeps the rest of the position', () => {
    expect(likelySide('X-12L-R')).toBe('right');
    expect(likelySide('45510-0K010')).toBeNull();
    expect(oppositePosition('left')).toBe('right');
    expect(oppositePosition('front_upper_right')).toBe('front_upper_left');
    expect(oppositePosition('front')).toBeNull();
    expect(oppositePosition(null)).toBeNull();
  });

  test('compactCode ignores case and separators', () => {
    expect(compactCode('abc-12 3/4_5.6')).toBe('ABC123456');
  });
});
