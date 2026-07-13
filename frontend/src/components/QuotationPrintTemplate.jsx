import React from 'react';
import champpowerLogo from '../image/champpower-logo.jpg';
import { COMPANY, amountToWords } from '../utils/printDoc';
import { formatMoney } from '../utils/format';

// Mirrors ReceiptPrintTemplate.jsx's layout/pagination approach, so a
// quotation and a receipt look like the same physical document family —
// only the title, numbering, and signature labels differ (a quotation has
// no payment-method checkboxes since nothing's been paid for yet).
// ITEMS_PER_PAGE is re-measured whenever the fixed (non-item-row) content on
// the page changes — see the comment at its assignment below.
const WARRANTY_SLOTS = [
  { label: 'แร็คพวงมาลัย', matchKeyword: 'แร็ค' },
  { label: 'ลูกหมากช่วงล่าง', matchKeyword: 'ลูกหมาก' },
];

function findWarrantySlotText(items, matchKeyword) {
  const match = items.find((it) => {
    const name = it.product_name || it.product_name_snapshot || '';
    return name.includes(matchKeyword) && it.warranty_name;
  });
  return match ? match.warranty_name : '';
}

// Measured against real A4 (297mm) with the symptom + warranty rows now
// included: 13 rows leaves only ~2mm, 14+ overflows outright. 12 rows
// measures ~287mm, leaving a ~10mm buffer — matches ReceiptPrintTemplate.jsx's
// own ITEMS_PER_PAGE now that both pages carry almost the same fixed content
// (this template is just missing the payment-method checkbox row).
const ITEMS_PER_PAGE = 12;

function formatThaiDate(dateInput) {
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

function SignatureBlock({ sellerName, customerName, docDateText, signatureDataUrl }) {
  return (
    <div className="doc-sigs">
      <div className="doc-sigs-label">รับรอง</div>

      <div className="doc-sig-who doc-sig-col-1">ผู้เสนอราคา (ผู้ขาย)</div>
      <div className="doc-sig-line doc-sig-col-1" />
      <div className="doc-sig-name doc-sig-col-1">{sellerName}</div>
      <div className="doc-sig-date doc-sig-col-1">วันที่ {docDateText}</div>

      <div className="doc-sig-who doc-sig-col-2">ผู้อนุมัติ (ลูกค้า)</div>
      {signatureDataUrl && <img className="doc-sig-image doc-sig-col-2" src={signatureDataUrl} alt="ลายเซ็นลูกค้า" />}
      <div className="doc-sig-line doc-sig-col-2" />
      <div className="doc-sig-name doc-sig-col-2">{customerName || '-'}</div>
      <div className="doc-sig-date doc-sig-col-2">วันที่ {docDateText}</div>

      <div className="doc-sig-who doc-sig-col-3">ผู้จัดทำเอกสาร</div>
      <div className="doc-sig-line doc-sig-col-3" />
    </div>
  );
}

export default function QuotationPrintTemplate({ data }) {
  if (!data) return null;

  const {
    quotation_no,
    quotation_date,
    queue_no,
    symptom,
    customer = {},
    vehicle = {},
    items = [],
    remark,
  } = data;

  const subtotal = Number(
    data.subtotal ??
      items.reduce((sum, it) => sum + Number(it.quantity ?? it.qty ?? 0) * Number(it.unit_price ?? it.price ?? 0), 0)
  );
  const discount = Number(data.discount || 0);
  const grandTotal = subtotal - discount;
  const amountWords = amountToWords(grandTotal);
  const docDateText = quotation_date ? formatThaiDate(quotation_date) : '.........................';

  const pages = chunkItems(items, ITEMS_PER_PAGE);

  return (
    <div className="doc-print-wrap" id="quotation-print-area">
      {pages.map((pageItems, pageIndex) => {
        const startNo = pageIndex * ITEMS_PER_PAGE;

        return (
          <div className="doc-page" key={pageIndex}>
            <div className="doc-original-tag">(ต้นฉบับ)</div>

            <header className="doc-header">
              <div className="doc-header-top">
                <div className="doc-brand">
                  <img className="doc-logo-big" src={champpowerLogo} alt="Champ Power" />
                  <div className="doc-brand-info">
                    <div className="doc-brand-name">{COMPANY.legalName}</div>
                    <div className="doc-brand-addr">ที่อยู่ : {COMPANY.address}</div>
                    <div className="doc-brand-addr">โทร : {COMPANY.phone}</div>
                    <div className="doc-brand-addr">LINE : {COMPANY.line}</div>
                  </div>
                </div>

                <div className="doc-title-block">
                  <h1>ใบเสนอราคา</h1>
                  <div className="doc-infobox">
                    <div className="doc-meta-row doc-meta-primary"><span>เลขที่เอกสาร :</span><strong>{quotation_no || '-'}</strong></div>
                    <div className="doc-meta-row"><span>วันที่ :</span><strong>{quotation_date ? formatThaiDate(quotation_date) : '-'}</strong></div>
                    <div className="doc-meta-row"><span>เลขคิว/เลขงาน :</span><strong>{queue_no || '-'}</strong></div>
                  </div>
                </div>
              </div>
            </header>

            <div className="doc-partyinfo">
              <div className="doc-info-grid doc-info-grid-4">
                <div><span className="doc-info-label">ชื่อ :</span> <span className="doc-info-value">{customer.customer_name || '-'}</span></div>
                <div><span className="doc-info-label">ยี่ห้อรถ :</span> <span className="doc-info-value">{vehicle.brand || vehicle.car_brand || '-'}</span></div>
                <div><span className="doc-info-label">ทะเบียน :</span> <span className="doc-info-value">{vehicle.license_plate || vehicle.car_license_plate || '-'}</span></div>
                <div><span className="doc-info-label">เลขไมล์ :</span> <span className="doc-info-value">{vehicle.mileage != null && vehicle.mileage !== '' ? `${Number(vehicle.mileage).toLocaleString()} กม.` : '-'}</span></div>
                <div><span className="doc-info-label">เบอร์โทร :</span> <span className="doc-info-value">{customer.phone || '-'}</span></div>
                <div><span className="doc-info-label">รุ่นรถ :</span> <span className="doc-info-value">{vehicle.model || vehicle.car_model || '-'}</span></div>
                <div><span className="doc-info-label">สีรถ :</span> <span className="doc-info-value">{vehicle.color || vehicle.car_color || '-'}</span></div>
              </div>
            </div>

            <div className="doc-remark-row"><b>อาการ :</b> {symptom || ''}</div>

            <table className="doc-items">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>ลำดับ</th>
                  <th>รายการ</th>
                  <th className="doc-center" style={{ width: 56 }}>จำนวน</th>
                  <th className="doc-num" style={{ width: 96 }}>ราคาต่อหน่วย</th>
                  <th className="doc-num" style={{ width: 106 }}>จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((it, idx) => {
                  const qty = Number(it.quantity ?? it.qty ?? 0);
                  const price = Number(it.unit_price ?? it.price ?? 0);
                  return (
                    <tr key={startNo + idx}>
                      <td className="doc-center">{startNo + idx + 1}</td>
                      <td>{it.product_name || it.product_name_snapshot || '-'}</td>
                      <td className="doc-center">{qty}</td>
                      <td className="doc-num">{formatMoney(price)}</td>
                      <td className="doc-num">{formatMoney(qty * price)}</td>
                    </tr>
                  );
                })}
                {Array.from({ length: ITEMS_PER_PAGE - pageItems.length }).map((_, idx) => (
                  <tr key={`blank-${idx}`} className="doc-items-blank-row">
                    <td className="doc-center">&nbsp;</td>
                    <td>&nbsp;</td>
                    <td className="doc-center">&nbsp;</td>
                    <td className="doc-num">&nbsp;</td>
                    <td className="doc-num">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="doc-total-box">
              <span className="doc-total-box-words">({amountWords})</span>
              <span className="doc-total-box-amount">
                <span>รวมเป็นเงินทั้งสิ้น</span>
                <strong>{formatMoney(grandTotal)} บาท</strong>
              </span>
            </div>

            <div className="doc-warranty-row">
              {WARRANTY_SLOTS.map((slot) => {
                const text = findWarrantySlotText(items, slot.matchKeyword);
                return (
                  <span key={slot.label}>
                    <b>{slot.label} :</b> <span className={text ? 'doc-warranty-value' : ''}>{text || '-'}</span>
                  </span>
                );
              })}
            </div>

            <div className="doc-remark-row"><b>หมายเหตุ :</b> {remark || ''}</div>

            <SignatureBlock sellerName={COMPANY.legalName} customerName={customer.customer_name} docDateText={docDateText} signatureDataUrl={data.customer_signature} />
          </div>
        );
      })}
    </div>
  );
}
