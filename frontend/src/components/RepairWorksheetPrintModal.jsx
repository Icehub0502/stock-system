import React, { useState } from 'react';
import RepairWorksheetPrintTemplate from './RepairWorksheetPrintTemplate';
import PrintPortal from './PrintPortal';
import useFitToWidth from '../hooks/useFitToWidth';

// ใบแจ้งซ่อมแบบใหม่ — พิมพ์ตรงๆ จากรายการที่เลือกไว้ในแผงใบเสนอราคา (JobDetailPage)
// ไม่มีการบันทึกลง DB เลย (ต่างจากระบบใบแจ้งซ่อมเดิมที่มีแถวใน repair_notices ให้
// แก้ไข/บันทึกได้) เพราะไม่มีอะไรต้องกรอกเพิ่ม — รายการมาจากใบเสนอราคาที่มีอยู่แล้ว
// พิมพ์ได้ทันทีทุกครั้งที่กด ไม่ต้อง sync สถานะ "บันทึกแล้ว/ยังไม่บันทึก" ให้ซับซ้อน
export default function RepairWorksheetPrintModal({ data, onClose }) {
  const { containerRef: previewRef, scale: previewScale } = useFitToWidth([data]);
  const [justPrinted, setJustPrinted] = useState(false);

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
