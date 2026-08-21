import React, { useEffect, useState } from "react";
import client from "../api/client";
import QuotationPrintTemplate from "./QuotationPrintTemplate";
import PrintPortal from "./PrintPortal";
import SignatureModal from "./SignatureModal";
import useFitToWidth from "../hooks/useFitToWidth";
import { buildLineQuoteText, copyTextToClipboard } from "../utils/lineQuoteText";

// signatureUrl/staffSignatureUrl/markPrintedUrl/skipFetch: ให้ผู้เรียกที่ไม่ใช่
// ใบเสนอราคาจริง (เช่น JobDetailPage.jsx ตอนแสดง quote_draft ก่อนตัดสินใจ) ชี้ปลายทาง
// บันทึกลายเซ็น/ไม่ต้อง fetch/ไม่ต้อง mark-printed ไปที่อื่นแทนได้ — ไม่ระบุ (ปกติ)
// = พฤติกรรมเดิมทุกอย่าง คำนวณจาก quotation.id เหมือนเดิม
export default function QuotationPrintModal({
  quotation, onClose, onPrinted,
  signatureUrl, staffSignatureUrl, markPrintedUrl, skipFetch = false,
}) {
  const sigUrl = signatureUrl || `/quotations/${quotation.id}/signature`;
  const staffSigUrl = staffSignatureUrl || `/quotations/${quotation.id}/staff-signature`;
  const printedUrl = markPrintedUrl === undefined ? `/quotations/${quotation.id}/mark-printed` : markPrintedUrl;
  const [detail, setDetail] = useState(quotation);
  // Shrink the A4 preview to fit the modal on phones (see useFitToWidth). Only
  // the on-screen preview is scaled; the PrintPortal copy prints full A4.
  const { containerRef: previewRef, scale: previewScale } = useFitToWidth([detail]);
  const [justPrinted, setJustPrinted] = useState(false);
  // เซ็นเอกสารย้ายมาไว้ในหน้าพิมพ์แทนปุ่มแยกในตารางหลัก — เซ็นแล้วเห็นผลทันทีในตัวอย่าง
  // ก่อนพิมพ์จริง (เหมาะกับ flow จริง: ให้ลูกค้าเซ็นตอนจะพิมพ์เอกสารให้)
  const [showSignature, setShowSignature] = useState(false);
  const [showStaffSignature, setShowStaffSignature] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyLineText = async () => {
    const ok = await copyTextToClipboard(buildLineQuoteText(detail));
    if (!ok) {
      alert('คัดลอกข้อความไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSaveSignature = async (dataUrl) => {
    await client.patch(sigUrl, { signature: dataUrl });
    setDetail((prev) => ({ ...prev, customer_signature: dataUrl }));
  };

  const handleSaveStaffSignature = async (dataUrl) => {
    await client.patch(staffSigUrl, { signature: dataUrl });
    setDetail((prev) => ({ ...prev, staff_signature: dataUrl }));
  };

  useEffect(() => {
    if (!quotation?.items && !skipFetch) {
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
      if (printedUrl) {
        try {
          await client.patch(printedUrl);
        } catch (err) {
          console.error('Error marking quotation as printed:', err);
        }
      }
      if (onPrinted) onPrinted(quotation.id);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, [printedUrl, onPrinted]);

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
      // ใบที่ไม่เคยบันทึกเลขไมล์ของตัวเอง (0/ว่าง เช่นใบจากไลน์รุ่นเก่า) →
      // ใช้เลขไมล์ล่าสุดของรถแทน จะได้ตรงกับที่แก้ในหน้าข้อมูลรถ
      mileage: detail.mileage || detail.vehicle_mileage,
    },
    items: detail.items || [],
    remark: detail.remark,
    customer_signature: detail.customer_signature,
    staff_signature: detail.staff_signature,
    staff_name: detail.staff_name,
    deposit_amount: detail.deposit_amount,
    deposit_date: detail.deposit_date,
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card large print-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header print-header">
          <h2>ตัวอย่างการพิมพ์</h2>
          <div className="print-actions">
            <button className="btn btn-secondary" onClick={handleCopyLineText}>
              {copied ? '✅ คัดลอกแล้ว' : '📋 คัดลอกข้อความ'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowStaffSignature(true)}>
              {detail.staff_signature ? '✓ ผู้เสนอราคาเซ็นแล้ว (แก้ไข)' : 'เซ็นผู้เสนอราคา'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowSignature(true)}>
              {detail.customer_signature ? '✓ เซ็นแล้ว (แก้ไข)' : 'เซ็นเอกสาร'}
            </button>
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
      {showSignature && (
        <SignatureModal
          title="เซ็นชื่อลูกค้า"
          subtitle="ให้ลูกค้าเซ็นชื่อยืนยันในกรอบด้านล่าง"
          onSave={handleSaveSignature}
          onClose={() => setShowSignature(false)}
        />
      )}
      {showStaffSignature && (
        <SignatureModal
          title="เซ็นชื่อผู้เสนอราคา"
          subtitle="พนักงานผู้เสนอราคาเซ็นชื่อยืนยันในกรอบด้านล่าง"
          onSave={handleSaveStaffSignature}
          onClose={() => setShowStaffSignature(false)}
        />
      )}
    </div>
  );
}
