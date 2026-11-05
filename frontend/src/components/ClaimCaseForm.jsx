import React, { useEffect, useMemo, useRef, useState } from 'react';
import client from '../api/client';
import { todayStr } from '../utils/format';
import { formatDateTh } from '../utils/dateGroups';
import { CASE_TYPE_LABEL, OUTCOME_LABEL, followUpDateOf } from '../utils/claimCases';
import FollowUpSelect from './FollowUpSelect';
import ClaimPrintModal from './ClaimPrintModal';

// The details of a case: what the customer reported, what was found, how it was fixed, the parts replaced, the follow-up
// call, and the claim document. Used by the case form (ClaimFormModal.jsx) and by the job page of a come-back
// (JobDetailPage.jsx).
//
// claim: null = new case, object = from GET /claims/:id
// vehicle: { vehicle_id, customer_id } of the car the case is about
// notice: a short message shown beside the buttons, where the person who just pressed one is looking
export default function ClaimCaseForm({ claim, vehicle, onSaved, onCancel, cancelLabel = 'ยกเลิก', notice = '' }) {
  const isEdit = Boolean(claim?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // a required field that is empty: the message sits under the field, and the field takes the focus
  const [fieldError, setFieldError] = useState(null);
  const symptomRef = useRef(null);
  const resolutionRef = useRef(null);
  const [printClaimId, setPrintClaimId] = useState(null);

  const [claimDate, setClaimDate] = useState(claim?.claim_date ? claim.claim_date.slice(0, 10) : todayStr());
  const [symptom, setSymptom] = useState(claim?.symptom || '');
  const [remark, setRemark] = useState(claim?.remark || '');
  const [caseType, setCaseType] = useState(claim?.case_type || 'rework');
  const [sourceReceiptId, setSourceReceiptId] = useState(claim?.source_receipt_id ? String(claim.source_receipt_id) : '');
  const [finding, setFinding] = useState(claim?.finding || '');
  const [resolution, setResolution] = useState(claim?.resolution || '');
  const [followUpChoice, setFollowUpChoice] = useState('');
  const [followUpCustom, setFollowUpCustom] = useState('');
  const pendingFollowUp = (claim?.follow_ups || []).find((f) => !f.done_at);
  const isClosed = claim?.status === 'closed';
  const [carBills, setCarBills] = useState([]);
  const [similarCases, setSimilarCases] = useState([]);

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
  // a come-back usually has no parts, so the long parts list opens only when it is wanted
  const [partsWanted, setPartsWanted] = useState(false);
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

  // บิลของรถคันนี้ (ให้เลือกบิลต้นเหตุ) และเคสเก่าของรุ่นเดียวกันที่เคยแก้ไว้ (เป็นแนวทาง)
  const selectedVehicleId = vehicle?.vehicle_id;
  useEffect(() => {
    if (!selectedVehicleId) return;
    client.get(`/vehicle-history/${selectedVehicleId}`)
      .then((res) => setCarBills(res.data.data.visits || []))
      .catch(() => setCarBills([]));
    client.get('/claims/similar', { params: { vehicle_id: selectedVehicleId, exclude: claim?.id } })
      .then((res) => setSimilarCases(res.data.data || []))
      .catch(() => setSimilarCases([]));
  }, [selectedVehicleId, claim?.id]);

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

  const showFieldError = (field, ref, text) => {
    setFieldError({ field, text });
    ref.current?.focus();
  };

  // Saves the form and returns the case id, or null when the form has a problem (the message is already showing)
  const saveCase = async () => {
    if (!vehicle?.vehicle_id) {
      setError('กรุณาเลือกรถก่อน');
      return null;
    }
    const followUpDate = followUpDateOf(followUpChoice, followUpCustom, todayStr());
    if (followUpDate === null) {
      setError('กรุณาเลือกวันที่ติดตามผล');
      return null;
    }
    if (followUpDate && !resolution.trim()) {
      showFieldError('resolution', resolutionRef, 'กรุณากรอกวิธีแก้ก่อนตั้งวันติดตามผล');
      return null;
    }
    const payload = {
      customer_id: vehicle.customer_id,
      vehicle_id: vehicle.vehicle_id,
      claim_date: claimDate,
      symptom: symptom.trim() || null,
      remark: remark.trim() || null,
      case_type: caseType,
      source_receipt_id: sourceReceiptId || null,
      finding: finding.trim() || null,
      resolution: resolution.trim() || null,
      ...(followUpDate ? { follow_up_date: followUpDate } : {}),
      items: itemsList.map(([, it]) => ({
        product_name: it.product_name,
        quantity: it.quantity,
        unit_price: Number(it.unitPrice) || 0,
      })),
    };
    if (isEdit) {
      await client.put(`/claims/${claim.id}`, payload);
      return claim.id;
    }
    const res = await client.post('/claims', payload);
    return res.data.id;
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setFieldError(null);
    try {
      if (await saveCase()) onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกเคลมไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleIssue = async () => {
    setError('');
    setFieldError(null);
    if (!symptom.trim()) {
      showFieldError('symptom', symptomRef, 'กรุณากรอกอาการที่ลูกค้าแจ้งก่อนออกใบเคลม');
      return;
    }
    if (!resolution.trim()) {
      showFieldError('resolution', resolutionRef, 'กรุณากรอกวิธีแก้ก่อนออกใบเคลม');
      return;
    }
    setSaving(true);
    try {
      const id = await saveCase();
      if (id) {
        await client.post(`/claims/${id}/issue-document`);
        setPrintClaimId(id);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'ออกใบเคลมไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-form case-form">
      {isClosed && (
        <div className="fu-closed">
          <strong>เคสนี้ปิดแล้ว</strong>
          {claim.outcome ? ` · ${OUTCOME_LABEL[claim.outcome]}` : ''}
          {claim.closed_by ? ` · ปิดโดย ${claim.closed_by}` : ''}
          {claim.closed_at ? ` · ${formatDateTh(String(claim.closed_at).slice(0, 10))}` : ''}
          {claim.lesson && <div><strong>แนวทางครั้งหน้า:</strong> {claim.lesson}</div>}
          <div className="vh-muted">ถ้าปัญหากลับมา ผู้จัดการกด "เปิดเคสใหม่" ในรายการเคสเพื่อทำต่อและตั้งการติดตามผล</div>
        </div>
      )}

      {claim?.status === 'continued' && (
        <div className="fu-closed">
          <strong>รถกลับมาแก้ต่อแล้ว</strong>
          <div className="vh-muted">งานรอบใหม่อยู่ในเคสที่เปิดต่อจากเคสนี้ ส่วนการโทรติดตามผลอยู่ที่เคสใหม่</div>
        </div>
      )}

      {claim?.earlier_rounds && (
        <details className="fu-similar" open>
          <summary>รอบก่อนที่รถกลับมา</summary>
          <div className="case-earlier">{claim.earlier_rounds}</div>
        </details>
      )}

      {similarCases.length > 0 && (
        <details className="fu-similar">
          <summary>เคยมีเคสของรุ่นนี้ {similarCases.length} เคส ดูวิธีแก้เป็นแนวทาง</summary>
          {similarCases.map((c) => (
            <div key={c.id} className="fu-similar-item">
              <div className="vh-muted">
                {c.claim_no} · {formatDateTh(c.claim_date)}
                {c.outcome ? ` · ${OUTCOME_LABEL[c.outcome]}` : ''}
              </div>
              {c.symptom && <div><strong>อาการ:</strong> {c.symptom}</div>}
              {c.finding && <div><strong>ตรวจพบ:</strong> {c.finding}</div>}
              <div><strong>วิธีแก้:</strong> {c.resolution}</div>
              {c.lesson && <div><strong>แนวทาง:</strong> {c.lesson}</div>}
            </div>
          ))}
        </details>
      )}

      <div className="form-group">
        <label>ประเภทเคส</label>
        <select value={caseType} onChange={(e) => setCaseType(e.target.value)}>
          {Object.entries(CASE_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>วันที่รถเข้ามา</label>
        <input type="date" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} />
      </div>
      <div className="form-group">
        <label>บิลต้นเหตุ (ไม่บังคับ)</label>
        <select value={sourceReceiptId} onChange={(e) => setSourceReceiptId(e.target.value)}>
          <option value="">ไม่ระบุ</option>
          {carBills.map((b) => (
            <option key={b.receipt_id} value={b.receipt_id}>{b.receipt_no} · {formatDateTh(b.date)}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>อาการที่ลูกค้าแจ้ง</label>
        <textarea ref={symptomRef} rows={2} value={symptom} onChange={(e) => setSymptom(e.target.value)} placeholder="เช่น แร็คพวงมาลัยมีเสียงหลังเปลี่ยน" />
        {fieldError?.field === 'symptom' && <div className="error-text" role="alert">{fieldError.text}</div>}
      </div>
      <div className="form-group">
        <label>สิ่งที่ตรวจพบ</label>
        <textarea rows={2} value={finding} onChange={(e) => setFinding(e.target.value)} placeholder="เช่น น็อตยึดหลวม" />
      </div>
      <div className="form-group">
        <label>วิธีแก้</label>
        <textarea ref={resolutionRef} rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="เช่น ขันน็อตใหม่ตามค่าทอร์ค แล้วลองขับ" />
        {fieldError?.field === 'resolution' && <div className="error-text" role="alert">{fieldError.text}</div>}
      </div>
      {!isClosed && claim?.status !== 'continued' && (
        <FollowUpSelect
          choice={followUpChoice}
          onChoice={setFollowUpChoice}
          customDate={followUpCustom}
          onCustomDate={setFollowUpCustom}
          pendingDate={pendingFollowUp?.scheduled_date}
        />
      )}
      <div className="form-group">
        <label>หมายเหตุ</label>
        <textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
      </div>

      {!(partsWanted || caseType === 'parts_claim' || itemsList.length > 0) ? (
        <button type="button" className="btn btn-secondary" onClick={() => setPartsWanted(true)}>+ มีอะไหล่ที่เปลี่ยน</button>
      ) : (
        <div className="jdp-part-picker">
          {itemsList.length > 0 && (
            <div className="jdp-selected-list">
              <div className="jdp-selected-list-title">อะไหล่ที่เปลี่ยน ({itemsList.reduce((s, [, it]) => s + it.quantity, 0)} ชิ้น)</div>
              <p className="vh-muted">อะไหล่ที่เคลมให้ลูกค้าฟรี เว้นราคาไว้ ใส่ราคาเฉพาะชิ้นที่ไม่เกี่ยวกับรายการที่ซ่อมและต้องเก็บเงิน</p>
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
                        placeholder="ฟรี (เคลม)"
                        value={Number(item.unitPrice) ? item.unitPrice : ''}
                        onChange={(e) => changePrice(key, e.target.value)}
                      />
                    </label>
                    <button type="button" className="jdp-selected-remove" onClick={() => removeItem(key)} aria-label="ลบรายการ">✕</button>
                  </div>
                </div>
              ))}
              <div className="jdp-selected-total">ค่าใช้จ่ายอะไหล่รวม {itemsTotal.toLocaleString('th-TH')} บาท</div>
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
              <div className="modal-form jdp-add-part-form">
                <label>ชื่ออะไหล่/รายการ</label>
                <input type="text" autoFocus value={customName} onChange={(e) => setCustomName(e.target.value)} />
                <div className="modal-actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={addCustomItem}>เพิ่ม</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setShowAddCustom(false); setCustomName(''); }}>ยกเลิก</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div className="error-message" role="alert">{error}</div>}
      {notice && <div className="info-message" role="status">{notice}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'กำลังบันทึก...' : isEdit ? 'บันทึกการแก้ไข' : 'บันทึกเคส'}
        </button>
        <button type="button" className="btn case-issue-btn" onClick={handleIssue} disabled={saving}>
          🖨️ {claim?.doc_issued_at ? 'บันทึกและพิมพ์ใบเคลม' : 'บันทึกและออกใบเคลม'}
        </button>
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>}
      </div>

      {printClaimId && (
        <ClaimPrintModal
          claimId={printClaimId}
          onClose={() => { setPrintClaimId(null); onSaved(); }}
        />
      )}
    </div>
  );
}
