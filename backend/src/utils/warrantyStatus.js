// Which sold items the warranty register follows, and how long their warranty has left.
// A warranty ends at its time limit or its distance limit, whichever comes first.

const RACK_WORDS = ['แร็ค', 'แรค', 'แร็ก', 'rack'];
// the owner's list (2026-11-06): racks, suspension sets and ball joints
const REGISTER_WORDS = [...RACK_WORDS, 'ลูกหมาก', 'ชุดโปร', 'โปรช่วงล่าง', 'ชุดช่วงล่าง', 'ชุดดโปร'];

const SOON_DAYS = 30;
const SOON_KM = 2000;

const hasWord = (text, words) => {
  const lower = String(text ?? '').toLowerCase();
  return words.some((word) => lower.includes(word));
};
const isRackText = (text) => hasWord(text, RACK_WORDS);
const isRegisterText = (text) => hasWord(text, REGISTER_WORDS);

function pad(n) {
  return String(n).padStart(2, '0');
}

// today as YYYY-MM-DD in Thailand, whatever the server's time zone is
function todayInThailand(now = new Date()) {
  const thai = new Date(now.getTime() + 7 * 3600 * 1000);
  return `${thai.getUTCFullYear()}-${pad(thai.getUTCMonth() + 1)}-${pad(thai.getUTCDate())}`;
}

// "2026-01-31" + 1 month → "2026-02-28": the end of a shorter month, never a day into the next one
function addMonths(dateStr, months) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, lastDay))}`;
}

function daysBetween(fromStr, toStr) {
  const toMs = (s) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toMs(toStr) - toMs(fromStr)) / 86400000);
}

// startDate, startKm: from the bill. currentKm: the car's last known reading.
// status: none (no warranty on the bill) | active | soon | expired
function warrantyStatus({ warrantyYear, warrantyMonth, warrantyKm, startDate, startKm, currentKm, today = todayInThailand() }) {
  const months = (Number(warrantyYear) || 0) * 12 + (Number(warrantyMonth) || 0);
  const distance = Number(warrantyKm) || 0;
  if (months <= 0 && distance <= 0) {
    return { status: 'none', expires_on: null, days_left: null, km_limit: null, km_left: null };
  }
  const expiresOn = months > 0 && startDate ? addMonths(startDate, months) : null;
  const daysLeft = expiresOn ? daysBetween(today, expiresOn) : null;

  // without a reading on the bill the distance limit cannot be worked out, only the time limit counts
  const start = Number(startKm) || 0;
  const kmLimit = distance > 0 && start > 0 ? start + distance : null;
  const kmLeft = kmLimit === null ? null : kmLimit - Math.max(Number(currentKm) || 0, start);

  let status = 'active';
  if ((daysLeft !== null && daysLeft < 0) || (kmLeft !== null && kmLeft <= 0)) status = 'expired';
  else if ((daysLeft !== null && daysLeft <= SOON_DAYS) || (kmLeft !== null && kmLeft <= SOON_KM)) status = 'soon';
  return { status, expires_on: expiresOn, days_left: daysLeft, km_limit: kmLimit, km_left: kmLeft };
}

module.exports = { isRackText, isRegisterText, todayInThailand, addMonths, daysBetween, warrantyStatus };
