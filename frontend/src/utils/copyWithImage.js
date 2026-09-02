import { copyTextToClipboard } from './lineQuoteText';

// คัดลอกข้อความ + รูปพร้อมกันไปแปะในไลน์ได้เลย (สำหรับปุ่ม "คัดลอกคิว" ที่ต้องส่งรูป
// รถตอนรับเข้าไปด้วย) — ใช้ navigator.clipboard.write + ClipboardItem ซึ่งต้องมี
// secure context (HTTPS) เท่านั้น ต่างจาก copyTextToClipboard ที่มีทางสำรองสำหรับ
// HTTP บนวงแลนของร้าน เพราะ ClipboardItem ไม่มีทางสำรองแบบนั้นเลย (เจ้าของร้าน
// ยืนยันแล้วว่ารับได้แบบ best-effort — ถ้าคัดลอกรูปไม่ได้ก็คัดลอกแค่ข้อความแทนเงียบ ๆ
// ไม่ต้องมี error แยกสำหรับเคสนี้)
//
// คืนค่า { ok, withImage } — ok=false เฉพาะตอนคัดลอกไม่สำเร็จแม้แต่ข้อความอย่างเดียว
export async function copyTextAndImageToClipboard(text, imageDataUrl) {
  if (imageDataUrl && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      const sourceBlob = await (await fetch(imageDataUrl)).blob();
      // ClipboardItem รองรับ image/png แน่นอนที่สุดในทุกเบราว์เซอร์ (Safari เข้มงวด
      // สุด) — รูปรถต้นทางเก็บเป็น JPEG (resizeImageToDataUrl) จึงต้องวาดลง canvas
      // แปลงเป็น PNG ก่อนเสมอ
      const pngBlob = await jpegBlobToPngBlob(sourceBlob);
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': pngBlob,
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return { ok: true, withImage: true };
    } catch {
      // ตกไปคัดลอกข้อความอย่างเดียวด้านล่าง (เบราว์เซอร์ไม่รองรับ/ไม่ใช่ secure
      // context/ผู้ใช้ปฏิเสธสิทธิ์ ฯลฯ)
    }
  }
  const ok = await copyTextToClipboard(text);
  return { ok, withImage: false };
}

function jpegBlobToPngBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob((pngBlob) => (pngBlob ? resolve(pngBlob) : reject(new Error('toBlob failed'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('image load failed')); };
    img.src = objectUrl;
  });
}
