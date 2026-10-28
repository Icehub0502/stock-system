// The model name staff see and save on a car: "Vios ปี '02-07". Several generations share one model name, so the
// short year range is part of the name; staff who do not know the year can ask the customer and pick.
// The catalogue label ("Vios (2002-2007)") stays the key of the price rows and is not shown to staff.
function displayModelName(model, yearRange) {
  if (!yearRange) return model;
  const match = /^(\d{4})-(\d{4}|ปัจจุบัน)$/.exec(yearRange);
  if (!match) return `${model} ปี ${yearRange}`;
  const short = (year) => year.slice(2);
  return `${model} ปี '${short(match[1])}-${match[2] === 'ปัจจุบัน' ? 'ปัจจุบัน' : short(match[2])}'`;
}

module.exports = { displayModelName };
