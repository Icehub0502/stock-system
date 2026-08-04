// ชุดช่องทางคงที่ที่ลูกค้าเจอร้าน — ต้องตรงกับ FOUND_VIA_VALUES ใน
// backend/src/routes/customers.routes.js เป๊ะ ๆ (แก้ที่นี่ต้องแก้ที่นั่นด้วยเสมอ)
// ใช้ค่าคงที่แทนข้อความอิสระ เพื่อให้หน้าสรุปสถิติ (CustomerChannelPage.jsx) จัดกลุ่ม
// ได้ถูกต้องแม่นยำ — เก็บไว้ประกอบการตัดสินใจยิงโฆษณา
export const FOUND_VIA_CHANNELS = [
  { value: 'google_map', label: 'Google Map' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'friend', label: 'เพื่อนแนะนำ' },
  { value: 'other', label: 'อื่นๆ ระบุ' },
];

export function foundViaLabel(value) {
  return FOUND_VIA_CHANNELS.find((c) => c.value === value)?.label || value || '-';
}
