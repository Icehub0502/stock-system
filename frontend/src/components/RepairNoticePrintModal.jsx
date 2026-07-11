import React, { useEffect, useState } from 'react';
import client from '../api/client';
import RepairNoticePrintTemplate from './RepairNoticePrintTemplate';
import PrintPortal from './PrintPortal';

export default function RepairNoticePrintModal({ noticeId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDetail();
  }, [noticeId]);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const response = await client.get(`/repair-notices/${noticeId}`);
      setDetail(response.data.data);
    } catch (err) {
      console.error('Error fetching repair notice for print:', err);
      alert('โหลดใบแจ้งซ่อมไม่สำเร็จ');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => window.print();

  if (loading || !detail) return null;

  // GET /repair-notices/:id returns brand/model/color/license_plate as flat
  // columns (a plain join), but the template expects them grouped under
  // `vehicle` like every other print template in this app.
  const printData = {
    ...detail,
    vehicle: {
      brand: detail.brand,
      model: detail.model,
      color: detail.color,
      license_plate: detail.license_plate,
      mileage: detail.mileage,
    },
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card large print-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header print-header">
          <h2>ตัวอย่างการพิมพ์</h2>
          <div className="print-actions">
            <button className="btn btn-primary" onClick={handlePrint}>🖨️ พิมพ์</button>
            <button className="btn-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="print-content">
          <RepairNoticePrintTemplate data={printData} />
        </div>

        <div className="modal-footer no-print">
          <button className="btn btn-primary" onClick={handlePrint}>🖨️ พิมพ์</button>
          <button className="btn btn-secondary" onClick={onClose}>ปิด</button>
        </div>
      </div>
      <PrintPortal>
        <RepairNoticePrintTemplate data={printData} />
      </PrintPortal>
    </div>
  );
}
