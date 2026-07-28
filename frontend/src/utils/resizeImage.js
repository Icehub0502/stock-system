// แปลงไฟล์รูปที่เลือกเป็น base64 data URI พร้อมย่อขนาด — ระบบนี้ไม่มี
// file-upload pipeline (เก็บเป็น LONGTEXT ตรงๆ ในฐานข้อมูลเหมือนลายเซ็น)
// ย่อไว้ก่อนแปลงกัน DB บวมจากรูปถ่ายกล้องที่มีขนาดใหญ่เกินจำเป็นสำหรับการ์ดอะไหล่
export function resizeImageToDataUrl(file, maxDimension = 640, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ไฟล์รูปไม่ถูกต้อง'));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
