// ตำแหน่งของสต๊อกรวมที่แยกยอดต่อชิ้น: ติ๊กได้สามมิติพร้อมกัน — หน้า/หลัง (axle), บน/ล่าง (level),
// ซ้าย/ขวา (side) ตำแหน่ง = ส่วนที่เปิดใช้เรียงตามลำดับ axle → level → side ต่อกันด้วย "_"
// เช่น 'left', 'front_left', 'upper_left', 'front_upper_left' (ปีกนกบนซ้ายของเพลาหน้า)
// ต้องตรงกับ frontend/src/utils/stockPositions.js
const AXLES = ['front', 'rear'];
const LEVELS = ['upper', 'lower'];
const SIDES = ['left', 'right'];

const PART_LABEL = {
  front: 'หน้า', rear: 'หลัง',
  upper: 'บน', lower: 'ล่าง',
  left: 'ซ้าย', right: 'ขวา',
};

function positionsFor(hasSides, hasAxles, hasLevels = false) {
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
function positionLabel(position) {
  if (!position) return null;
  return String(position).split('_').map((part) => PART_LABEL[part] || part).join('');
}

module.exports = { positionsFor, positionLabel };
