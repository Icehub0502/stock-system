import React from 'react';
import FormModalShell from './FormModalShell';

export default function ItemDetailModal({ item, onClose }) {
  if (!item) return null;

  return (
    <FormModalShell
      title="รายละเอียดสินค้า/บริการ"
      subtitle="ดูข้อมูลสินค้าเพิ่มเติมโดยไม่รบกวนการกรอกฟอร์ม"
      onClose={onClose}
      error={null}
      toast={null}
      onToastDone={() => {}}
    >
      {() => (
        <div className="item-detail-modal-content">
          <div className="info-card">
            <div className="info-card-title">ข้อมูลหลัก</div>
            <div className="info-card-content">
              <div><strong>ชื่อสินค้า/บริการ:</strong> {item.product_name_snapshot || item.product_name || '-'}</div>
              <div><strong>รหัสสินค้า:</strong> {item.service_item_id ? `SI-${item.service_item_id}` : item.product_id ? `PR-${item.product_id}` : '-'}</div>
              <div><strong>หมวดหมู่:</strong> {item.category || '-'}</div>
              <div><strong>ราคาต่อหน่วย:</strong> ฿{item.price ? Number(item.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}</div>
              <div><strong>จำนวน:</strong> {item.qty ?? item.quantity ?? 1}</div>
            </div>
          </div>

          <div className="info-card">
            <div className="info-card-title">ข้อมูลรับประกัน</div>
            <div className="info-card-content">
              <div><strong>ชื่อการรับประกัน:</strong> {item.warranty_name || '-'}</div>
              <div><strong>ระยะเวลา:</strong> {item.warranty_year ? `${item.warranty_year} ปี` : '-'} {item.warranty_km ? `• ${item.warranty_km.toLocaleString()} กม` : ''}</div>
            </div>
          </div>

          <div className="info-card">
            <div className="info-card-title">รายละเอียดเพิ่มเติม</div>
            <div className="info-card-content">
              <div>{item.description || item.product_name || 'ไม่มีข้อความเพิ่มเติม'}</div>
            </div>
          </div>
        </div>
      )}
    </FormModalShell>
  );
}
