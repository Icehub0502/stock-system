import React, { useMemo, useState } from 'react';
import client from '../api/client';
import { todayStr } from '../utils/format';

// สร้างบิลแยกต่างหากสำหรับงาน/คิวเดียวกัน — เจ้าของร้านขอให้แยกบิลได้เรื่อยๆ ใน
// คิวเดียว (เช่นรายการ 1-3 ทำวันนี้เป็นบิลหลักของงาน ส่วนรายการ 4-6 แยกเป็นอีกบิล
// ที่ลูกค้าวางมัดจำ+นัดวันมาทำ หรือแค่ขอใบเสนอราคาไว้เฉยๆ) บิลที่สร้างจากที่นี่
// เป็นใบเสนอราคาอิสระ (POST /quotations ตรงๆ) ไม่ผูกกับ job.quotation_id/สถานะคิว
// เลย — ดู GET /jobs/:id/quotations ฝั่ง backend ที่รวบรวมบิลเหล่านี้มาแสดงที่หน้า
// รายละเอียดงาน (จับคู่ด้วยลูกค้า+รถ+วันเดียวกัน ไม่ต้องมีคอลัมน์ผูกใหม่)
//
// ใช้ตัวเลือกอะไหล่แบบเดียวกับแผงหลักใน JobDetailPage.jsx (ติ๊ก+จำนวน+ราคา, ชุดโปร
// กระเด้งขยายเป็นรายการย่อย) แต่เป็น state แยกต่างหากของตัวเอง ไม่แตะ selectedParts
// ของบิลหลักเลย — catalogParts รับมาจาก parent (โหลดไว้แล้ว ไม่ต้องยิงซ้ำ)
export default function ExtraBillModal({ job, catalogParts, onClose, onCreated }) {
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedParts, setSelectedParts] = useState({});
  const [mode, setMode] = useState('deposit'); // 'deposit' | 'quote_only'
  const [depositAmount, setDepositAmount] = useState('');
  const [depositDate, setDepositDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const catalogCategories = useMemo(() => {
    const seen = new Set();
    const list = [];
    catalogParts.forEach((p) => {
      if (p.category && !seen.has(p.category)) {
        seen.add(p.category);
        list.push(p.category);
      }
    });
    return list;
  }, [catalogParts]);

  const filteredCatalogParts = categoryFilter
    ? catalogParts.filter((p) => p.category === categoryFilter)
    : catalogParts;

  const selectedPartsList = Object.values(selectedParts);
  const selectedPartsTotal = selectedPartsList.reduce((sum, p) => sum + p.quantity * (Number(p.unitPrice) || 0), 0);

  async function togglePart(part) {
    if (part.kind === 'set') {
      const alreadyIn = Object.values(selectedParts).some((it) => it.setId === part.id);
      if (alreadyIn) {
        setSelectedParts((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((k) => { if (next[k].setId === part.id) delete next[k]; });
          return next;
        });
        return;
      }
      try {
        const res = await client.get(`/service-items/${part.id}/components`);
        const components = res.data.data || [];
        const rows = components.length > 0 ? components : [{ component_name: part.part_name, default_qty: 1 }];
        setSelectedParts((prev) => {
          const next = { ...prev };
          rows.forEach((comp, idx) => {
            next[`set-${part.id}-comp-${idx}`] = {
              setId: part.id,
              part_name: comp.component_name,
              quantity: Number(comp.default_qty) > 0 ? Number(comp.default_qty) : 1,
              unitPrice: '',
            };
          });
          return next;
        });
      } catch (err) {
        setError(err.response?.data?.error || 'โหลดรายการย่อยของชุดไม่สำเร็จ');
      }
      return;
    }

    setSelectedParts((prev) => {
      const key = part.id;
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { ...part, quantity: 1, unitPrice: '' } };
    });
  }

  function changePartQty(key, delta) {
    setSelectedParts((prev) => {
      const current = prev[key];
      if (!current) return prev;
      const nextQty = current.quantity + delta;
      if (nextQty <= 0) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { ...current, quantity: nextQty } };
    });
  }

  function updatePartPrice(key, value) {
    setSelectedParts((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], unitPrice: value } } : prev));
  }

  function removeSelected(key) {
    setSelectedParts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit() {
    if (selectedPartsList.length === 0) {
      setError('กรุณาเลือกรายการอย่างน้อย 1 รายการ');
      return;
    }
    if (mode === 'deposit' && !(Number(depositAmount) > 0)) {
      setError('กรุณากรอกยอดมัดจำให้ถูกต้อง');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await client.post('/quotations', {
        customer_id: job.customer_id,
        vehicle_id: job.vehicle_id,
        quotation_date: job.job_date,
        items: selectedPartsList.map((p) => ({
          product_name: p.part_name,
          quantity: p.quantity,
          unit_price: Number(p.unitPrice) || 0,
        })),
        ...(mode === 'deposit' ? { deposit_amount: Number(depositAmount), deposit_date: depositDate } : {}),
      });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'สร้างบิลไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card large" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <h3>+ เพิ่มบิลใหม่</h3>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: -8 }}>
          แยกรายการเป็นบิลใหม่ของงานนี้ — ไม่กระทบบิลหลัก/สถานะคิว
        </p>

        {error && <p className="error-text">{error}</p>}

        {selectedPartsList.length > 0 && (
          <div className="jdp-selected-list">
            <div className="jdp-selected-list-title">รายการที่เลือก ({selectedPartsList.length})</div>
            {Object.entries(selectedParts).map(([key, item]) => (
              <div className="jdp-selected-row" key={key}>
                <span className="jdp-selected-name">{item.part_name}</span>
                <div className="jdp-selected-controls">
                  <div className="jdp-selected-qty">
                    <button type="button" onClick={() => changePartQty(key, -1)} aria-label="ลดจำนวน">−</button>
                    <span>{item.quantity}</span>
                    <button type="button" onClick={() => changePartQty(key, 1)} aria-label="เพิ่มจำนวน">+</button>
                  </div>
                  <label className="jdp-selected-price">
                    <span>฿</span>
                    <input
                      type="number" min="0" step="0.01" placeholder="ราคา/หน่วย"
                      value={item.unitPrice} onChange={(e) => updatePartPrice(key, e.target.value)}
                    />
                  </label>
                  <button type="button" className="jdp-selected-remove" onClick={() => removeSelected(key)} aria-label="ลบรายการ">✕</button>
                </div>
              </div>
            ))}
            <div className="jdp-selected-total">รวม {selectedPartsTotal.toLocaleString('th-TH')} บาท</div>
          </div>
        )}

        {catalogCategories.length > 0 && (
          <div className="jdp-category-bar">
            <button type="button" className={`jdp-category-chip ${!categoryFilter ? 'active' : ''}`} onClick={() => setCategoryFilter('')}>
              ทั้งหมด
            </button>
            {catalogCategories.map((cat) => (
              <button
                type="button" key={cat}
                className={`jdp-category-chip ${categoryFilter === cat ? 'active' : ''}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        <div className="jdp-item-grid" style={{ maxHeight: 240, overflowY: 'auto' }}>
          {filteredCatalogParts.map((part) => {
            const selected = part.kind === 'set'
              ? Object.values(selectedParts).some((it) => it.setId === part.id)
              : selectedParts[part.id];
            return (
              <button
                type="button" key={part.id}
                className={`jdp-item-btn ${selected ? 'active' : ''} ${part.kind === 'set' ? 'jdp-item-set' : ''}`}
                onClick={() => togglePart(part)}
              >
                {selected && <span className="jdp-item-check">✓</span>}
                {part.part_name}
                {part.kind === 'set' && <span className="jdp-item-set-badge">ชุดโปร</span>}
              </button>
            );
          })}
        </div>

        <div className="modal-form" style={{ marginTop: 12 }}>
          <label>บิลนี้เป็นแบบไหน</label>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="radio" checked={mode === 'deposit'} onChange={() => setMode('deposit')} />
              มัดจำ + นัดวันมาทำ
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="radio" checked={mode === 'quote_only'} onChange={() => setMode('quote_only')} />
              แค่ขอใบเสนอราคาไว้ก่อน
            </label>
          </div>

          {mode === 'deposit' && (
            <>
              <label>ยอดมัดจำ</label>
              <input type="number" min="0" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
              <label>วันที่วางมัดจำ</label>
              <input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
            </>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={handleSubmit}>
            {busy ? 'กำลังบันทึก...' : 'สร้างบิล'}
          </button>
          <button type="button" onClick={onClose} disabled={busy}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}
