import React, { useEffect, useMemo, useRef, useState } from 'react';
import client from '../api/client';

// ฟอร์มเคลม — บันทึกอิสระ ไม่ผูกกับใบเสร็จ/ใบเสนอราคาเดิม (เจ้าของร้านยืนยันแล้ว)
// แค่เลือกลูกค้า+รถที่มีอยู่แล้วในระบบ (รถที่เคยซ่อมมาก่อน ไม่ใช่รถใหม่ จึงไม่มี
// โหมด "เพิ่มลูกค้า/รถใหม่" แบบ AddJobModal.jsx) แล้วบันทึกอาการที่เคลม + รายการ
// อะไหล่ที่เปลี่ยน — 2 ขั้นตอนในโมดัลเดียว มิเรอร์ step state ของ RepairNoticePage.jsx
// (ค้นหารถ → กรอกรายละเอียด) แต่เป็น modal ไม่ใช่หน้าเต็ม
//
// claim: null = สร้างใหม่, object = แก้ไขเคลมเดิม (มาจาก GET /claims/:id)
export default function ClaimFormModal({ claim, onClose, onSaved }) {
  const isEdit = Boolean(claim?.id);
  const [step, setStep] = useState(isEdit ? 'details' : 'vehicle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [vehicleQuery, setVehicleQuery] = useState('');
  const [vehicleResults, setVehicleResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef(null);

  const [selectedVehicle, setSelectedVehicle] = useState(
    isEdit
      ? {
          vehicle_id: claim.vehicle_id,
          customer_id: claim.customer_id,
          brand: claim.brand,
          model: claim.model,
          color: claim.color,
          license_plate: claim.license_plate,
          customer_name: claim.customer_name,
          phone: claim.phone,
        }
      : null
  );

  const [claimDate, setClaimDate] = useState(claim?.claim_date ? claim.claim_date.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [symptom, setSymptom] = useState(claim?.symptom || '');
  const [remark, setRemark] = useState(claim?.remark || '');

  const [catalogParts, setCatalogParts] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  // คีย์ด้วย part.id (ของจากแคตตาล็อก) หรือ `custom-<index>` (พิมพ์เองสด ๆ ไม่มีในแคตตาล็อก)
  const [items, setItems] = useState(() => {
    const seeded = {};
    (claim?.items || []).forEach((it, idx) => {
      seeded[`existing-${it.id ?? idx}`] = {
        product_name: it.product_name,
        quantity: it.quantity,
        unitPrice: String(it.unit_price),
      };
    });
    return seeded;
  });
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customName, setCustomName] = useState('');

  useEffect(() => {
    setCatalogLoading(true);
    client.get('/service-items')
      .then((res) => setCatalogParts(
        (res.data.data || []).filter((si) => !si.is_set).map((si) => ({ id: si.id, part_name: si.product_name, category: si.category }))
      ))
      .catch(() => {})
      .finally(() => setCatalogLoading(false));
  }, []);

  const catalogCategories = useMemo(() => {
    const seen = new Set();
    const list = [];
    catalogParts.forEach((p) => {
      if (p.category && !seen.has(p.category)) { seen.add(p.category); list.push(p.category); }
    });
    return list;
  }, [catalogParts]);

  const filteredCatalogParts = categoryFilter
    ? catalogParts.filter((p) => p.category === categoryFilter)
    : catalogParts;

  const itemsList = Object.entries(items);
  const itemsTotal = itemsList.reduce((sum, [, it]) => sum + Number(it.quantity) * (Number(it.unitPrice) || 0), 0);

  const handleVehicleQueryChange = (value) => {
    setVehicleQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) {
      setVehicleResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await client.get('/repair-notices/vehicle-search', { params: { search: value } });
        setVehicleResults(res.data.data || []);
      } catch (err) {
        console.error('Error searching vehicles:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const pickVehicle = (v) => {
    setSelectedVehicle(v);
    setStep('details');
  };

  function toggleCatalogPart(part) {
    setItems((prev) => {
      const key = `catalog-${part.id}`;
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { product_name: part.part_name, quantity: 1, unitPrice: '' } };
    });
  }

  function changeQty(key, delta) {
    setItems((prev) => {
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

  function changePrice(key, value) {
    setItems((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], unitPrice: value } } : prev));
  }

  function removeItem(key) {
    setItems((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function addCustomItem(e) {
    e.preventDefault();
    if (!customName.trim()) return;
    setItems((prev) => ({
      ...prev,
      [`custom-${Date.now()}`]: { product_name: customName.trim(), quantity: 1, unitPrice: '' },
    }));
    setCustomName('');
    setShowAddCustom(false);
  }

  const handleSave = async () => {
    if (!selectedVehicle?.vehicle_id) {
      setError('กรุณาเลือกรถก่อน');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        customer_id: selectedVehicle.customer_id,
        vehicle_id: selectedVehicle.vehicle_id,
        claim_date: claimDate,
        symptom: symptom.trim() || null,
        remark: remark.trim() || null,
        items: itemsList.map(([, it]) => ({
          product_name: it.product_name,
          quantity: it.quantity,
          unit_price: Number(it.unitPrice) || 0,
        })),
      };
      if (isEdit) {
        await client.put(`/claims/${claim.id}`, payload);
      } else {
        await client.post('/claims', payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกเคลมไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? `แก้ไขเคลม ${claim.claim_no}` : 'เพิ่มเคลมใหม่'}</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        {step === 'vehicle' ? (
          <div className="modal-form">
            <p className="subtitle">ค้นหารถของลูกค้าที่มาเคลม (ทะเบียนรถ, ชื่อลูกค้า, หรือเบอร์โทร)</p>
            <input
              autoFocus
              type="text"
              className="search-input"
              value={vehicleQuery}
              onChange={(e) => handleVehicleQueryChange(e.target.value)}
              placeholder="พิมพ์ทะเบียนรถ, ชื่อลูกค้า, หรือเบอร์โทร"
            />
            {searching && <p className="loading">กำลังค้นหา...</p>}
            <div className="jdp-selected-list" style={{ marginTop: 12 }}>
              {vehicleResults.map((v) => (
                <button
                  key={v.vehicle_id}
                  type="button"
                  className="jdp-selected-row"
                  style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => pickVehicle(v)}
                >
                  <span className="jdp-selected-name">
                    {v.license_plate || '-'} · {v.brand} {v.model} {v.color ? `· ${v.color}` : ''}
                    <br />
                    {v.customer_name} {v.phone ? `· ${v.phone}` : ''}
                  </span>
                </button>
              ))}
              {!searching && vehicleQuery && vehicleResults.length === 0 && (
                <p className="empty-message">ไม่พบรถที่ตรงกับคำค้นหา</p>
              )}
            </div>
          </div>
        ) : (
          <div className="modal-form">
            {error && <div className="error-message">{error}</div>}

            <div className="info-card" style={{ marginBottom: 12 }}>
              <div className="info-card-title">
                {selectedVehicle.license_plate || '-'} · {selectedVehicle.brand} {selectedVehicle.model}
                {selectedVehicle.color ? ` · ${selectedVehicle.color}` : ''}
              </div>
              <div>{selectedVehicle.customer_name} {selectedVehicle.phone ? `· ${selectedVehicle.phone}` : ''}</div>
              {!isEdit && (
                <button type="button" onClick={() => setStep('vehicle')} style={{ marginTop: 8 }}>เปลี่ยนรถ</button>
              )}
            </div>

            <div className="form-group">
              <label>วันที่เคลม</label>
              <input type="date" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>อาการ/สิ่งที่เคลม</label>
              <textarea rows={2} value={symptom} onChange={(e) => setSymptom(e.target.value)} placeholder="เช่น แร็คพวงมาลัยมีเสียงหลังเปลี่ยน" />
            </div>
            <div className="form-group">
              <label>หมายเหตุ</label>
              <textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>

            <div className="jdp-part-picker">
              {itemsList.length > 0 && (
                <div className="jdp-selected-list">
                  <div className="jdp-selected-list-title">อะไหล่ที่เปลี่ยน ({itemsList.reduce((s, [, it]) => s + it.quantity, 0)} ชิ้น)</div>
                  {itemsList.map(([key, item]) => (
                    <div className="jdp-selected-row" key={key}>
                      <span className="jdp-selected-name">{item.product_name}</span>
                      <div className="jdp-selected-controls">
                        <div className="jdp-selected-qty">
                          <button type="button" onClick={() => changeQty(key, -1)} aria-label="ลดจำนวน">−</button>
                          <span>{item.quantity}</span>
                          <button type="button" onClick={() => changeQty(key, 1)} aria-label="เพิ่มจำนวน">+</button>
                        </div>
                        <label className="jdp-selected-price">
                          <span>฿</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="ราคา/หน่วย"
                            value={item.unitPrice}
                            onChange={(e) => changePrice(key, e.target.value)}
                          />
                        </label>
                        <button type="button" className="jdp-selected-remove" onClick={() => removeItem(key)} aria-label="ลบรายการ">✕</button>
                      </div>
                    </div>
                  ))}
                  <div className="jdp-selected-total">รวม {itemsTotal.toLocaleString('th-TH')} บาท</div>
                </div>
              )}

              {catalogLoading ? (
                <div className="loading">กำลังโหลดรายการสินค้า/บริการ...</div>
              ) : (
                <>
                  {catalogCategories.length > 0 && (
                    <div className="jdp-category-bar">
                      <button type="button" className={`jdp-category-chip ${!categoryFilter ? 'active' : ''}`} onClick={() => setCategoryFilter('')}>
                        ทั้งหมด
                      </button>
                      {catalogCategories.map((cat) => (
                        <button
                          type="button"
                          key={cat}
                          className={`jdp-category-chip ${categoryFilter === cat ? 'active' : ''}`}
                          onClick={() => setCategoryFilter(cat)}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="jdp-item-grid">
                    {filteredCatalogParts.map((part) => {
                      const selected = Boolean(items[`catalog-${part.id}`]);
                      return (
                        <button
                          type="button"
                          key={part.id}
                          className={`jdp-item-btn ${selected ? 'active' : ''}`}
                          onClick={() => toggleCatalogPart(part)}
                        >
                          {selected && <span className="jdp-item-check">✓</span>}
                          {part.part_name}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="jdp-add-part">
                {!showAddCustom ? (
                  <button type="button" onClick={() => setShowAddCustom(true)}>+ เพิ่มรายการที่ไม่มีในแคตตาล็อก</button>
                ) : (
                  <form className="modal-form jdp-add-part-form" onSubmit={addCustomItem}>
                    <label>ชื่ออะไหล่/รายการ</label>
                    <input type="text" autoFocus value={customName} onChange={(e) => setCustomName(e.target.value)} />
                    <div className="modal-actions">
                      <button type="submit" className="btn btn-primary btn-sm">เพิ่ม</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setShowAddCustom(false); setCustomName(''); }}>ยกเลิก</button>
                    </div>
                  </form>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'กำลังบันทึก...' : isEdit ? 'บันทึกการแก้ไข' : 'บันทึกเคลม'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={onClose}>ยกเลิก</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
