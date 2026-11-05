import React from 'react';
import DocBrand from './DocBrand';
import { useDocHeader } from '../hooks/useDocHeader';
import { docThemeStyle } from '../utils/docTheme';
import { formatMoney } from '../utils/format';
import { amountToWords } from '../utils/printDoc';
import { plateWithProvince } from '../utils/thaiProvinces';

// ใบเคลม: same family as the quotation (same header settings of the signed-in shop, same logo and colour), so it reuses
// the quotation's print area id for the colours in receipt.css.
const ITEMS_PER_PAGE = 8;

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

export default function ClaimPrintTemplate({ claim }) {
  const { header } = useDocHeader('quotation');
  if (!claim) return null;

  const items = claim.items || [];
  const total = items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unit_price), 0);
  // the job's own reading, or the car's latest when the case has no job
  const mileage = Number(claim.mileage_in) || Number(claim.mileage) || 0;
  const docDate = claim.claim_date ? formatThaiDate(claim.claim_date) : '-';
  const pages = chunkItems(items, ITEMS_PER_PAGE);

  return (
    <div className="doc-print-wrap" id="quotation-print-area">
      {pages.map((pageItems, pageIndex) => {
        const startNo = pageIndex * ITEMS_PER_PAGE;
        return (
          <div className="doc-page" key={pageIndex} style={docThemeStyle(header.accent_color)}>
            <header className="doc-header">
              <div className="doc-header-top">
                <DocBrand header={header} />
                <div className="doc-title-block">
                  <h1>ใบเคลม</h1>
                  <div className="doc-infobox">
                    <div className="doc-meta-row doc-meta-primary"><span>เลขที่ใบเคลม :</span><strong>{claim.claim_no}</strong></div>
                    <div className="doc-meta-row"><span>วันที่ :</span><strong>{docDate}</strong></div>
                    {claim.source_receipt_no && <div className="doc-meta-row"><span>อ้างอิงบิล :</span><strong>{claim.source_receipt_no}</strong></div>}
                  </div>
                </div>
              </div>
            </header>

            <div className="doc-partyinfo">
              <div className="doc-info-grid">
                <div><span className="doc-info-label">ชื่อ :</span> <span className="doc-info-value">{claim.customer_name || '-'}</span></div>
                <div><span className="doc-info-label">เบอร์โทร :</span> <span className="doc-info-value">{claim.phone || '-'}</span></div>
                <div><span className="doc-info-label">เลขไมล์ :</span> <span className="doc-info-value">{mileage ? `${mileage.toLocaleString()} กม.` : '-'}</span></div>
                {/* a model name is long and says the body type, so it gets the room not to be cut off */}
                <div className="claim-doc-car"><span className="doc-info-label">รถ :</span> <span className="doc-info-value">{[claim.brand, claim.model, claim.color].filter(Boolean).join(' ') || '-'}</span></div>
                <div><span className="doc-info-label">ทะเบียน :</span> <span className="doc-info-value">{plateWithProvince(claim.license_plate, claim.province) || '-'}</span></div>
              </div>
            </div>

            <div className="claim-doc-block">
              <div className="claim-doc-label">รายละเอียดของปัญหา</div>
              <div className="claim-doc-text">{claim.symptom || '-'}</div>
            </div>
            <div className="claim-doc-block">
              <div className="claim-doc-label">วิธีการแก้ไข</div>
              <div className="claim-doc-text">{claim.resolution || '-'}</div>
            </div>

            <table className="doc-items">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>ลำดับ</th>
                  <th>อะไหล่ที่เปลี่ยน</th>
                  <th className="doc-center" style={{ width: 56 }}>จำนวน</th>
                  <th className="doc-num" style={{ width: 96 }}>ราคาต่อหน่วย</th>
                  <th className="doc-num" style={{ width: 106 }}>ค่าใช้จ่าย</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((it, idx) => {
                  const price = Number(it.unit_price);
                  return (
                    <tr key={it.id ?? idx}>
                      <td className="doc-center">{startNo + idx + 1}</td>
                      <td>{it.product_name}</td>
                      <td className="doc-center">{it.quantity}</td>
                      <td className="doc-num">{price ? formatMoney(price) : '-'}</td>
                      <td className="doc-num">{price ? formatMoney(Number(it.quantity) * price) : 'เคลม ไม่คิดเงิน'}</td>
                    </tr>
                  );
                })}
                {Array.from({ length: Math.max(0, 4 - pageItems.length) }).map((_, idx) => (
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
              <span className="doc-total-box-words">{total > 0 ? `(${amountToWords(total)})` : 'ไม่มีค่าใช้จ่าย'}</span>
              <span className="doc-total-box-amount">
                <span>ค่าใช้จ่ายอะไหล่ (ไม่เกี่ยวกับรายการที่ซ่อม)</span>
                <strong>{formatMoney(total)} บาท</strong>
              </span>
            </div>

            {claim.remark && <div className="doc-remark-row"><b>หมายเหตุ :</b> {claim.remark}</div>}

            <div className="doc-sigs">
              <div className="doc-sigs-label">รับรอง</div>

              <div className="doc-sig-who doc-sig-col-1">ช่างซ่อมผู้รับผิดชอบ</div>
              <div className="doc-sig-line doc-sig-col-1" />
              <div className="doc-sig-name doc-sig-col-1">{claim.technician || ''}</div>
              <div className="doc-sig-date doc-sig-col-1">วันที่ {docDate}</div>

              <div className="doc-sig-who doc-sig-col-2">พนักงานรับเรื่อง</div>
              <div className="doc-sig-line doc-sig-col-2" />
              <div className="doc-sig-name doc-sig-col-2">{claim.created_by_name || ''}</div>
              <div className="doc-sig-date doc-sig-col-2">วันที่ {docDate}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
