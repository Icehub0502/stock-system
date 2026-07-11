import React from 'react';
import champpowerLogo from '../image/champpower-logo.jpg';
import { COMPANY, amountToWords } from '../utils/printDoc';
import { formatMoney } from '../utils/format';

// Fixed warranty-tag slots printed on every receipt (matches the physical form).
// Matched against the item name itself — `category` isn't persisted on saved
// receipt_items, so matching on it always misses once a receipt is reloaded.
const WARRANTY_SLOTS = [
  { label: 'แร็คพวงมาลัย', matchKeyword: 'แร็ค' },
  { label: 'ลูกหมากช่วงล่าง', matchKeyword: 'ลูกหมาก' },
];

// Printed as blank checkboxes for staff to tick by hand — not tied to any
// stored payment data.
const PAYMENT_METHODS = ['โอน', 'บัตรเครดิต', 'เงินสด', 'อื่นๆ'];

// Zero-padded DD/MM/YYYY in Buddhist Era (e.g. 03/07/2569) — built manually
// rather than via toLocaleDateString so it renders identically regardless
// of the browser/OS's ICU data.
function formatThaiDate(dateInput) {
  const d = new Date(dateInput);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear() + 543;
  return `${dd}/${mm}/${yyyy}`;
}

function findWarrantySlotText(items, matchKeyword) {
  const match = items.find((it) => {
    const name = it.product_name_snapshot || it.product_name || it.service_item_name || '';
    return name.includes(matchKeyword) && it.warranty_name;
  });
  if (!match) return '';
  // warranty_name already carries the year/km inline (e.g. "แร็ค 1 ปี 100000 Km") —
  // appending warranty_year/warranty_km again just repeats the same numbers.
  return match.warranty_name;
}

// Fixed number of rows per printed page. Pagination is done explicitly here
// (chunking the array, one <div class="doc-page"> per chunk with its own
// page-break) instead of relying on the browser's automatic page-break —
// letting the browser decide caused inconsistent output size/breaks across
// different computers and printers. The total/warranty/remark/signature
// block now renders on every page (not just the last), so every page needs
// the same reserved room for it — capacity is uniform across all pages.
// Measured against real A4 (297mm): 13 rows lands ~3mm from the edge and 14+
// overflows outright, so both are too tight — physical printers commonly
// enforce their own small hardware margin that CSS `@page { margin: 0 }`
// cannot override, meaning content sized to the full nominal 297mm can still
// clip on a real printer. 12 rows measured ~286mm, leaving an ~11mm buffer.
const ITEMS_PER_PAGE = 12;

function chunkItems(items, size) {
  if (items.length === 0) return [[]];
  const pages = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

function SignatureBlock({ sellerName, customerName, docDateText }) {
  return (
    <div className="doc-sigs">
      <div className="doc-sigs-label">รับรอง</div>

      <div className="doc-sig-who doc-sig-col-1">ผู้ออกเอกสาร (ผู้ขาย)</div>
      <div className="doc-sig-line doc-sig-col-1" />
      <div className="doc-sig-name doc-sig-col-1">{sellerName}</div>
      <div className="doc-sig-date doc-sig-col-1">วันที่ {docDateText}</div>

      <div className="doc-sig-who doc-sig-col-2">ผู้อนุมัติเอกสาร (ลูกค้า)</div>
      <div className="doc-sig-line doc-sig-col-2" />
      <div className="doc-sig-name doc-sig-col-2">{customerName || '-'}</div>
      <div className="doc-sig-date doc-sig-col-2">วันที่ {docDateText}</div>

      <div className="doc-sig-who doc-sig-col-3">ผู้รับเงิน</div>
      <div className="doc-sig-line doc-sig-col-3" />
    </div>
  );
}

export default function ReceiptPrintTemplate({ data }) {
  if (!data) return null;

  const {
    receipt_no,
    receipt_date,
    customer = {},
    vehicle = {},
    items = [],
    remark,
  } = data;

  const subtotal = Number(data.total_amount ?? items.reduce((sum, it) => sum + Number(it.amount || 0), 0));
  const discount = Number(data.discount || 0);
  const grandTotal = subtotal - discount;
  const paidAmount = Number(data.paid_amount ?? grandTotal);
  const amountWords = amountToWords(grandTotal);
  const docDateText = receipt_date ? formatThaiDate(receipt_date) : '.........................';

  const pages = chunkItems(items, ITEMS_PER_PAGE);

  return (
    <div className="doc-print-wrap" id="receipt-print-area">
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
                  <h1>ใบเสร็จรับเงิน/ใบรับประกันสินค้า</h1>
                  <div className="doc-infobox">
                    <div className="doc-meta-row doc-meta-primary"><span>เลขที่เอกสาร :</span><strong>{receipt_no || '-'}</strong></div>
                    <div className="doc-meta-row"><span>วันที่ :</span><strong>{receipt_date ? formatThaiDate(receipt_date) : '-'}</strong></div>
                    <div className="doc-meta-row"><span>รหัสลูกค้า :</span><strong>{customer.customer_code || '-'}</strong></div>
                    <div className="doc-meta-row"><span>PIC :</span><strong>สมุทรปราการ</strong></div>
                  </div>
                </div>
              </div>
            </header>

            <div className="doc-partyinfo">
              <div className="doc-info-grid doc-info-grid-4">
                <div><span className="doc-info-label">ชื่อ :</span> <span className="doc-info-value">{customer.customer_name || '-'}</span></div>
                <div><span className="doc-info-label">ยี่ห้อรถ :</span> <span className="doc-info-value">{vehicle.brand || '-'}</span></div>
                <div><span className="doc-info-label">ทะเบียน :</span> <span className="doc-info-value">{vehicle.license_plate || '-'}</span></div>
                <div><span className="doc-info-label">เลขไมล์ :</span> <span className="doc-info-value">{vehicle.mileage != null && vehicle.mileage !== '' ? `${Number(vehicle.mileage).toLocaleString()} กม.` : '-'}</span></div>
                <div><span className="doc-info-label">เบอร์โทร :</span> <span className="doc-info-value">{customer.phone || '-'}</span></div>
                <div><span className="doc-info-label">รุ่นรถ :</span> <span className="doc-info-value">{vehicle.model || '-'}</span></div>
                <div><span className="doc-info-label">สีรถ :</span> <span className="doc-info-value">{vehicle.color || '-'}</span></div>
              </div>
            </div>

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
                {pageItems.map((it, idx) => (
                  <tr key={startNo + idx}>
                    <td className="doc-center">{startNo + idx + 1}</td>
                    <td>{it.product_name_snapshot || it.product_name || it.service_item_name || '-'}</td>
                    <td className="doc-center">{it.qty}</td>
                    <td className="doc-num">{formatMoney(it.price)}</td>
                    <td className="doc-num">{formatMoney(it.amount)}</td>
                  </tr>
                ))}
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
                <strong>{formatMoney(paidAmount)} บาท</strong>
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

            <div className="doc-payment-methods">
              <span className="doc-payment-label">ชำระโดย :</span>
              {PAYMENT_METHODS.map((method) => (
                <span className="doc-payment-option" key={method}>
                  <span className="doc-checkbox" /> {method}
                </span>
              ))}
            </div>

            <SignatureBlock sellerName={COMPANY.legalName} customerName={customer.customer_name} docDateText={docDateText} />
          </div>
        );
      })}
    </div>
  );
}
