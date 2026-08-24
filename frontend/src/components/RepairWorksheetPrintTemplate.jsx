import React from 'react';
import champpowerLogo from '../image/champpower-logo.jpg';
import { COMPANY } from '../utils/printDoc';

// ใบแจ้งซ่อมแบบใหม่ — ต่างจาก RepairNoticePrintTemplate เดิม (checklist 9 หมวด
// ให้ติ๊กเลือกเอง) ตรงที่ "รายการที่ต้องทำ" ดึงมาจากรายการในใบเสนอราคาที่เลือกไว้
// แล้วตรงๆ ไม่ต้องมาติ๊กเลือกซ้ำอีกรอบ — ไม่มีราคา/ยอดเงินเลย (ช่างไม่ต้องรู้ราคา
// แค่รู้ว่าต้องทำอะไรบ้าง) mirror โครง/pagination เดียวกับ QuotationPrintTemplate.jsx
// (ระบบเอกสารเดียวกัน หน้าตาเดียวกัน) แต่ตัดคอลัมน์ราคา/ยอดรวม/มัดจำ/ประกันออก
const ITEMS_PER_PAGE = 16;

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
    customer_name, phone,
    vehicle = {},
    items = [],
  } = data;

  const pages = chunkItems(items, ITEMS_PER_PAGE);

  return (
    <div className="doc-print-wrap" id="repair-worksheet-print-area">
      {pages.map((pageItems, pageIndex) => {
        const startNo = pageIndex * ITEMS_PER_PAGE;
        return (
          <div className="doc-page" key={pageIndex}>
            <header className="doc-header">
              <div className="doc-header-top">
                <div className="doc-brand">
                  <img className="doc-logo-big" src={champpowerLogo} alt="Champ Power" />
                  <div className="doc-brand-info">
                    <div className="doc-brand-name">{COMPANY.legalName}</div>
                    <div className="doc-brand-addr">โทร : {COMPANY.phone}</div>
                  </div>
                </div>

                <div className="doc-title-block">
                  <h1>ใบแจ้งซ่อม</h1>
                  <div className="doc-infobox">
                    <div className="doc-meta-row doc-meta-primary"><span>เลขที่งาน :</span><strong>{job_no || '-'}</strong></div>
                    <div className="doc-meta-row"><span>วันที่ :</span><strong>{formatThaiDate(date)}</strong></div>
                    <div className="doc-meta-row"><span>เลขคิว :</span><strong>{queue_no || '-'}</strong></div>
                  </div>
                </div>
              </div>
            </header>

            <div className="doc-partyinfo">
              <div className="doc-info-grid doc-info-grid-4">
                <div><span className="doc-info-label">ชื่อ :</span> <span className="doc-info-value">{customer_name || '-'}</span></div>
                <div><span className="doc-info-label">ยี่ห้อรถ :</span> <span className="doc-info-value">{vehicle.brand || '-'}</span></div>
                <div><span className="doc-info-label">ทะเบียน :</span> <span className="doc-info-value">{vehicle.license_plate || '-'}</span></div>
                <div><span className="doc-info-label">เลขไมล์ :</span> <span className="doc-info-value">{vehicle.mileage != null && vehicle.mileage !== '' ? `${Number(vehicle.mileage).toLocaleString()} กม.` : '-'}</span></div>
                <div><span className="doc-info-label">เบอร์โทร :</span> <span className="doc-info-value">{phone || '-'}</span></div>
                <div><span className="doc-info-label">รุ่นรถ :</span> <span className="doc-info-value">{vehicle.model || '-'}</span></div>
                <div><span className="doc-info-label">สีรถ :</span> <span className="doc-info-value">{vehicle.color || '-'}</span></div>
              </div>
            </div>

            <div className="doc-remark-row"><b>อาการที่แจ้ง :</b> {symptom || ''}</div>

            <table className="doc-items">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>ลำดับ</th>
                  <th>รายการที่ต้องทำ</th>
                  <th className="doc-center" style={{ width: 70 }}>จำนวน</th>
                  <th className="doc-center" style={{ width: 90 }}>ทำแล้ว</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((it, idx) => (
                  <tr key={startNo + idx}>
                    <td className="doc-center">{startNo + idx + 1}</td>
                    <td>{it.product_name || '-'}</td>
                    <td className="doc-center">{it.quantity}</td>
                    <td className="doc-center">☐</td>
                  </tr>
                ))}
                {Array.from({ length: ITEMS_PER_PAGE - pageItems.length }).map((_, idx) => (
                  <tr key={`blank-${idx}`} className="doc-items-blank-row">
                    <td className="doc-center">&nbsp;</td>
                    <td>&nbsp;</td>
                    <td className="doc-center">&nbsp;</td>
                    <td className="doc-center">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="doc-sigs">
              <div className="doc-sigs-label">ลงชื่อ</div>
              <div className="doc-sig-who doc-sig-col-1">ช่างผู้ตรวจเช็ค</div>
              <div className="doc-sig-line doc-sig-col-1" />
              <div className="doc-sig-date doc-sig-col-1">วันที่ .........................</div>

              <div className="doc-sig-who doc-sig-col-2">ช่างผู้ซ่อม</div>
              <div className="doc-sig-line doc-sig-col-2" />
              <div className="doc-sig-date doc-sig-col-2">วันที่ .........................</div>

              <div className="doc-sig-who doc-sig-col-3">ผู้ตรวจสอบความเรียบร้อย</div>
              <div className="doc-sig-line doc-sig-col-3" />
              <div className="doc-sig-date doc-sig-col-3">วันที่ .........................</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
