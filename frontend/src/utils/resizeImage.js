// ย่อรูปที่ถ่าย/เลือกก่อนส่งขึ้นเซิร์ฟเวอร์ (ฝั่งเซิร์ฟเวอร์เก็บเป็นไฟล์ — ดู
// backend/src/utils/photoStorage.js) รูปจากกล้องมือถือใหญ่ 5-12MB ต้องย่อก่อนเสมอ
//
// ทำไมเดิมช้า/บน Android เพิ่มรูปไม่ได้: อ่านไฟล์เป็น base64 ทั้งก้อนผ่าน FileReader
// แล้วค่อยให้ <img> ถอดรหัส (ก๊อปรูปใหญ่ซ้ำอีกชั้น ~33%) ทำแบบนี้ 2 รอบต่อรูป (รูปเต็ม +
// รูปย่อ) และถอดรหัสทุกรูปพร้อมกันหมด — มือถือแรมน้อยกินหน่วยความจำพุ่ง ช้าหรือพังเงียบ ๆ
// ตอนนี้ถอดรหัสแต่ละรูปครั้งเดียวด้วย createImageBitmap (ไม่ผ่าน base64 ไม่บล็อกหน้าจอ
// และหมุนรูปตาม EXIF ให้) แล้วสร้างรูปย่อจากรูปที่ย่อแล้ว ไม่ต้องถอดรหัสรูปต้นฉบับซ้ำ
// ประมวลผลทีละไม่กี่รูป (PHOTO_CONCURRENCY) กันหน่วยความจำพุ่ง
//
// นามสกุล/ชนิดไฟล์ที่รับ — Android บางเครื่อง/ตัวเลือกไฟล์ซ่อนไฟล์ที่ไม่มี MIME ชัดเจน
// (เช่น .heic/.heif/.jfif) ถ้าใส่แค่ image/* จึงใส่นามสกุลกำกับเพิ่มด้วย
export const IMAGE_ACCEPT = 'image/*,.jpg,.jpeg,.jfif,.png,.webp,.gif,.bmp,.avif,.heic,.heif';

const PHOTO_CONCURRENCY = 2;

async function decodeImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // เบราว์เซอร์เก่า/ไม่รองรับ option นี้ — ถอยไปใช้ <img> จาก object URL (ยังไม่ต้องแปลง
    // เป็น base64 ก่อน)
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('decode failed'));
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function drawScaled(source, sourceWidth, sourceHeight, maxDimension) {
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext('2d');
  // พื้นขาวรองไว้ — PNG โปร่งใสแปลงเป็น JPEG แล้วจะกลายเป็นพื้นดำถ้าไม่รอง
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function describeError(file) {
  const name = file?.name || 'รูป';
  const looksHeic = /\.(heic|heif)$/i.test(name) || /heic|heif/i.test(file?.type || '');
  return looksHeic
    ? `"${name}" เป็นไฟล์ HEIC/HEIF ที่เบราว์เซอร์เปิดไม่ได้ — ตั้งกล้องมือถือเป็นรูปแบบ JPEG (ปิด "High efficiency pictures") หรือถ่ายใหม่`
    : `"${name}" เปิดไม่ได้ (ไฟล์เสียหรือรูปแบบไม่รองรับ) — ลองถ่ายใหม่หรือเลือกรูปอื่น`;
}

// คงชื่อ/พารามิเตอร์เดิมไว้ — QuotePartPriceManagementPage.jsx ยังเรียกใช้ตรง ๆ
export async function resizeImageToDataUrl(file, maxDimension = 640, quality = 0.75) {
  let source;
  try {
    source = await decodeImage(file);
  } catch {
    throw new Error(describeError(file));
  }
  try {
    const canvas = drawScaled(source, source.width, source.height, maxDimension);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    if (typeof source.close === 'function') source.close();
  }
}

// รูปเต็ม (ดู/พิมพ์/ลูกค้าเซฟจากหน้า /track — 1280px คุณภาพสูงกันรูปแตก) + รูปย่อเล็กจริง ๆ
// (200px ให้การ์ดรายการงานวันนี้โหลดเบา) จากการถอดรหัสครั้งเดียว
async function resizePhotoPair(file) {
  let source;
  try {
    source = await decodeImage(file);
  } catch {
    throw new Error(describeError(file));
  }
  try {
    const fullCanvas = drawScaled(source, source.width, source.height, 1280);
    const thumbCanvas = drawScaled(fullCanvas, fullCanvas.width, fullCanvas.height, 200);
    return {
      full: fullCanvas.toDataURL('image/jpeg', 0.85),
      thumb: thumbCanvas.toDataURL('image/jpeg', 0.5),
    };
  } finally {
    if (typeof source.close === 'function') source.close();
  }
}

// ทำทีละ limit ไฟล์ รักษาลำดับผลลัพธ์ไว้ตามลำดับไฟล์ที่เลือก — รูปที่เปิดไม่ได้ไม่ทำให้
// ทั้งชุดล้ม แยกไปอยู่ใน failed ให้ผู้เรียกบอกผู้ใช้ว่ารูปไหนเสีย ส่วนรูปที่เหลือใช้ต่อได้เลย
async function processAll(files, worker) {
  const results = new Array(files.length);
  let next = 0;
  async function lane() {
    while (next < files.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { ok: await worker(files[index]) };
      } catch (err) {
        results[index] = { error: err, file: files[index] };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PHOTO_CONCURRENCY, files.length) }, lane));
  return {
    photos: results.filter((r) => r.ok !== undefined).map((r) => r.ok),
    failed: results.filter((r) => r.error).map((r) => ({ name: r.file.name, message: r.error.message })),
  };
}

export function resizePhotos(files) {
  return processAll(files, resizePhotoPair);
}

export function resizeFullPhotos(files) {
  return processAll(files, (file) => resizeImageToDataUrl(file, 1280, 0.85));
}

export function describePhotoFailures(failed) {
  return failed.map((f) => f.message).join(' / ');
}
