import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { WORK_BAYS } from '../utils/workBays';

const DEFAULT_COMPLAINTS = [
  'มีเสียงดังช่วงล่าง', 'พวงมาลัยสั่น', 'เบรกมีเสียง', 'แร็คมีน้ำมันรั่ว',
  'ยางสึกไม่เท่ากัน', 'รถดึงข้าง', 'ตั้งศูนย์/ถ่วงล้อ',
];

/**
 * หน้ารับรถเข้าคิว — ค้นทะเบียนก่อน ถ้าเจอรถเดิมดึงลูกค้า/รถมาให้อัตโนมัติ ถ้าไม่
 * เจอให้กรอกลูกค้า+รถใหม่ในหน้าเดียวกันเลย (ไม่สลับหน้า) แล้วรับเข้าคิวพร้อมช่องยก
 * ในขั้นตอนเดียว — ไม่ได้สร้างใบเสนอราคาที่นี่ (เจ้าของร้านสั่ง: ตรวจเช็คเสร็จก่อน
 * ค่อยเสนอราคา ทำที่หน้ารายละเอียดงานแทน)
 */
export default function CheckInPage() {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);

  const [plate, setPlate] = useState('');
  const [queueNo, setQueueNo] = useState('');
  const [queueTouched, setQueueTouched] = useState(false);
  const [mileage, setMileage] = useState('');
  const [bay, setBay] = useState('');
  const [checked, setChecked] = useState([]);
  const [customSymptom, setCustomSymptom] = useState('');
  const [note, setNote] = useState('');

  // ฟอร์มลูกค้า/รถใหม่ — โผล่เฉพาะตอนหาทะเบียนไม่เจอ
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/vehicles').then((res) => setVehicles(res.data.data || [])).finally(() => setLoadingVehicles(false));
    client.get('/vehicle-models/brands').then((res) => setBrands(res.data.data || []));
  }, []);

  useEffect(() => {
    if (!brand) { setModels([]); setModel(''); return; }
    client.get('/vehicle-models/models', { params: { brand } }).then((res) => setModels(res.data.data || []));
  }, [brand]);

  // เติมเลขคิวถัดไปให้อัตโนมัติทันทีที่หน้าโหลดเสร็จ — แก้เองได้ (เหมือน
  // genQueueNo ของ ChamppowerD) หยุดเสนอค่าใหม่ทันทีที่พนักงานแตะช่องนี้เอง
  useEffect(() => {
    if (queueTouched) return;
    client.get('/jobs/next-queue-no').then((res) => setQueueNo(res.data.queue_no || ''));
  }, [queueTouched]);

  const plateUpper = plate.trim().toUpperCase();
  const matchedVehicle = useMemo(
    () => plateUpper ? vehicles.find((v) => (v.license_plate || '').trim().toUpperCase() === plateUpper) : null,
    [vehicles, plateUpper]
  );
  const isNewVehicle = plateUpper.length > 0 && !matchedVehicle && !loadingVehicles;

  function toggleComplaint(text) {
    setChecked((prev) => (prev.includes(text) ? prev.filter((t) => t !== text) : [...prev, text]));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!plateUpper) return setError('กรุณากรอกทะเบียนรถ');
    if (!mileage.trim()) return setError('กรุณากรอกเลขไมล์');
    if (isNewVehicle && (!customerName.trim() || !brand || !model)) {
      return setError('กรุณากรอกชื่อลูกค้า ยี่ห้อ และรุ่นรถให้ครบ');
    }

    setSubmitting(true);
    try {
      let vehicleId = matchedVehicle?.id;
      let customerId = matchedVehicle?.customer_id;

      if (isNewVehicle) {
        const custRes = await client.post('/customers', { customer_name: customerName.trim(), phone: customerPhone.trim() });
        customerId = custRes.data.data.id;
        const vehRes = await client.post('/vehicles', {
          customer_id: customerId, brand, model, color: color.trim(),
          license_plate: plateUpper, mileage: Number(mileage) || 0,
        });
        vehicleId = vehRes.data.data.id;
      }

      const symptomParts = [...checked];
      if (customSymptom.trim()) symptomParts.push(customSymptom.trim());

      const res = await client.post('/jobs', {
        vehicle_id: vehicleId,
        customer_id: customerId,
        queue_no: queueNo,
        mileage_in: Number(mileage) || null,
        symptom: symptomParts.join(', '),
        note,
        bay: bay || null,
      });

      navigate(`/jobs/${res.data.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'รับรถเข้าคิวไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="office-dashboard container">
      <div className="dashboard-header">
        <h2>รับรถเข้าคิว <span className="dashboard-header-sub">— ระบบคิวรับรถ</span></h2>
      </div>

      <form onSubmit={handleSubmit} className="modal-form" style={{ maxWidth: 640 }}>
        <label>ทะเบียนรถ</label>
        <input
          type="text"
          placeholder="เช่น กข1234"
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
          autoFocus
        />

        {matchedVehicle && (
          <p style={{ color: '#15803d', fontSize: 14, margin: '4px 0 8px' }}>
            ✅ พบรถเดิม: {matchedVehicle.brand} {matchedVehicle.model} — {matchedVehicle.customer_name || 'ไม่ทราบชื่อลูกค้า'}
          </p>
        )}

        {isNewVehicle && (
          <>
            <p style={{ color: '#92400e', fontSize: 14, margin: '4px 0 8px' }}>⚠️ ไม่พบทะเบียนนี้ในระบบ — กรอกข้อมูลลูกค้า/รถใหม่</p>

            <label>ชื่อลูกค้า</label>
            <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />

            <label>เบอร์โทร</label>
            <input type="text" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />

            <label>ยี่ห้อรถ</label>
            <select value={brand} onChange={(e) => { setBrand(e.target.value); setModel(''); }}>
              <option value="">-- เลือกยี่ห้อ --</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>

            {brand && (
              <>
                <label>รุ่นรถ</label>
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">-- เลือกรุ่น --</option>
                  {models.map((m) => <option key={m.model} value={m.model}>{m.label}</option>)}
                </select>
              </>
            )}

            <label>สีรถ</label>
            <input type="text" value={color} onChange={(e) => setColor(e.target.value)} />
          </>
        )}

        <label>เลขคิว</label>
        <input
          type="text"
          value={queueNo}
          onChange={(e) => { setQueueNo(e.target.value); setQueueTouched(true); }}
        />

        <label>เลขไมล์</label>
        <input type="number" min="0" value={mileage} onChange={(e) => setMileage(e.target.value)} />

        <label>ช่องยก (เลือกได้ทีหลังก็ได้)</label>
        <select value={bay} onChange={(e) => setBay(e.target.value)}>
          <option value="">-- ยังไม่เข้าช่อง --</option>
          {WORK_BAYS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>

        <label>อาการที่ลูกค้าแจ้ง</label>
        <div className="checkbox-grid">
          {DEFAULT_COMPLAINTS.map((c) => (
            <label key={c} className="checkbox-chip">
              <input type="checkbox" checked={checked.includes(c)} onChange={() => toggleComplaint(c)} />
              {c}
            </label>
          ))}
        </div>
        <input
          type="text"
          placeholder="อาการอื่น ๆ (พิมพ์เพิ่มได้)"
          value={customSymptom}
          onChange={(e) => setCustomSymptom(e.target.value)}
        />

        <label>หมายเหตุ</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />

        {error && <p className="error-text">{error}</p>}

        <div className="modal-actions">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'กำลังบันทึก...' : 'รับรถเข้าคิว'}
          </button>
        </div>
      </form>
    </div>
  );
}
