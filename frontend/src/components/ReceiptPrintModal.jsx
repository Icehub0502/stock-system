import React, { useEffect, useState } from "react";
import client from "../api/client";
import ReceiptPrintTemplate from "./ReceiptPrintTemplate";
import PrintPortal from "./PrintPortal";

export default function ReceiptPrintModal({ receiptId, onClose, onPrinted }) {
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (receiptId) {
      loadReceipt(receiptId);
    }
  }, [receiptId]);

  // `window.print()` doesn't return a promise — 'afterprint' is the standard
  // browser signal that the print dialog closed (whether printed or
  // cancelled; the web platform has no way to tell those apart).
  useEffect(() => {
    const handleAfterPrint = async () => {
      try {
        await client.patch(`/receipts/${receiptId}/mark-printed`);
      } catch (err) {
        console.error('Error marking receipt as printed:', err);
      }
      if (onPrinted) onPrinted(receiptId, receipt?.receipt_date);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, [receiptId, receipt, onPrinted]);

  const loadReceipt = async (id) => {
    setLoading(true);
    try {
      const response = await client.get(`/receipts/${id}`);
      setReceipt(response.data.data);
    } catch (err) {
      console.error('Error loading receipt for print:', err);
      alert('โหลดรายละเอียดบิลไม่สำเร็จ');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  if (!receipt && loading) return null;

  const previewData = {
    receipt_no: receipt.receipt_no,
    receipt_date: receipt.receipt_date,
    pic: receipt.pic || '',
    customer: {
      customer_name: receipt.customer_name,
      customer_code: receipt.customer_code,
      phone: receipt.phone,
    },
    vehicle: {
      brand: receipt.brand,
      model: receipt.model,
      color: receipt.color,
      license_plate: receipt.license_plate,
      mileage: receipt.mileage,
    },
    items: receipt.items || [],
    remark: receipt.remark || '',
    discount: receipt.discount || 0,
    vat: receipt.vat || 0,
    total_amount: receipt.total_amount,
  };

  return (
    <div className="modal-backdrop receipt-print-modal-backdrop" onClick={onClose}>
      <div className="modal-card large receipt-print-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="receipt-print-toolbar">
          <div>
            <h2>พิมพ์ใบเสร็จ</h2>
            <p>ตรวจสอบข้อมูลก่อนพิมพ์หรือบันทึกเป็น PDF</p>
          </div>
          <div className="receipt-print-actions">
            <button className="btn btn-secondary" onClick={onClose}>ปิด</button>
            <button className="btn btn-primary" onClick={() => window.print()}>พิมพ์ / บันทึก PDF</button>
          </div>
        </div>
        <div className="receipt-print-surface">
          <ReceiptPrintTemplate data={previewData} />
        </div>
      </div>
      <PrintPortal>
        <ReceiptPrintTemplate data={previewData} />
      </PrintPortal>
    </div>
  );
}
