const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

export function formatDateTh(dateStr) {
  return new Date(dateStr).toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// "2026-08" → "สิงหาคม 2569" — หัวข้อ "แฟ้ม" เดือน
export function formatMonthTh(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}

// "2026" → "ปี 2569" — หัวข้อ "แฟ้ม" ปี
export function formatYearTh(yearKey) {
  return `ปี ${Number(yearKey) + 543}`;
}

// จัดกลุ่มรายการเป็นแฟ้ม 3 ชั้น: ปี → เดือน → วัน (ใหม่สุดอยู่บนสุดเสมอ) — ให้หน้า
// รายการ (ใบเสนอราคา/ใบเสร็จ/ใบแจ้งซ่อม) พับข้อมูลเก่าเก็บไว้เหมือนหน้าสรุปยอด
// (DailySalesSummaryPage.jsx) แทนที่จะแสดงทุกวันยาวเป็นตารางเดียวที่โตขึ้นเรื่อย ๆ
// ตามอายุระบบ — dateOf(item) ต้องคืนสตริง "YYYY-MM-DD" เสมอ (ผู้เรียกกรองรายการที่
// ไม่มีวันที่ออกไปก่อนแล้ว)
export function buildArchiveGroups(items, dateOf) {
  const years = [];
  const yearIndex = new Map();

  for (const item of items) {
    const dateStr = dateOf(item);
    const yearKey = dateStr.slice(0, 4);
    const monthKey = dateStr.slice(0, 7);

    let year = yearIndex.get(yearKey);
    if (!year) {
      year = { key: yearKey, months: [], monthIndex: new Map(), count: 0 };
      yearIndex.set(yearKey, year);
      years.push(year);
    }
    year.count += 1;

    let month = year.monthIndex.get(monthKey);
    if (!month) {
      month = { key: monthKey, days: [], dayIndex: new Map(), count: 0 };
      year.monthIndex.set(monthKey, month);
      year.months.push(month);
    }
    month.count += 1;

    let day = month.dayIndex.get(dateStr);
    if (!day) {
      day = { key: dateStr, rows: [] };
      month.dayIndex.set(dateStr, day);
      month.days.push(day);
    }
    day.rows.push(item);
  }

  years.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  for (const year of years) {
    year.months.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    for (const month of year.months) {
      month.days.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    }
  }
  return years;
}
