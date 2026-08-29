import React, { useEffect, useState } from 'react';
import client from '../api/client';
import RepairWorksheetPrintTemplate from './RepairWorksheetPrintTemplate';
import PrintPortal from './PrintPortal';
import useFitToWidth from '../hooks/useFitToWidth';

// ใบแจ้งซ่อมแบบใหม่ — พิมพ์ตรงๆ จากรายการที่เลือกไว้ในแผงใบเสนอราคา (JobDetailPage)
// ตัวเนื้อหาไม่มีแถวของตัวเองใน DB เลย (ต่างจากระบบใบแจ้งซ่อมเดิมที่มีแถวใน
// repair_notices ให้แก้ไข/บันทึกได้) เพราะไม่มีอะไรต้องกรอกเพิ่ม — รายการมาจากใบเสนอ
// ราคาที่มีอยู่แล้ว พิมพ์ได้ทันทีทุกครั้งที่กด ไม่ต้อง sync เนื้อหา "บันทึกแล้ว/ยังไม่
// บันทึก" ให้ซับซ้อน — แต่ "พิมพ์แล้วหรือยัง" (แค่ timestamp เดียว ไม่ใช่เนื้อหา) ยัง
// อยากให้จำไว้โชว์เป็นป้ายที่หน้ารายการงานวันนี้ได้ (JobBoardPage.jsx) เลยเก็บไว้ที่
// jobs.repair_notice_printed_at ตรงๆ (markPrintedUrl) — มิเรอร์ pattern เดียวกับ
// QuotationPrintModal.jsx (ดู 'afterprint' ด้านล่าง)
export default function RepairWorksheetPrintModal({ data, onClose, markPrintedUrl }) {
  const { containerRef: previewRef, scale: previewScale } = useFitToWidth([data]);
  const [justPrinted, setJustPrinted] = useState(false);

  useEffect(() => {
    if (!markPrintedUrl) return undefined;
    const handleAfterPrint = async () => {
      try {
        await client.patch(markPrintedUrl);
      } catch (err) {
        console.error('Error marking repair worksheet as printed:', err);
      }
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, [markPrintedUrl]);

  const handlePrint = () => {
    window.print();
    setJustPrinted(true);
    setTimeout(() => setJustPrinted(false), 2500);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card large print-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header print-header">
          <h2>ใบแจ้งซ่อม (ตัวอย่างการพิมพ์)</h2>
          <div className="print-actions">
            <button className="btn btn-primary" onClick={handlePrint}>
              {justPrinted ? '✅ พิมพ์แล้วครับ' : '🖨️ พิมพ์'}
            </button>
            <button className="btn-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="print-content" ref={previewRef}>
          <div style={{ zoom: previewScale }}>
            <RepairWorksheetPrintTemplate data={data} />
          </div>
        </div>

        <div className="modal-footer no-print">
          <button className="btn btn-primary" onClick={handlePrint}>
            {justPrinted ? '✅ พิมพ์แล้วครับ' : '🖨️ พิมพ์'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>ปิด</button>
        </div>
      </div>
      <PrintPortal>
        <RepairWorksheetPrintTemplate data={data} />
      </PrintPortal>
    </div>
  );
}
