import React, { useEffect } from 'react';

// รูปขยายเต็มจอ — ใช้ร่วมกันทุกที่ที่มีรูป (รูปรถตอนรับเข้า/รูปอะไหล่ใน JobDetailPage.jsx,
// ประวัติการเข้ารับบริการใน VisitTimeline.jsx) เจ้าของร้านขอ: thumbnail เล็กเกินไป
// มองยากตอนลูกค้ามาดูว่ารถตัวเองทำอะไรไปบ้าง — คลิกรูปแล้วขยายใหญ่ดูชัด ๆ ได้เลย
export default function PhotoLightbox({ src, onClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!src) return null;

  return (
    <div className="photo-lightbox-backdrop" onClick={onClose}>
      <img src={src} alt="" className="photo-lightbox-img" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="photo-lightbox-close" onClick={onClose} aria-label="ปิด">✕</button>
    </div>
  );
}
