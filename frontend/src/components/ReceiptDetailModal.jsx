import React, { useEffect, useState } from "react";
import client from "../api/client";
import champpowerLogo from "../image/champpower-logo.jpg";
import { highlightDeposit } from "../utils/highlightDeposit";

const formatMoney = (value) => {
  if (Number.isNaN(Number(value))) return '0.00';
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function ReceiptDetailModal({ receiptId, onClose }) {
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (receiptId) {
      loadReceipt(receiptId);
    }
  }, [receiptId]);

  const loadReceipt = async (id) => {
    setLoading(true);
    try {
      const response = await client.get(`/receipts/${id}`);
      setReceipt(response.data.data);
    } catch (err) {
      console.error('Error loading receipt detail:', err);
      alert('โหลดรายละเอียดบิลไม่สำเร็จ');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  if (!receipt) return null;

  const warrantyItems = receipt.items?.filter((item) => item.warranty_name) || [];
  const depositAmountNum = Number(receipt.deposit_amount || 0);
  const hasDeposit = depositAmountNum > 0;
  // dd/mm/yy Buddhist Era, matching the print templates' short deposit-date format.
  const depositDateText = receipt.deposit_date
    ? (() => {
        const d = new Date(receipt.deposit_date);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String((d.getFullYear() + 543) % 100).padStart(2, '0');
        return `${dd}/${mm}/${yy}`;
      })()
    : '';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card large receipt-detail-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>ใบเสร็จรับเงิน / ใบรับประกัน</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="receipt-detail-body">
          <div className="receipt-detail-printable" id="receipt-detail-print-area">
            <div className="receipt-detail-header">
              <div className="company-brand">
                <img className="company-logo" src="../image/champpower-logo.jpg" alt="Champ Power" />
                <div className="company-details">
                  <strong>บริษัท ช่างพาวเวอร์ จำกัด</strong>
                  <span>บริการซ่อมบำรุงและรับประกันคุณภาพรถยนต์</span>
                  <span>123/4 ถนนตัวอย่าง ตำบลตัวอย่าง อำเภอตัวอย่าง กรุงเทพฯ</span>
                  <span>โทร: 02-123-4567</span>
                </div>
              </div>
              <div className="receipt-metadata receipt-metadata-panel">
                <div className="meta-item">
                  <span>เลขที่บิล</span>
                  <strong>{receipt.receipt_no}</strong>
                </div>
                <div className="meta-item">
                  <span>วันที่</span>
                  <strong>{new Date(receipt.receipt_date).toLocaleDateString('th-TH')}</strong>
                </div>
                <div className="meta-item meta-highlights">
                  <span>รวมทั้งสิ้น</span>
                  <strong>฿{formatMoney(receipt.total_amount)}</strong>
                </div>
              </div>
            </div>

            <div className="receipt-detail-grid">
              <section className="receipt-detail-section">
                <h3>ข้อมูลลูกค้า</h3>
                <div className="detail-row">
                  <span className="label">ชื่อลูกค้า</span>
                  <span className="value">{receipt.customer_name || '-'}</span>
                </div>
                <div className="detail-row">
                  <span className="label">โทรศัพท์</span>
                  <span className="value">{receipt.phone || '-'}</span>
                </div>
              </section>

              <section className="receipt-detail-section">
                <h3>ข้อมูลรถ</h3>
                <div className="detail-row">
                  <span className="label">ยี่ห้อ / รุ่น / สี</span>
                  <span className="value">{receipt.brand || '-'} {receipt.model || ''} {receipt.color || ''}</span>
                </div>
                <div className="detail-row">
                  <span className="label">ทะเบียน</span>
                  <span className="value">{receipt.license_plate || '-'}</span>
                </div>
                <div className="detail-row">
                  <span className="label">เลขไมล์</span>
                  <span className="value">{receipt.mileage || receipt.vehicle_mileage || 0} กม.</span>
                </div>
              </section>
            </div>

            <section className="receipt-detail-section receipt-detail-items">
              <h3>รายการสินค้า/บริการ</h3>
              <div className="receipt-detail-items-table">
                <table>
                  <thead>
                    <tr>
                      <th>ลำดับ</th>
                      <th>รายการ</th>
                      <th>จำนวน</th>
                      <th>ราคา/หน่วย</th>
                      <th>จำนวนเงิน</th>
                      <th>การรับประกัน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipt.items.map((item, idx) => (
                      <tr key={idx}>
                        <td>{idx + 1}</td>
                        <td>{item.product_name_snapshot || item.service_item_name || '-'}</td>
                        <td>{item.qty}</td>
                        <td>฿{formatMoney(item.price)}</td>
                        <td>฿{formatMoney(item.amount)}</td>
                        <td>{item.warranty_name ? `${item.warranty_name} (${item.warranty_year} ปี, ${item.warranty_km.toLocaleString()} กม)` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {warrantyItems.length > 0 && (
              <section className="receipt-detail-section receipt-detail-warranty">
                <h3>สรุปการรับประกัน</h3>
                {warrantyItems.map((item, idx) => (
                  <div key={idx} className="warranty-item">
                    <div className="warranty-title">{item.product_name_snapshot || item.service_item_name}</div>
                    <div className="warranty-detail">{item.warranty_name} • {item.warranty_year} ปี • {item.warranty_km.toLocaleString()} กม</div>
                  </div>
                ))}
              </section>
            )}

            <section className="receipt-detail-section receipt-detail-summary">
              {receipt.remark && (
                <div className="detail-row remark-row">
                  <span className="label">หมายเหตุ</span>
                  <span className="value">{highlightDeposit(receipt.remark)}</span>
                </div>
              )}
              <div className="summary-grid">
                <div className="summary-label">รวมทั้งสิ้น</div>
                <div className="summary-value">฿{formatMoney(receipt.total_amount)}</div>
              </div>
              <div className="summary-grid">
                <div className="summary-label">ส่วนลด</div>
                <div className="summary-value">฿{formatMoney(receipt.discount || 0)}</div>
              </div>
              {hasDeposit && (
                <div className="summary-grid">
                  <div className="summary-label">มัดจำ</div>
                  <div className="summary-value">฿{formatMoney(depositAmountNum)}{depositDateText ? ` (${depositDateText})` : ''}</div>
                </div>
              )}
              <div className="signature-block">
                <div className="signature-box">
                  <div className="signature-line" />
                  <div>ผู้รับเงิน / ผู้รับบริการ</div>
                </div>
                <div className="signature-box">
                  <div className="signature-line" />
                  <div>ผู้ให้บริการ</div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="modal-footer no-print">
          <button className="btn btn-secondary" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
