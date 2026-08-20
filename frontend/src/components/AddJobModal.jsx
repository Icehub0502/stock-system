import React, { useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { todayStr } from '../utils/format';
import { formatDateTh } from '../utils/dateGroups';
import { resizeImageToDataUrl } from '../utils/resizeImage';

// ยี่ห้อ/รุ่นรถ: พิมพ์แล้วมีตัวเลือกจากฐานข้อมูลเด้งขึ้นมาให้กด (เช่นพิมพ์ "To" แล้ว
// เห็น "Toyota") แต่ยังพิมพ์ค่าที่ไม่มีในระบบได้อยู่ (รถรุ่นใหม่) — ใช้ <datalist>
// ของ HTML ตรง ๆ แทนที่จะเขียน dropdown เอง เพราะพฤติกรรม "พิมพ์กรองได้ + เลือกได้
// + พิมพ์อิสระได้" ตรงกับที่ขอเป๊ะ และเบราว์เซอร์รองรับเองอยู่แล้วทั้งมือถือ/เดสก์ท็อป

/**
 * ฟอร์มเพิ่มคิวรับรถ — เปิดเป็น modal จากปุ่ม "+" ลอยที่หน้ารายการงานวันนี้
 * (JobBoardPage.jsx) แทนที่การเป็นหน้าแยก /checkin เดิม ให้กรอกข้อมูลลูกค้า/รถ
 * ครบในหน้าเดียวตามตัวอย่างที่เจ้าของร้านให้มา (คิว/วันที่/ชื่อ/เบอร์/ยี่ห้อ/รุ่น/
 * ทะเบียน/สี/เลขไมล์/อาการ) ยี่ห้อ-รุ่นที่พิมพ์ใหม่ (ไม่มีในแคตตาล็อก) จะถูกเพิ่ม
 * เข้า vehicle_models ให้อัตโนมัติตอนบันทึก เพื่อให้ครั้งหน้าเด้งเป็นตัวเลือกได้เลย
 */
export default function AddJobModal({ onClose, onCreated }) {
  const [vehicles, setVehicles] = useState([]);
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);

  const [queueNo, setQueueNo] = useState('');
  const [plate, setPlate] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [mileage, setMileage] = useState('');
  const [symptom, setSymptom] = useState('');
  const [photos, setPhotos] = useState([]);
  const [photosBusy, setPhotosBusy] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/vehicles').then((res) => setVehicles(res.data.data || [])).finally(() => setLoadingVehicles(false));
    client.get('/vehicle-models/brands').then((res) => setBrands(res.data.data || []));
    client.get('/jobs/next-queue-no').then((res) => setQueueNo(res.data.queue_no || ''));
  }, []);

  useEffect(() => {
    if (!brand.trim()) { setModels([]); return; }
    client.get('/vehicle-models/models', { params: { brand: brand.trim() } }).then((res) => setModels(res.data.data || []));
  }, [brand]);

  const plateUpper = plate.trim().toUpperCase();
  const matchedVehicle = useMemo(
    () => plateUpper ? vehicles.find((v) => (v.license_plate || '').trim().toUpperCase() === plateUpper) : null,
    [vehicles, plateUpper]
  );

  // เจอทะเบียนเดิม — เติมข้อมูลลูกค้า/รถให้อัตโนมัติเหมือนเดิม (พนักงานยังแก้ต่อ
  // ได้ทุกช่อง เผื่อเปลี่ยนเบอร์/สี ฯลฯ) ไม่ทับค่าที่พิมพ์เองไปแล้วถ้าทะเบียนไม่ตรง
  useEffect(() => {
    if (!matchedVehicle) return;
    setCustomerName(matchedVehicle.customer_name || '');
    setBrand(matchedVehicle.brand || '');
    setModel(matchedVehicle.model || '');
    setColor(matchedVehicle.color || '');
  }, [matchedVehicle]);

  // อัปโหลดกี่รูปก็ได้ — ทั้งถ่ายจากกล้อง (input capture="environment") และเลือก
  // จากคลังรูปมือถือ (input ธรรมดา) มาต่อท้ายรายการเดียวกัน ย่อขนาดก่อนเก็บใน
  // state เสมอ (utils/resizeImage.js) กันการ์ดหน่วงตอน preview รูปเยอะ ๆ
  async function handleFilesSelected(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setPhotosBusy(true);
    try {
      const resized = await Promise.all(files.map((f) => resizeImageToDataUrl(f)));
      setPhotos((prev) => [...prev, ...resized]);
    } catch {
      setError('เพิ่มรูปไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setPhotosBusy(false);
    }
  }

  function removePhoto(idx) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  // สลับตำแหน่งรูป — เลขที่โชว์บนรูปคือลำดับ (รูปที่ 1 คือรูปปกที่จะโชว์บนการ์ด
  // หน้ารายการงานวันนี้ ดู photo_thumb ที่ GET /jobs)
  function movePhoto(idx, dir) {
    setPhotos((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!customerName.trim()) return setError('กรุณากรอกชื่อลูกค้า');
    if (!plateUpper) return setError('กรุณากรอกทะเบียนรถ');
    if (!brand.trim() || !model.trim()) return setError('กรุณากรอกยี่ห้อและรุ่นรถ');

    setSubmitting(true);
    try {
      let vehicleId = matchedVehicle?.id;
      let customerId = matchedVehicle?.customer_id;

      if (!vehicleId) {
        const custRes = await client.post('/customers', { customer_name: customerName.trim(), phone: customerPhone.trim() });
        customerId = custRes.data.data.id;

        // ยี่ห้อ/รุ่นที่พิมพ์มาไม่มีในแคตตาล็อก — เพิ่มเข้าไปเลย (ไม่บล็อกถ้าพลาด
        // ยังสร้างรถ/รับเข้าคิวต่อได้ปกติ แค่ครั้งหน้าจะไม่เด้งเป็นตัวเลือกให้)
        const brandKnown = brands.includes(brand.trim());
        const modelKnown = models.some((m) => m.model === model.trim());
        if (!brandKnown || !modelKnown) {
          await client.post('/vehicle-models', { brand: brand.trim(), model: model.trim() }).catch(() => {});
        }

        const vehRes = await client.post('/vehicles', {
          customer_id: customerId, brand: brand.trim(), model: model.trim(),
          color: color.trim(), license_plate: plateUpper, mileage: Number(mileage) || 0,
        });
        vehicleId = vehRes.data.data.id;
      } else if (customerName.trim() !== matchedVehicle.customer_name) {
        // แก้ชื่อลูกค้าตรงนี้ก่อนบันทึก (พิมพ์ทับค่าที่เติมมาให้อัตโนมัติ) — อัปเดต
        // ลูกค้าเดิมไปด้วยเลย กันข้อมูลไม่ตรงกันระหว่างตารางลูกค้ากับที่กรอกจริง
        await client.put(`/customers/${customerId}`, { customer_name: customerName.trim(), phone: customerPhone.trim() }).catch(() => {});
      }

      const res = await client.post('/jobs', {
        vehicle_id: vehicleId,
        customer_id: customerId,
        queue_no: queueNo,
        mileage_in: Number(mileage) || null,
        symptom: symptom.trim(),
        photos,
      });

      onCreated(res.data.id);
    } catch (err) {
      setError(err.response?.data?.error || 'เพิ่มคิวไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">+ เพิ่มคิวรับรถ</h3>
        <p style={{ marginBottom: 12, color: '#6b7280', fontSize: 14 }}>
          คิว {queueNo || '-'} — {formatDateTh(todayStr())}
        </p>

        <form onSubmit={handleSubmit} className="modal-form">
          <label>ทะเบียนรถ</label>
          <input type="text" placeholder="เช่น กข1234" value={plate} onChange={(e) => setPlate(e.target.value)} autoFocus />
          {matchedVehicle && (
            <p style={{ margin: '4px 0 8px', color: '#15803d', fontSize: 13 }}>✅ พบรถเดิม — เติมข้อมูลให้แล้ว แก้ไขได้ตามจริง</p>
          )}

          <label>ชื่อลูกค้า</label>
          <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />

          <label>เบอร์โทรศัพท์</label>
          <input type="text" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />

          <label>ยี่ห้อรถ</label>
          <input
            type="text" list="ajm-brand-options" value={brand}
            onChange={(e) => { setBrand(e.target.value); setModel(''); }}
          />
          <datalist id="ajm-brand-options">
            {brands.map((b) => <option key={b} value={b} />)}
          </datalist>

          <label>รุ่นรถ</label>
          <input type="text" list="ajm-model-options" value={model} onChange={(e) => setModel(e.target.value)} />
          <datalist id="ajm-model-options">
            {models.map((m) => <option key={m.model} value={m.model} />)}
          </datalist>

          <label>สีรถ</label>
          <input type="text" value={color} onChange={(e) => setColor(e.target.value)} />

          <label>เลขไมล์</label>
          <input type="number" min="0" value={mileage} onChange={(e) => setMileage(e.target.value)} />

          <label>เลขคิว</label>
          <input type="text" value={queueNo} onChange={(e) => setQueueNo(e.target.value)} />

          <label>อาการ</label>
          <textarea rows={3} value={symptom} onChange={(e) => setSymptom(e.target.value)} />

          <label>รูปรถ</label>
          <div className="job-photo-picker">
            {photos.map((src, idx) => (
              <div className="job-photo-thumb" key={idx}>
                <span className="job-photo-num">{idx + 1}</span>
                <img src={src} alt="" />
                <div className="job-photo-thumb-actions">
                  <button type="button" onClick={() => movePhoto(idx, -1)} disabled={idx === 0}>◀</button>
                  <button type="button" onClick={() => removePhoto(idx)}>✕</button>
                  <button type="button" onClick={() => movePhoto(idx, 1)} disabled={idx === photos.length - 1}>▶</button>
                </div>
              </div>
            ))}
          </div>
          <div className="job-photo-add-row">
            <label className="btn job-photo-add-btn">
              📷 ถ่ายรูป
              <input type="file" accept="image/*" capture="environment" multiple hidden onChange={handleFilesSelected} />
            </label>
            <label className="btn job-photo-add-btn">
              🖼️ เลือกรูป
              <input type="file" accept="image/*" multiple hidden onChange={handleFilesSelected} />
            </label>
            {photosBusy && <span style={{ fontSize: 13, color: '#6b7280' }}>กำลังย่อรูป...</span>}
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button type="submit" className="btn-primary" disabled={submitting || loadingVehicles}>
              {submitting ? 'กำลังบันทึก...' : 'เพิ่มคิว'}
            </button>
            <button type="button" onClick={onClose} disabled={submitting}>ยกเลิก</button>
          </div>
        </form>
      </div>
    </div>
  );
}
