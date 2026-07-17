import React, { useEffect, useState } from "react";
import client from "../api/client";
import QuotationPrintTemplate from "./QuotationPrintTemplate";
import PrintPortal from "./PrintPortal";
import useFitToWidth from "../hooks/useFitToWidth";

export default function QuotationPrintModal({ quotation, onClose, onPrinted }) {
  const [detail, setDetail] = useState(quotation);
  // Shrink the A4 preview to fit the modal on phones (see useFitToWidth). Only
  // the on-screen preview is scaled; the PrintPortal copy prints full A4.
  const { containerRef: previewRef, scale: previewScale } = useFitToWidth([detail]);
  const [justPrinted, setJustPrinted] = useState(false);

  useEffect(() => {
    if (!quotation?.items) {
      fetchDetail();
    }
  }, []);

  useEffect(() => {
    if (!justPrinted) return undefined;
    const timer = setTimeout(() => setJustPrinted(false), 2500);
    return () => clearTimeout(timer);
  }, [justPrinted]);

  // `window.print()` doesn't return a promise — 'afterprint' is the standard
  // browser signal that the print dialog closed (whether printed or
  // cancelled; the web platform has no way to tell those apart). Mirrors
  // ReceiptPrintModal.jsx so the list row also remembers "พิมพ์แล้ว" after
  // this modal closes, not just the button flash while it's still open.
  useEffect(() => {
    const handleAfterPrint = async () => {
      try {
        await client.patch(`/quotations/${quotation.id}/mark-printed`);
      } catch (err) {
        console.error('Error marking quotation as printed:', err);
      }
      if (onPrinted) onPrinted(quotation.id);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, [quotation.id, onPrinted]);

  const fetchDetail = async () => {
    try {
      const response = await client.get(`/quotations/${quotation.id}`);
      setDetail(response.data.data);
    } catch (err) {
      console.error("Error fetching quotation detail for print:", err);
    }
  };

  const handlePrint = () => {
    window.print();
    setJustPrinted(true);
  };

  const data = {
    quotation_no: detail.quotation_no,
    quotation_date: detail.quotation_date,
    queue_no: detail.queue_no,
    symptom: detail.symptom,
    customer: {
      customer_name: detail.customer_name,
      phone: detail.phone,
    },
    vehicle: {
      brand: detail.brand || detail.car_brand,
      model: detail.model || detail.car_model,
      color: detail.color || detail.car_color,
      license_plate: detail.license_plate,
      mileage: detail.mileage,
    },
    items: detail.items || [],
    remark: detail.remark,
    customer_signature: detail.customer_signature,
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card large print-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header print-header">
          <h2>ตัวอย่างการพิมพ์</h2>
          <div className="print-actions">
            <button className="btn btn-primary" onClick={handlePrint}>
              {justPrinted ? '✅ พิมพ์แล้วครับ' : '🖨️ พิมพ์'}
            </button>
            <button className="btn-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="print-content" ref={previewRef}>
          <div style={{ zoom: previewScale }}>
            <QuotationPrintTemplate data={data} />
          </div>
        </div>

        <div className="modal-footer no-print">
          <button className="btn btn-primary" onClick={handlePrint}>
            {justPrinted ? '✅ พิมพ์แล้วครับ' : '🖨️ พิมพ์'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
      <PrintPortal>
        <QuotationPrintTemplate data={data} />
      </PrintPortal>
    </div>
  );
}
