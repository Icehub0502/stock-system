import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import client from '../api/client';
import { jobStatusDef } from '../utils/jobStatus';
import { formatDbDateTime } from '../utils/format';

/**
 * รายละเอียดงาน 1 คัน — แสดงข้อมูลรถ/ลูกค้า/อาการ, ประวัติสถานะ, และช่องผูกใบ
 * เสนอราคา ไม่ได้สร้างใบเสนอราคาจากในนี้ (เจ้าของร้านสั่ง: ตรวจเช็คเสร็จแล้วค่อย
 * ไปสร้างที่หน้าใบเสนอราคาปกติ — ฟอร์มนั้นมีระบบค้นหาลูกค้า/รถของตัวเองอยู่แล้ว)
 * กลับมาที่นี่แค่ "ผูก" เลขที่ใบที่สร้างไว้แล้วเข้ากับงาน ด้วยการค้นหาเลขที่/ทะเบียน
 */
export default function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [quoteQuery, setQuoteQuery] = useState('');
  const [quotes, setQuotes] = useState([]);
  const [linking, setLinking] = useState(false);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [form, setForm] = useState(null);

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

  if (loading) return <div className="office-dashboard container"><div className="loading">กำลังโหลด...</div></div>;
  if (!job) return <div className="office-dashboard container"><div className="error-message">{error || 'ไม่พบงานนี้'}</div></div>;

  const st = jobStatusDef(job.status);

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
            <p><strong>สถานะปัจจุบัน:</strong> <span className={`status-badge ${st.badge}`}>{st.label}</span></p>
            <p><strong>ช่องยก:</strong> {job.bay || '-'}</p>
          </>
        )}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">ใบเสนอราคา</div>
        {job.quotation_id ? (
          <p>
            เลขที่ <strong>{job.quotation_no}</strong> — สถานะ {job.quotation_status}
            {' '}(<Link to="/quotations">ดูรายการใบเสนอราคา</Link>)
          </p>
        ) : (
          <>
            <p style={{ color: '#92400e', fontSize: 14 }}>⚠️ ยังไม่ได้ผูกใบเสนอราคา — สร้างที่หน้าใบเสนอราคาก่อน แล้วค้นเลขที่มาผูกที่นี่</p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Link to="/quotations" className="btn-primary" style={{ textDecoration: 'none', padding: '8px 16px', borderRadius: 8 }}>
                ไปสร้างใบเสนอราคา
              </Link>
            </div>
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
    </div>
  );
}
