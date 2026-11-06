// A standard price is kept by item name per vehicle generation, stock by part code, and nothing links the two. The price
// list works out which stock a price is about from the kind of part and the car. It is a best guess, so the page always
// shows the codes it found, and when the kind of part cannot be told it reports nothing instead of guessing.
const { normalizeName } = require('./normalizeName');

// checked in order: ลูกหมากปลายแร็ค is a ball joint, not a rack
const PART_KINDS = [
  ['ลูกหมาก'],
  ['ปีกนก'],
  ['โช๊ค', 'โช้ค', 'shock'],
  ['ยางกันโคลง', 'ยางรัดกันโคลง'],
  ['บูช'],
  ['เพลา'],
  ['ผ้าเบรก', 'จานเบรก'],
  ['แร็ค', 'แรค', 'แร็ก', 'rack'],
];
// a price that names one of these only matches stock that names it too
const REQUIRED_WORDS = ['ปลาย', 'กันโคลง', 'คันชัก', 'กล้องยา', 'มือสอง', 'บิวใหม่'];
const OPPOSITES = [['หน้า', 'หลัง'], ['บน', 'ล่าง']];

function partKind(text) {
  const lower = String(text ?? '').toLowerCase();
  const index = PART_KINDS.findIndex((words) => words.some((word) => lower.includes(word)));
  return index < 0 ? null : index;
}

// "Vios G2" and "Vios" are the same car for this purpose: one name starts with the other
function sameModelName(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x.length < 3 || y.length < 3) return false;
  return x.startsWith(y) || y.startsWith(x);
}

function yearsOf(yearRange) {
  const found = String(yearRange ?? '').match(/\d{4}/g);
  if (!found) return null;
  return { from: Number(found[0]), to: Number(found[found.length - 1]) };
}

function yearsOverlap(range, yearFrom, yearTo) {
  if (!range || (yearFrom == null && yearTo == null)) return true;
  return (yearFrom ?? 0) <= range.to && (yearTo ?? 9999) >= range.from;
}

// Does this stock item fit this generation? Its car models when it lists any, else the model named in its description.
function fitsCar(stock, car) {
  if (stock.fitments.length > 0) {
    const range = yearsOf(car.year_range);
    return stock.fitments.some((f) => String(f.brand).toLowerCase() === String(car.brand).toLowerCase()
      && sameModelName(f.model, car.model)
      && yearsOverlap(range, f.year_from, f.year_to));
  }
  const firstWord = normalizeName(String(car.model).split(/\s+/)[0]);
  return firstWord.length >= 3 && normalizeName(stock.description).includes(firstWord);
}

function sameKindOfPart(itemName, stock) {
  const kind = partKind(itemName);
  const stockText = `${stock.category_name} ${stock.description}`;
  if (kind === null || partKind(stockText) !== kind) return false;
  if (REQUIRED_WORDS.some((word) => itemName.includes(word) && !stockText.includes(word))) return false;
  // a front part is not a rear one, unless the stock item holds both
  return !OPPOSITES.some(([one, other]) => (itemName.includes(one) && stockText.includes(other) && !stockText.includes(one))
    || (itemName.includes(other) && stockText.includes(one) && !stockText.includes(other)));
}

// The stock items a price line is about. A promo set is many parts, so it matches nothing.
function findStockFor(line, stockItems) {
  if (line.is_set) return [];
  return stockItems.filter((stock) => sameKindOfPart(line.item_name, stock) && fitsCar(stock, line));
}

module.exports = { partKind, sameModelName, fitsCar, sameKindOfPart, findStockFor };
