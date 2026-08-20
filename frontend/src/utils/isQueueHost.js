// true เมื่อเปิดผ่าน queue.champ-powerspk.com — ใช้แยกว่าแอปควรแสดงเป็น "ระบบคิว
// รับรถ" แบบเอกเทศ (เมนูมีแค่รับรถเข้าคิว/รายการงานวันนี้ ไม่มีสต๊อก/ใบเสนอราคา/
// รายงานของระบบหลักปนมาให้เห็น) หรือแอปเต็มแบบเดิม — โค้ด/backend/login ยังเป็น
// ตัวเดียวกันทั้งหมด (เจ้าของร้านเลือกไว้ตอนวางแผน) แค่ "หน้าตา" ที่ต่างกันตาม host
// ทำงานได้ทั้ง production (queue.champ-powerspk.com) และตอน dev/preview local
// (เผื่อทดสอบผ่าน query string ?queue=1 โดยไม่ต้องตั้ง DNS/hosts file เพิ่ม)
const DEV_FLAG_KEY = '__queueHostDev';

export function isQueueHost() {
  if (typeof window === 'undefined') return false;
  if (window.location.hostname.startsWith('queue.')) return true;

  // ?queue=1 เอาไว้ทดสอบ local เท่านั้น (production ใช้ hostname จริงล้วน ๆ ไม่
  // ต้องพึ่งอันนี้เลย) — จำไว้ใน sessionStorage เพราะ query string หายไปทันทีที่
  // navigate ด้วย react-router (เช่นตอน login แล้วเด้งไปหน้าอื่น) ถ้าไม่จำไว้
  // แถบเมนูจะสลับกลับเป็นแอปเต็มหลังจากคลิกลิงก์แรกทันที
  if (new URLSearchParams(window.location.search).get('queue') === '1') {
    sessionStorage.setItem(DEV_FLAG_KEY, '1');
    return true;
  }
  return sessionStorage.getItem(DEV_FLAG_KEY) === '1';
}
