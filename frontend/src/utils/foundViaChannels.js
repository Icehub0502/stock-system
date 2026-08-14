// ชุดช่องทางคงที่ที่ลูกค้าเจอร้าน — ต้องตรงกับ FOUND_VIA_VALUES ใน
// backend/src/routes/customers.routes.js เป๊ะ ๆ (แก้ที่นี่ต้องแก้ที่นั่นด้วยเสมอ)
// ใช้ค่าคงที่แทนข้อความอิสระ เพื่อให้หน้าสรุปสถิติ (CustomerChannelPage.jsx) จัดกลุ่ม
// ได้ถูกต้องแม่นยำ — เก็บไว้ประกอบการตัดสินใจยิงโฆษณา
//
// ⚠️ ห้ามแก้/ลบค่า value ของ 4 ตัวแรก (google_map, facebook, friend, other) เพราะมี
// ข้อมูลลูกค้าที่บันทึกไว้ด้วยค่าพวกนี้อยู่แล้วในฐานข้อมูล — เพิ่มตัวใหม่ต่อท้ายได้
// icon ใช้เป็นสัญลักษณ์บนปุ่มเลือกช่องทาง ให้พนักงานกวาดตาหาเจอเร็วขึ้น
export const FOUND_VIA_CHANNELS = [
  { value: 'google_map', label: 'Google Maps', icon: '📍' },
  { value: 'facebook', label: 'Facebook', icon: '👍' },
  { value: 'friend', label: 'เพื่อนแนะนำ', icon: '🗣️' },
  { value: 'google_search', label: 'ค้นหาใน Google', icon: '🔎' },
  { value: 'tiktok', label: 'TikTok', icon: '🎵' },
  { value: 'line', label: 'LINE', icon: '💬' },
  { value: 'pass_by', label: 'ขับรถผ่าน / เห็นหน้าร้าน', icon: '🚗' },
  { value: 'shop_referral', label: 'อู่/ร้านอื่นแนะนำ', icon: '🔧' },
  { value: 'returning', label: 'เคยใช้บริการอยู่แล้ว', icon: '🔁' },
  { value: 'other', label: 'อื่นๆ ระบุ', icon: '➕' },
];

export function foundViaLabel(value) {
  return FOUND_VIA_CHANNELS.find((c) => c.value === value)?.label || value || '-';
}

export function foundViaIcon(value) {
  return FOUND_VIA_CHANNELS.find((c) => c.value === value)?.icon || '•';
}
