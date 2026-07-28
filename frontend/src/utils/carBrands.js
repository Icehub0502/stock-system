// รายการยี่ห้อรถมาตรฐานของระบบ — ใช้ร่วมกันทั้ง CarBrandAutocomplete (กรอกยี่ห้อรถ
// ลูกค้า) และ PartsCatalogKioskPage (เลือกยี่ห้อในหน้าเสนอราคาแท็บเล็ต) กันสอง
// รายการหลุดไม่ตรงกัน
export const CAR_BRANDS = [
  'Toyota', 'Honda', 'Nissan', 'Isuzu', 'Mitsubishi', 'Mazda', 'Ford',
  'Chevrolet', 'Suzuki', 'Subaru', 'BMW', 'Mercedes-Benz', 'Volkswagen',
  'Lexus', 'Hyundai', 'Kia', 'Volvo', 'MG', 'Proton', 'Haval', 'Range Rover',
];

// ใช้เป็นชื่อไฟล์โลโก้ที่คาดหวัง เช่น "Mercedes-Benz" -> "mercedes-benz"
export function brandLogoSlug(brand) {
  return (brand || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
