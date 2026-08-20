// ช่องยกในร้าน — H1..H5 บวกช่องตั้งศูนย์ อีก 1 ช่อง (เจ้าของร้านยืนยันหน้างานจริง
// ว่ามี 5 ช่อง + ตั้งศูนย์ 1 ช่อง ไม่ใช่ 11 ช่องแบบที่โครง ChamppowerD ตั้งไว้)
// ถ้าหน้างานเพิ่ม/ลดช่อง แก้ที่นี่ที่เดียว แล้วแก้สำเนาฝั่งหน้าเว็บที่
// frontend/src/utils/workBays.js ให้ตรงกัน
const ALIGN_BAY = 'ตั้งศูนย์';

const WORK_BAYS = ['H1', 'H2', 'H3', 'H4', 'H5', ALIGN_BAY];

function isValidBay(bay) {
  return WORK_BAYS.includes(bay);
}

module.exports = { ALIGN_BAY, WORK_BAYS, isValidBay };
