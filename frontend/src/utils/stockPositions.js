// ตำแหน่งของสต๊อกรวมที่แยกยอดต่อชิ้น — ใช้ร่วมกันทั้งหน้าสต๊อกรวมและหน้าสแกน
// ต้องตรงกับ backend/src/utils/stockPositions.js
//
// ติ๊กได้สามมิติพร้อมกัน: หน้า/หลัง (axle), บน/ล่าง (level), ซ้าย/ขวา (side) ตำแหน่ง = มิติที่เปิดใช้
// เรียงตาม axle → level → side ต่อกันด้วย "_" เช่น 'left', 'front_left', 'upper_left',
// 'front_upper_left' (ปีกนกบนซ้ายของเพลาหน้า)
const AXLES = ['front', 'rear'];
const LEVELS = ['upper', 'lower'];
const SIDES = ['left', 'right'];

const PART_LABEL = {
  front: 'หน้า', rear: 'หลัง',
  upper: 'บน', lower: 'ล่าง',
  left: 'ซ้าย', right: 'ขวา',
};

export function positionsFor(hasSides, hasAxles, hasLevels = false) {
  const dims = [];
  if (hasAxles) dims.push(AXLES);
  if (hasLevels) dims.push(LEVELS);
  if (hasSides) dims.push(SIDES);
  if (dims.length === 0) return [];
  return dims.reduce(
    (acc, dim) => acc.flatMap((prefix) => dim.map((part) => (prefix ? `${prefix}_${part}` : part))),
    ['']
  );
}

// "front_upper_left" → "หน้าบนซ้าย"
export function positionLabel(position) {
  if (!position) return '';
  return String(position).split('_').map((part) => PART_LABEL[part] || part).join('');
}

// สีประจำตำแหน่ง (ตัวอักษร / พื้นอ่อน): ซ้าย=น้ำเงิน ขวา=แดง หน้า=ม่วง หลัง=ส้ม บน=เขียวน้ำเงิน ล่าง=เหลืองเข้ม
// ส่วนตำแหน่งประกอบ ใช้สีตามลำดับในชุดของมัน (หน้าซ้าย น้ำเงิน, หน้าขวา แดง, หลังซ้าย เขียว,
// หลังขวา ส้ม ... ) ชุดหนึ่งมีไม่เกิน 8 ตำแหน่ง จึงไม่มีสีซ้ำกันภายในรายการเดียวกัน
const BLUE = { fg: '#1d4ed8', bg: '#dbeafe' };
const RED = { fg: '#b91c1c', bg: '#fee2e2' };
const GREEN = { fg: '#047857', bg: '#d1fae5' };
const ORANGE = { fg: '#c2410c', bg: '#ffedd5' };
const PURPLE = { fg: '#6d28d9', bg: '#ede9fe' };
const TEAL = { fg: '#0e7490', bg: '#cffafe' };
const PINK = { fg: '#be185d', bg: '#fce7f3' };
const AMBER = { fg: '#92400e', bg: '#fef3c7' };
const PALETTE = [BLUE, RED, GREEN, ORANGE, PURPLE, TEAL, PINK, AMBER];
const FIXED = { left: BLUE, right: RED, front: PURPLE, rear: ORANGE, upper: TEAL, lower: AMBER };

export const POSITION_COLOR = {};
[
  [false, false, false], // (ไม่มีตำแหน่ง)
  [true, false, false], [false, true, false], [false, false, true],
  [true, true, false], [true, false, true], [false, true, true], [true, true, true],
].forEach(([sides, axles, levels]) => {
  positionsFor(sides, axles, levels).forEach((position, index) => {
    POSITION_COLOR[position] = FIXED[position] || PALETTE[index];
  });
});

export const NEUTRAL_POSITION_COLOR = { fg: '#374151', bg: '#e5e7eb' };
