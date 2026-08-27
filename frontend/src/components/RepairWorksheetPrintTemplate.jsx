import React from 'react';

// ใบแจ้งซ่อมแบบใหม่ — ให้หน้าตาเหมือนใบแจ้งซ่อมกระดาษแบบเดิม (checklist ตัวใหญ่
// ติ๊ก ✓ ไม่ใช่ตารางใบเสร็จ/ใบเสนอราคา) แต่รายการมาจากใบเสนอราคาที่เลือกไว้แล้ว
// โดยตรง ไม่ต้องติ๊กเลือกซ้ำเอง (ต่างจาก RepairNoticePrintTemplate.jsx เดิมที่เป็น
// checklist 9 หมวดตายตัว มีรูปประกอบ) — ตั้งใจไม่ใช้รูปประกอบเลยและไม่แชร์ class
// ร่วมกับ .rnf-* ของระบบเดิม (ดู styles/receipt.css) กันไม่ให้ปรับที่นี่กระทบของเดิม
// โดยไม่ตั้งใจ ใช้ .doc-page เป็น wrapper ร่วม (แค่กำหนดขนาด A4/ระยะขอบ) เหมือน
// เอกสารอื่นทุกใบในระบบ
const ITEMS_PER_PAGE = 10;

function formatThaiDate(dateInput) {
  if (!dateInput) return '-';
  const d = new Date(dateInput);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear() + 543;
  return `${dd}/${mm}/${yyyy}`;
}

function chunkItems(items, size) {
  if (items.length === 0) return [[]];
  const pages = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

export default function RepairWorksheetPrintTemplate({ data }) {
  if (!data) return null;

  const {
    job_no, queue_no, date, symptom,
    vehicle = {},
  } = data;
  const items = data.items || [];

  const pages = chunkItems(items, ITEMS_PER_PAGE);

  return (
    <div className="doc-print-wrap" id="repair-worksheet-print-area">
      {pages.map((pageItems, pageIndex) => {
        const startNo = pageIndex * ITEMS_PER_PAGE;
        return (
          <div className="doc-page rw-page" key={pageIndex}>
            <div className="rw-header">
              <div className="rw-spk-wrap">
                <div className="rw-spk-label">SPK</div>
                <div className="rw-spk" />
              </div>

              <div className="rw-title">
                <div className="rw-brand">
                  <span className="rw-champ">Champ</span><span className="rw-power">power</span><span className="rw-spktext">SPK</span>
                </div>
                <div className="rw-doctitle">ใบแจ้งซ่อม / รายการซ่อม</div>
                <div className="rw-plate">
                  {[vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(' ')}
                  {' '}· ทะเบียน <strong>{vehicle.license_plate || '____________'}</strong>
                </div>
              </div>

              <div className="rw-queue">
                <div className="rw-queue-label">เลขที่คิว</div>
                <div className="rw-queue-value">{queue_no || '—'}</div>
              </div>
            </div>

            {symptom && <div className="rw-symptom"><b>อาการที่แจ้ง :</b> {symptom}</div>}

            <table className="rw-table">
              <tbody>
                {pageItems.map((it, idx) => (
                  <tr key={startNo + idx}>
                    <td className="rw-num"><span>{startNo + idx + 1}</span></td>
                    <td className="rw-part">
                      {it.product_name}
                      {it.quantity > 1 && <span className="rw-qty"> x{it.quantity}</span>}
                    </td>
                    <td className="rw-ans"><span className="rw-box rw-box-on">✓</span></td>
                  </tr>
                ))}
                {Array.from({ length: ITEMS_PER_PAGE - pageItems.length }).map((_, idx) => (
                  <tr key={`blank-${idx}`} className="rw-row-blank">
                    <td className="rw-num">&nbsp;</td>
                    <td className="rw-part">&nbsp;</td>
                    <td className="rw-ans"><span className="rw-box" /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="rw-footer">
              <div>ตรวจเช็คโดย <span className="rw-fill" /></div>
              <div>ซ่อมโดย <span className="rw-fill" /></div>
              <div>วันที่ <span className="rw-fill">{formatThaiDate(date)}</span></div>
            </div>
            <div className="rw-code">{job_no || ''}</div>
          </div>
        );
      })}
    </div>
  );
}
