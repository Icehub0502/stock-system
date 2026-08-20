import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import client from '../api/client';
import { jobStatusDef, nextMainStatus } from '../utils/jobStatus';
import { WORK_BAYS } from '../utils/workBays';
import { formatDbDateTime, todayStr } from '../utils/format';
import DeclineReasonModal from '../components/DeclineReasonModal';

const emptyItem = () => ({ product_name: '', quantity: 1, unit_price: '' });

/**
 * รายละเอียดงาน 1 คัน — ข้อมูลรถ/ลูกค้า, สถานะ+ช่องยก, รายการอะไหล่/ใบเสนอราคา,
 * และประวัติสถานะ ทุกการกระทำของงานนี้ (เปลี่ยนสถานะ ย้อนสถานะ ผูก/สร้างใบเสนอ
 * ราคา ตัดสินใจอนุมัติ/นัดวัน/ไม่ทำ) รวมมาไว้ที่นี่ที่เดียว — JobBoardPage.jsx
 * เหลือแค่การ์ดภาพรวม+ช่องยกด่วน ไม่มีปุ่มเปลี่ยนสถานะอีกต่อไป
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

  const [quoteQuery, setQuoteQuery] = useState('');
  const [quotes, setQuotes] = useState([]);
  const [linking, setLinking] = useState(false);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [form, setForm] = useState(null);

  const [items, setItems] = useState([emptyItem()]);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(todayStr());
  const [showDecline, setShowDecline] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const res = await client.get(`/jobs/${id}`);
      setJob(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดข้อมูลงานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  // เปิดตัวค้นหาใบเสนอราคาเฉพาะตอนยังไม่มีใบผูกไว้ — โหลดทั้งชุดครั้งเดียวมากรอง
  // ฝั่ง client (แบบเดียวกับหน้าอื่นในระบบ) เลขที่ใบไม่กี่ร้อยใบ ไม่ต้องทำ search API แยก
  useEffect(() => {
    if (job && !job.quotation_id) {
      client.get('/quotations').then((res) => setQuotes(res.data.data || []));
    }
  }, [job?.id, job?.quotation_id]);

  const matchedQuotes = useMemo(() => {
    const term = quoteQuery.trim().toLowerCase();
    if (!term) return [];
    return quotes
      .filter((q) => q.quotation_no?.toLowerCase().includes(term) || q.license_plate?.toLowerCase().includes(term))
      .slice(0, 10);
  }, [quotes, quoteQuery]);

  useEffect(() => {
    if (!form?.brand?.trim()) { setModels([]); return; }
    client.get('/vehicle-models/models', { params: { brand: form.brand.trim() } }).then((res) => setModels(res.data.data || []));
  }, [form?.brand]);

  // สถานะก่อนหน้า (สำหรับปุ่มย้อนกลับ) — ดูจากประวัติจริงของงานนี้ ไม่ใช่ไล่ตาม
  // MAIN_PATH เฉย ๆ เพราะงานอาจแยกไปทาง scheduled/rejected ที่ไม่ได้อยู่บนเส้นทาง
  // หลัก การใช้ประวัติจริงย้อนได้ถูกต้องไม่ว่าจะมาจากทางไหน
  const prevStatus = useMemo(() => {
    const h = job?.history || [];
    return h.length >= 2 ? h[h.length - 2].status : null;
  }, [job?.history]);

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

  async function linkQuotation(quotationId) {
    setLinking(true);
    setError('');
    try {
      await client.patch(`/jobs/${id}/quotation`, { quotation_id: quotationId });
      await load();
      setQuoteQuery('');
    } catch (err) {
      setError(err.response?.data?.error || 'ผูกใบเสนอราคาไม่สำเร็จ');
    } finally {
      setLinking(false);
    }
  }

  async function changeStatus(status) {
    setBusy(true);
    setError('');
    try {
      await client.patch(`/jobs/${id}/status`, { status });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'เปลี่ยนสถานะไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function changeBay(bay) {
    setBusy(true);
    setError('');
    try {
      await client.patch(`/jobs/${id}`, { bay: bay || null });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'เปลี่ยนช่องยกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function addItemRow() {
    setItems((prev) => [...prev, emptyItem()]);
  }
  function removeItemRow(idx) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }
  const itemsTotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);

  // สร้างใบเสนอราคาจากรายการที่กรอกในนี้ตรง ๆ (ใช้ลูกค้า/รถของงานนี้เลย ไม่ต้อง
  // ค้นหาใหม่) แล้วผูกกลับเข้างานทันที — ทำให้เสร็จในหน้าเดียว ไม่ต้องสลับไป
  // /quotations เพื่อสร้างแล้วย้อนกลับมาผูกอีกที
  async function createQuotationFromItems() {
    const validItems = items.filter((it) => it.product_name.trim() && Number(it.quantity) > 0);
    if (validItems.length === 0) {
      setError('กรุณากรอกรายการอะไหล่อย่างน้อย 1 รายการ');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await client.post('/quotations', {
        customer_id: job.customer_id,
        vehicle_id: job.vehicle_id,
        quotation_date: todayStr(),
        mileage: job.mileage_in || 0,
        queue_no: job.queue_no || null,
        symptom: job.symptom || null,
        items: validItems,
      });
      await client.patch(`/jobs/${id}/quotation`, { quotation_id: res.data.quotation_id });
      setItems([emptyItem()]);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'สร้างใบเสนอราคาไม่สำเร็จ');
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

  const st = jobStatusDef(job.status);
  const next = nextMainStatus(job.status);
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
            <p><strong>ทะเบียน:</strong> {job.license_plate || '-'}</p>
            <p><strong>รถ:</strong> {job.brand} {job.model} {job.color && `· ${job.color}`}</p>
            <p><strong>ลูกค้า:</strong> {job.customer_name || '-'} {job.phone && `(${job.phone})`}</p>
            <p><strong>เลขไมล์:</strong> {job.mileage_in ?? '-'}</p>
            <p><strong>อาการที่แจ้ง:</strong> {job.symptom || '-'}</p>
            {job.note && <p><strong>หมายเหตุ:</strong> {job.note}</p>}
          </>
        )}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">สถานะ / ช่องยก</div>
        <p style={{ marginBottom: 10 }}>
          <span className={`status-badge ${st.badge}`}>{st.label}</span>
        </p>

        <div className="form-group" style={{ maxWidth: 220 }}>
          <label>ช่องยก</label>
          <select value={job.bay || ''} disabled={busy} onChange={(e) => changeBay(e.target.value)}>
            <option value="">-</option>
            {WORK_BAYS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="modal-actions" style={{ marginTop: 12 }}>
          {isDecisionPoint ? (
            <>
              <button type="button" className="btn-primary" disabled={busy || !job.quotation_id} onClick={handleApprove}>
                อนุมัติ
              </button>
              <button type="button" disabled={busy || !job.quotation_id} onClick={() => setShowSchedule(true)}>
                นัดวันมาทำ
              </button>
              <button type="button" className="btn-danger" disabled={busy || !job.quotation_id} onClick={() => setShowDecline(true)}>
                ไม่ทำ
              </button>
            </>
          ) : (
            next && (
              <button type="button" className="btn-primary" disabled={busy} onClick={() => changeStatus(next)}>
                → {jobStatusDef(next).label}
              </button>
            )
          )}
          {prevStatus && (
            <button type="button" disabled={busy} onClick={() => changeStatus(prevStatus)}>
              ← ย้อนกลับเป็น {jobStatusDef(prevStatus).label}
            </button>
          )}
        </div>
        {isDecisionPoint && !job.quotation_id && (
          <p style={{ color: '#92400e', fontSize: 13, marginTop: 8 }}>⚠️ เพิ่มรายการอะไหล่แล้วสร้างใบเสนอราคาก่อน ถึงจะตัดสินใจได้</p>
        )}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">ใบเสนอราคา</div>
        {job.quotation_id ? (
          <p>
            เลขที่ <strong>{job.quotation_no}</strong> — สถานะ {job.quotation_status}
            {' '}(<Link to="/quotations">ไปหน้าใบเสนอราคา / พิมพ์</Link>)
          </p>
        ) : (
          <>
            <table className="quotation-table" style={{ marginBottom: 10 }}>
              <thead>
                <tr>
                  <th>รายการอะไหล่</th>
                  <th style={{ width: 80 }}>จำนวน</th>
                  <th style={{ width: 120 }}>ราคา/หน่วย</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td data-label="รายการอะไหล่">
                      <input type="text" value={it.product_name} onChange={(e) => updateItem(idx, { product_name: e.target.value })} />
                    </td>
                    <td data-label="จำนวน">
                      <input type="number" min="1" value={it.quantity} onChange={(e) => updateItem(idx, { quantity: e.target.value })} />
                    </td>
                    <td data-label="ราคา/หน่วย">
                      <input type="number" min="0" value={it.unit_price} onChange={(e) => updateItem(idx, { unit_price: e.target.value })} />
                    </td>
                    <td data-label="">
                      <button type="button" onClick={() => removeItemRow(idx)} disabled={items.length === 1}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <button type="button" onClick={addItemRow}>+ เพิ่มรายการ</button>
              <strong>รวม {itemsTotal.toLocaleString('th-TH')} บาท</strong>
            </div>
            <button type="button" className="btn-primary" disabled={busy} onClick={createQuotationFromItems}>
              {busy ? 'กำลังสร้าง...' : 'สร้างใบเสนอราคา'}
            </button>

            <div style={{ marginTop: 20 }}>
              <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 6 }}>หรือถ้ามีใบเสนอราคาอยู่แล้ว ค้นหามาผูกแทน</p>
              <input
                type="text"
                placeholder="ค้นหาด้วยเลขที่ใบเสนอราคา หรือทะเบียนรถ..."
                value={quoteQuery}
                onChange={(e) => setQuoteQuery(e.target.value)}
              />
              {matchedQuotes.length > 0 && (
                <ul className="job-quote-suggest">
                  {matchedQuotes.map((q) => (
                    <li key={q.id}>
                      <span>{q.quotation_no} — {q.license_plate} {q.brand} {q.model}</span>
                      <button type="button" disabled={linking} onClick={() => linkQuotation(q.id)}>ผูกใบนี้</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
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
    </div>
  );
}
