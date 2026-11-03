// The model name staff see and save on a car: "CRV G3 (ปี 2006-2011)". Several generations share one model name, so
// the generation and its years are part of the name; staff who do not know the year can ask the customer and pick.
// The catalogue label ("CRV G3 (2006-2011)") stays the key of the price rows and is not shown to staff.
function displayModelName(model, yearRange) {
  return yearRange ? `${model} (ปี ${yearRange})` : model;
}

// The display name used before November 2026 ("Vios ปี '02-07"). Cars saved back then still carry it, so a name in
// this form is still recognised when a car is matched to its generation.
function legacyDisplayModelName(model, yearRange) {
  if (!yearRange) return model;
  const match = /^(\d{4})-(\d{4}|ปัจจุบัน)$/.exec(yearRange);
  if (!match) return `${model} ปี ${yearRange}`;
  const short = (year) => year.slice(2);
  return `${model} ปี '${short(match[1])}-${match[2] === 'ปัจจุบัน' ? 'ปัจจุบัน' : short(match[2])}'`;
}

module.exports = { displayModelName, legacyDisplayModelName };
