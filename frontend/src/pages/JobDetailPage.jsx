import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import client from '../api/client';
import { jobStatusDef } from '../utils/jobStatus';
import { formatDbDateTime, todayStr } from '../utils/format';
import DeclineReasonModal from '../components/DeclineReasonModal';
import QuotationPrintModal from '../components/QuotationPrintModal';
import useRealtimeEvent from '../hooks/useRealtimeEvent';

/**
 * รายละเอียดงาน 1 คัน — ข้อมูลรถ/ลูกค้า, รายการอะไหล่/ใบเสนอราคา, ประวัติสถานะ
 * ส่วนสถานะ/ช่องยก (เปลี่ยนไปมา, ย้อนกลับ) ย้ายไปอยู่หน้าการ์ดที่ JobBoardPage.jsx
 * แล้วตามที่เจ้าของร้านสั่ง — หน้านี้เหลือแค่เรื่องที่ซับซ้อนกว่านั้น: แก้ข้อมูล
 * รถ/ลูกค้า และตัดสินใจใบเสนอราคา (อนุมัติ/นัดวัน/ไม่ทำ)
 *
 * จุดตัดสินใจ 3 ทางแยก (อนุมัติ/นัดวันมาทำ/ไม่อนุมัติ) เรียก endpoint เฉพาะของ
 * ใบเสนอราคาเอง (/approve สร้างใบเสร็จ, /schedule ต้องมีวันนัด, /decline ต้องมี
 * เหตุผล — ตัวเดียวกับที่ QuotationListPage.jsx ใช้) แล้วค่อยอัปเดตสถานะงานให้
 * ตรงกันทีหลัง ไม่ใช่ยิง PATCH /jobs/:id/status เฉย ๆ เพราะงั้นจะข้าม side effect
 * สำคัญไป (ดูคอมเมนต์ที่ backend/src/routes/jobs.routes.js PATCH /:id/status)
 */
export default function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [form, setForm] = useState(null);

  // เลือกรายการสินค้า/บริการ (tick-select เหมือน PartsCatalogKioskPage.jsx)
  // แทนตารางกรอกมือแบบเดิม — คีย์ด้วย part.id ดึงจาก service_items แทน
  // quote_part_prices เพราะ (1) มีหมวดหมู่ครบอยู่แล้ว ไม่ผูกกับยี่ห้อ/รุ่นรถ
  // เหมือน quote_part_prices ที่ต้องกรอกยี่ห้อ/รุ่นก่อนถึงจะเห็นรายการ (2) ไม่มี
  // คอลัมน์ราคาเก็บไว้เลย ตรงกับที่ต้องการ — พนักงานเสนอราคาเองทุกครั้งตามแต่ละ
  // เคส ไม่ใช้ราคาตายตัวจากแคตตาล็อก (quote_part_prices ยังเก็บไว้ใช้ในอนาคต
  // ที่อื่นตามเดิม แค่ไม่ใช้ในแผงนี้แล้ว)
  //
  // selectedParts รวม "รายการที่มีอยู่แล้วในใบเสนอราคา" (คีย์ existing-<id>, seed
  // ตอนโหลดใบเสนอราคาที่มีอยู่) กับ "รายการที่เพิ่งติ๊กเลือกใหม่" (คีย์ = part.id
  // ตัวเลข) ไว้ในก้อนเดียวกัน เพื่อให้หน้านี้แก้ไขรายการได้ตลอดแม้สร้างใบเสนอราคา
  // ไปแล้ว (เจ้าของร้านขอ — เจอว่าต้องเพิ่มอะไหล่ทีหลังจะได้เพิ่มเข้าใบเดิมได้เลย
  // ไม่ต้องออกไปแก้ที่หน้าใบเสนอราคาแยก) และให้เป็น single source of truth เดียว
  // สำหรับทั้งช่อง checkmark ในกริดและรายการสรุปด้านบนที่โชว์ตลอดไม่ว่าจะกรอง
  // หมวดหมู่ไหนอยู่ (แก้ปัญหาเดิม: ติ๊กแล้วเปลี่ยนหมวดหมู่ มองไม่เห็นว่าเลือกอะไรไว้)
  const [catalogParts, setCatalogParts] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedParts, setSelectedParts] = useState({});
  const [quotationMeta, setQuotationMeta] = useState(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [showAddPart, setShowAddPart] = useState(false);
  const [newPart, setNewPart] = useState({ part_name: '', category: '' });
  const [addingPart, setAddingPart] = useState(false);
  const [addPartError, setAddPartError] = useState('');

  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(todayStr());
  const [showDecline, setShowDecline] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);

  const load = async ({ silent } = {}) => {
    try {
      if (!silent) setLoading(true);
      const res = await client.get(`/jobs/${id}`);
      setJob(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดข้อมูลงานไม่สำเร็จ');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  // Realtime: pick up status/quotation changes made elsewhere (e.g. the job
  // board card, or another staff device) without a manual reload. Skipped
  // while the user has the edit form open or a mutation in flight, so a
  // background refresh never clobbers unsaved input or races an in-flight
  // action's own `load()` call.
  useRealtimeEvent(
    ['job:updated', 'job:status-changed', 'job:quotation-linked'],
    (payload) => {
      if (String(payload.jobId) !== String(id)) return;
      if (editing || saving || busy) return;
      load({ silent: true });
    }
  );

  useEffect(() => {
    if (!form?.brand?.trim()) { setModels([]); return; }
    client.get('/vehicle-models/models', { params: { brand: form.brand.trim() } }).then((res) => setModels(res.data.data || []));
  }, [form?.brand]);

  // โหลดรายการสินค้า/บริการ (ไม่ผูกกับยี่ห้อ/รุ่นรถ) เสมอ ไม่ว่าจะมีใบเสนอราคา
  // อยู่แล้วหรือยัง เพราะแผงนี้แก้ไข/เพิ่มรายการได้ตลอด — ตัด "ชุดโปร" (is_set)
  // ออก เพราะราคาชุดคำนวณแยกและต้อง expand เป็นรายการย่อย ซึ่งซับซ้อนเกินความ
  // จำเป็นของแผงนี้ — เลือกทีละชิ้นตามปกติพอ
  useEffect(() => {
    if (!job) return;
    setCatalogLoading(true);
    setCatalogError('');
    client.get('/service-items')
      .then((res) => setCatalogParts(
        (res.data.data || [])
          .filter((si) => !si.is_set)
          .map((si) => ({ id: si.id, part_name: si.product_name, category: si.category }))
      ))
      .catch((err) => setCatalogError(err.response?.data?.error || 'โหลดรายการสินค้า/บริการไม่สำเร็จ'))
      .finally(() => setCatalogLoading(false));
  }, [job?.id]);

  // มีใบเสนอราคาอยู่แล้ว — โหลดรายการที่มีอยู่มา seed selectedParts (คีย์
  // existing-<quotation_items.id>) พร้อมเก็บฟิลด์อื่นของใบเสนอราคาไว้ใน
  // quotationMeta ไว้ส่งกลับตอนบันทึกทับ (PUT ต้องส่งฟิลด์ครบ ไม่งั้นข้อมูลเดิม
  // เช่นมัดจำ/หมายเหตุจะหาย) — ผูก dependency กับ job?.quotation_id เท่านั้น
  // (ไม่ใช่ทั้ง job object) กัน effect นี้รันซ้ำทุกครั้งที่ job ถูก reload เบื้องหลัง
  // (เช่นจาก realtime) ซึ่งจะทับรายการที่กำลังแก้ไขอยู่ทิ้ง
  useEffect(() => {
    if (!job?.quotation_id) { setQuotationMeta(null); setSelectedParts({}); return; }
    setItemsLoading(true);
    client.get(`/quotations/${job.quotation_id}`)
      .then((res) => {
        const q = res.data.data;
        setQuotationMeta(q);
        const seeded = {};
        (q.items || []).forEach((it) => {
          seeded[`existing-${it.id}`] = {
            part_name: it.product_name,
            quantity: it.quantity,
            unitPrice: String(it.unit_price),
          };
        });
        setSelectedParts(seeded);
      })
      .catch((err) => setCatalogError(err.response?.data?.error || 'โหลดรายการในใบเสนอราคาไม่สำเร็จ'))
      .finally(() => setItemsLoading(false));
  }, [job?.quotation_id]);

  function startEdit() {
    setForm({
      customer_name: job.customer_name || '',
      phone: job.phone || '',
      brand: job.brand || '',
      model: job.model || '',
      color: job.color || '',
      license_plate: job.license_plate || '',
      mileage_in: job.mileage_in ?? '',
      queue_no: job.queue_no || '',
      symptom: job.symptom || '',
    });
    if (brands.length === 0) client.get('/vehicle-models/brands').then((res) => setBrands(res.data.data || []));
    setEditing(true);
  }

  // แก้ 3 จุดพร้อมกัน (ลูกค้า/รถ/งาน อยู่คนละตารางกัน) — ยี่ห้อ/รุ่นที่พิมพ์ใหม่ไม่มี
  // ในแคตตาล็อกก็เพิ่มให้เหมือนตอนเพิ่มคิว (ดู AddJobModal.jsx) ไม่มี transaction
  // ครอบคุมทั้ง 3 endpoint เพราะเป็นการแก้ไขข้อมูลอ้างอิง (ไม่ใช่ตัดสต๊อก/เงิน) ถ้า
  // ล้มเหลวกลางทางแค่กด "บันทึก" ซ้ำได้ ไม่มีผลข้างเคียงที่ต้อง rollback
  async function saveEdit() {
    setSaving(true);
    setError('');
    try {
      const brandKnown = brands.includes(form.brand.trim());
      const modelKnown = models.some((m) => m.model === form.model.trim());
      if (form.brand.trim() && form.model.trim() && (!brandKnown || !modelKnown)) {
        await client.post('/vehicle-models', { brand: form.brand.trim(), model: form.model.trim() }).catch(() => {});
      }

      await client.put(`/customers/${job.customer_id}`, { customer_name: form.customer_name.trim(), phone: form.phone.trim() });
      await client.put(`/vehicles/${job.vehicle_id}`, {
        brand: form.brand.trim(), model: form.model.trim(), color: form.color.trim(),
        license_plate: form.license_plate.trim().toUpperCase(), mileage: Number(form.mileage_in) || 0,
      });
      await client.patch(`/jobs/${id}`, {
        queue_no: form.queue_no, mileage_in: Number(form.mileage_in) || null, symptom: form.symptom,
      });

      setEditing(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  // จิ้มเลือก/ถอนรายการ (เหมือน PartsCatalogKioskPage.jsx) — ไม่มีราคาตั้งต้น
  // จากแคตตาล็อกให้เติมให้ (service_items ไม่เก็บราคา) พนักงานพิมพ์ราคาเอง
  // ทุกครั้งตามหน้างานจริง
  function togglePart(part) {
    setSelectedParts((prev) => {
      const key = part.id;
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return {
        ...prev,
        [key]: { ...part, quantity: 1, unitPrice: '' },
      };
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
  const selectedPartsCount = selectedPartsList.reduce((sum, p) => sum + p.quantity, 0);
  const selectedPartsTotal = selectedPartsList.reduce((sum, p) => sum + p.quantity * (Number(p.unitPrice) || 0), 0);

  // เพิ่มรายการสินค้า/บริการใหม่ที่ยังไม่มีในระบบ (POST /service-items) — ไม่มี
  // ช่องราคา เพราะ service_items ไม่เก็บราคาไว้เลย พนักงานพิมพ์ราคาเองตอนติ๊ก
  // เลือกเข้ารายการ (เหมือนรายการอื่นทุกชิ้นในแผงนี้)
  async function submitNewPart(e) {
    e.preventDefault();
    if (!newPart.part_name.trim()) {
      setAddPartError('กรุณากรอกชื่อสินค้า/บริการ');
      return;
    }
    if (!newPart.category.trim()) {
      setAddPartError('กรุณากรอกหมวดหมู่');
      return;
    }
    setAddingPart(true);
    setAddPartError('');
    try {
      const res = await client.post('/service-items', {
        category: newPart.category.trim(),
        product_name: newPart.part_name.trim(),
      });
      const created = {
        id: res.data.data.id,
        part_name: newPart.part_name.trim(),
        category: newPart.category.trim(),
      };
      setCatalogParts((prev) => [...prev, created]);
      setSelectedParts((prev) => ({
        ...prev,
        [created.id]: { ...created, quantity: 1, unitPrice: '' },
      }));
      setNewPart({ part_name: '', category: '' });
      setShowAddPart(false);
    } catch (err) {
      setAddPartError(err.response?.data?.error || 'เพิ่มรายการไม่สำเร็จ');
    } finally {
      setAddingPart(false);
    }
  }

  // บันทึกรายการที่ติ๊กเลือกไว้ — ยังไม่มีใบเสนอราคาก็สร้างใหม่ (ใช้ลูกค้า/รถของ
  // งานนี้เลย ไม่ต้องค้นหาใหม่) แล้วผูกกลับเข้างานทันที; ถ้ามีใบเสนอราคาอยู่แล้ว
  // ก็แก้ไขรายการทับของเดิมทั้งชุดผ่าน PUT ปกติ (endpoint เดียวกับที่หน้าคีออส/
  // หน้าใบเสนอราคาใช้แก้ไข ไม่ใช่ endpoint พิเศษ) ทำให้หน้านี้แก้ไขรายการได้ตลอด
  // แม้จะกดสร้างใบเสนอราคาไปแล้ว เช่นทำไปแล้วเจอว่าต้องเปลี่ยนอะไหล่เพิ่ม
  async function saveQuotationItems() {
    if (selectedPartsList.length === 0) {
      setError('กรุณาเลือกรายการอย่างน้อย 1 รายการ');
      return;
    }
    setBusy(true);
    setError('');
    const items = selectedPartsList.map((p) => ({
      product_name: p.part_name,
      quantity: p.quantity,
      unit_price: Number(p.unitPrice) || 0,
    }));
    try {
      if (job.quotation_id) {
        await client.put(`/quotations/${job.quotation_id}`, {
          customer_id: quotationMeta?.customer_id,
          vehicle_id: quotationMeta?.vehicle_id,
          quotation_date: quotationMeta?.quotation_date,
          mileage: quotationMeta?.mileage,
          remark: quotationMeta?.remark,
          queue_no: quotationMeta?.queue_no,
          symptom: quotationMeta?.symptom,
          deposit_amount: quotationMeta?.deposit_amount,
          deposit_date: quotationMeta?.deposit_date,
          items,
        });
      } else {
        const res = await client.post('/quotations', {
          customer_id: job.customer_id,
          vehicle_id: job.vehicle_id,
          quotation_date: todayStr(),
          mileage: job.mileage_in || 0,
          queue_no: job.queue_no || null,
          symptom: job.symptom || null,
          items,
        });
        await client.patch(`/jobs/${id}/quotation`, { quotation_id: res.data.quotation_id });
      }
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!job.quotation_id) return;
    setBusy(true);
    setError('');
    try {
      await client.patch(`/quotations/${job.quotation_id}/approve`);
      await client.patch(`/jobs/${id}/status`, { status: 'approved' });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'อนุมัติไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function handleSchedule() {
    if (!job.quotation_id || !scheduleDate) return;
    setBusy(true);
    setError('');
    try {
      await client.patch(`/quotations/${job.quotation_id}/schedule`, { scheduled_date: scheduleDate });
      await client.patch(`/jobs/${id}/status`, { status: 'scheduled' });
      setShowSchedule(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกวันนัดหมายไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeclineConfirm({ reason, note }) {
    if (!job.quotation_id) return;
    setBusy(true);
    setError('');
    try {
      await client.patch(`/quotations/${job.quotation_id}/decline`, { reason, note });
      await client.patch(`/jobs/${id}/status`, { status: 'rejected' });
      setShowDecline(false);
      navigate('/quotations/declined-summary');
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="office-dashboard container"><div className="loading">กำลังโหลด...</div></div>;
  if (!job) return <div className="office-dashboard container"><div className="error-message">{error || 'ไม่พบงานนี้'}</div></div>;

  const isDecisionPoint = job.status === 'quoted';

  return (
    <div className="office-dashboard container">
      <div className="dashboard-header">
        <h2>{job.job_no} <span className="dashboard-header-sub">— คิว {job.queue_no || '-'}</span></h2>
        <button type="button" onClick={() => navigate('/jobs')}>← กลับรายการงาน</button>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          ข้อมูลรถ / ลูกค้า
          {!editing && <button type="button" onClick={startEdit}>แก้ไข</button>}
        </div>

        {editing ? (
          <form className="modal-form" onSubmit={(e) => { e.preventDefault(); saveEdit(); }}>
            <label>เลขคิว</label>
            <input type="text" value={form.queue_no} onChange={(e) => setForm({ ...form, queue_no: e.target.value })} />

            <label>ทะเบียนรถ</label>
            <input type="text" value={form.license_plate} onChange={(e) => setForm({ ...form, license_plate: e.target.value })} />

            <label>ชื่อลูกค้า</label>
            <input type="text" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />

            <label>เบอร์โทรศัพท์</label>
            <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />

            <label>ยี่ห้อรถ</label>
            <input
              type="text" list="jdp-brand-options" value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value, model: '' })}
            />
            <datalist id="jdp-brand-options">
              {brands.map((b) => <option key={b} value={b} />)}
            </datalist>

            <label>รุ่นรถ</label>
            <input type="text" list="jdp-model-options" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <datalist id="jdp-model-options">
              {models.map((m) => <option key={m.model} value={m.model} />)}
            </datalist>

            <label>สีรถ</label>
            <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />

            <label>เลขไมล์</label>
            <input type="number" min="0" value={form.mileage_in} onChange={(e) => setForm({ ...form, mileage_in: e.target.value })} />

            <label>อาการ</label>
            <textarea rows={3} value={form.symptom} onChange={(e) => setForm({ ...form, symptom: e.target.value })} />

            {error && <p className="error-text">{error}</p>}

            <div className="modal-actions">
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
              <button type="button" onClick={() => { setEditing(false); setError(''); }} disabled={saving}>ยกเลิก</button>
            </div>
          </form>
        ) : (
          <>
            {job.photos && job.photos.length > 0 && (
              <div className="job-detail-photos">
                {job.photos.map((p) => (
                  <img key={p.id} src={p.photo_data} alt="" />
                ))}
              </div>
            )}
            <p><strong>ชื่อลูกค้า:</strong> {job.customer_name || '-'} {job.phone && `(${job.phone})`}</p>
            <p><strong>ยี่ห้อรถ:</strong> {job.brand || '-'}</p>
            <p><strong>รุ่นรถ:</strong> {job.model || '-'} {job.color && `· ${job.color}`}</p>
            <p><strong>ทะเบียนรถ:</strong> {job.license_plate || '-'}</p>
            <p><strong>เลขไมล์:</strong> {job.mileage_in ?? '-'}</p>
            <p><strong>อาการที่แจ้ง:</strong> {job.symptom || '-'}</p>
            {job.note && <p><strong>หมายเหตุ:</strong> {job.note}</p>}
            <p style={{ fontSize: 13, color: '#6b7280' }}>ดูสถานะ/เปลี่ยนสถานะ/ช่องยกได้ที่การ์ดในหน้ารายการงานวันนี้</p>
          </>
        )}
      </div>

      {isDecisionPoint && (
        <div className="dash-panel">
          <div className="dash-panel-title">ตัดสินใจใบเสนอราคา</div>
          {error && <p className="error-text">{error}</p>}
          {job.quotation_id ? (
            <>
              <div className="modal-actions" style={{ marginBottom: 10 }}>
                <button type="button" onClick={() => setShowPrintModal(true)}>
                  เซ็นเอกสาร / พิมพ์ใบเสนอราคา
                </button>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-primary" disabled={busy || !job.customer_signature} onClick={handleApprove}>
                  อนุมัติ
                </button>
                <button type="button" disabled={busy} onClick={() => setShowSchedule(true)}>
                  นัดวันมาทำ
                </button>
                <button type="button" className="btn-danger" disabled={busy} onClick={() => setShowDecline(true)}>
                  ไม่ทำ
                </button>
              </div>
              {!job.customer_signature && (
                <p style={{ color: '#92400e', fontSize: 12.5, marginTop: 6 }}>กรุณาเซ็นเอกสารก่อนกดอนุมัติ</p>
              )}
            </>
          ) : (
            <p style={{ color: '#92400e', fontSize: 13 }}>⚠️ เพิ่มรายการอะไหล่แล้วสร้างใบเสนอราคาก่อน ถึงจะตัดสินใจได้</p>
          )}
        </div>
      )}

      <div className="dash-panel">
        <div className="dash-panel-title">ใบเสนอราคา</div>
        {job.quotation_id && (
          <p className="jdp-quotation-meta">
            เลขที่ <strong>{job.quotation_no}</strong> — สถานะ {job.quotation_status}
            {' '}(<Link to="/quotations">ไปหน้าใบเสนอราคา / พิมพ์</Link>)
          </p>
        )}

        <div className="jdp-part-picker">
          {error && <p className="error-text">{error}</p>}
          {catalogError && <p className="error-text">{catalogError}</p>}

          {/* รายการที่เลือกไว้ — โชว์ตลอดไม่ว่าจะกรองหมวดหมู่ไหนอยู่ (ทั้งของเดิม
              ที่มีอยู่แล้วในใบเสนอราคา และของที่เพิ่งติ๊กเพิ่ม) แก้จำนวน/ราคา/ลบ
              ได้ตรงนี้เลย ไม่ต้องไล่หาในกริดด้านล่าง */}
          {selectedPartsList.length > 0 && (
            <div className="jdp-selected-list">
              <div className="jdp-selected-list-title">รายการที่เลือก ({selectedPartsCount} ชิ้น)</div>
              {Object.entries(selectedParts).map(([key, item]) => (
                <div className="jdp-selected-row" key={key}>
                  <span className="jdp-selected-name">{item.part_name}</span>
                  <div className="jdp-selected-qty">
                    <button type="button" onClick={() => changePartQty(key, -1)} aria-label="ลดจำนวน">−</button>
                    <span>{item.quantity}</span>
                    <button type="button" onClick={() => changePartQty(key, 1)} aria-label="เพิ่มจำนวน">+</button>
                  </div>
                  <label className="jdp-selected-price">
                    <span>฿</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="ราคา/หน่วย"
                      value={item.unitPrice}
                      onChange={(e) => updatePartPrice(key, e.target.value)}
                    />
                  </label>
                  <button type="button" className="jdp-selected-remove" onClick={() => removeSelected(key)} aria-label="ลบรายการ">
                    ✕
                  </button>
                </div>
              ))}
              <div className="jdp-selected-total">รวม {selectedPartsTotal.toLocaleString('th-TH')} บาท</div>
            </div>
          )}

          {catalogLoading || itemsLoading ? (
            <div className="loading">กำลังโหลดรายการสินค้า/บริการ...</div>
          ) : (
            <>
              {catalogCategories.length > 0 && (
                <div className="jdp-category-bar">
                  <button
                    type="button"
                    className={`jdp-category-chip ${!categoryFilter ? 'active' : ''}`}
                    onClick={() => setCategoryFilter('')}
                  >
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

              {filteredCatalogParts.length === 0 ? (
                <p className="empty-message">ยังไม่มีรายการสินค้า/บริการในระบบ — เพิ่มใหม่ได้ด้านล่าง</p>
              ) : (
                <div className="jdp-item-grid">
                  {filteredCatalogParts.map((part) => {
                    const selected = selectedParts[part.id];
                    return (
                      <button
                        type="button"
                        key={part.id}
                        className={`jdp-item-btn ${selected ? 'active' : ''}`}
                        onClick={() => togglePart(part)}
                      >
                        {selected && <span className="jdp-item-check">✓</span>}
                        {part.part_name}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div className="jdp-add-part">
            {!showAddPart ? (
              <button type="button" onClick={() => setShowAddPart(true)}>
                + เพิ่มรายการใหม่
              </button>
            ) : (
              <form className="modal-form jdp-add-part-form" onSubmit={submitNewPart}>
                <label>ชื่อสินค้า/บริการ</label>
                <input
                  type="text"
                  value={newPart.part_name}
                  onChange={(e) => setNewPart({ ...newPart, part_name: e.target.value })}
                />
                <label>หมวดหมู่</label>
                <input
                  type="text"
                  list="jdp-category-options"
                  value={newPart.category}
                  onChange={(e) => setNewPart({ ...newPart, category: e.target.value })}
                />
                <datalist id="jdp-category-options">
                  {catalogCategories.map((c) => <option key={c} value={c} />)}
                </datalist>
                {addPartError && <p className="error-text">{addPartError}</p>}
                <div className="modal-actions">
                  <button type="submit" className="btn-primary" disabled={addingPart}>
                    {addingPart ? 'กำลังเพิ่ม...' : 'เพิ่ม'}
                  </button>
                  <button type="button" onClick={() => { setShowAddPart(false); setAddPartError(''); }} disabled={addingPart}>
                    ยกเลิก
                  </button>
                </div>
              </form>
            )}
          </div>

          <button
            type="button"
            className="btn-primary"
            disabled={busy || itemsLoading || selectedPartsList.length === 0}
            onClick={saveQuotationItems}
          >
            {busy ? 'กำลังบันทึก...' : job.quotation_id ? '+ เพิ่มรายการเข้าใบเสนอราคา' : 'สร้างใบเสนอราคา'}
          </button>
        </div>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">ประวัติสถานะ</div>
        <ul className="job-history-list">
          {(job.history || []).map((h, i) => (
            <li key={i}>
              <span className={`status-badge ${jobStatusDef(h.status).badge}`}>{jobStatusDef(h.status).label}</span>
              <span className="job-history-time">{formatDbDateTime(h.changed_at)}</span>
              <span className="job-history-by">{h.full_name || h.username || '-'}</span>
            </li>
          ))}
        </ul>
      </div>

      {showSchedule && (
        <div className="modal-backdrop" onClick={() => setShowSchedule(false)}>
          <div className="modal-card" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">นัดวันมาทำ</h3>
            <div className="modal-form">
              <label>วันที่นัด</label>
              <input type="date" value={scheduleDate} min={todayStr()} onChange={(e) => setScheduleDate(e.target.value)} />
              {error && <p className="error-text">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-primary" disabled={busy} onClick={handleSchedule}>
                  {busy ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button type="button" onClick={() => setShowSchedule(false)} disabled={busy}>ยกเลิก</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDecline && job.quotation_id && (
        <DeclineReasonModal
          quotation={{ quotation_no: job.quotation_no, customer_name: job.customer_name }}
          loading={busy}
          onConfirm={handleDeclineConfirm}
          onCancel={() => setShowDecline(false)}
        />
      )}

      {showPrintModal && job.quotation_id && (
        <QuotationPrintModal
          quotation={{ id: job.quotation_id }}
          onClose={() => { setShowPrintModal(false); load({ silent: true }); }}
        />
      )}
    </div>
  );
}
