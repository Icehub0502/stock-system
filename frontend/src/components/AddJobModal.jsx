import React, { useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { todayStr } from '../utils/format';
import { formatDateTh } from '../utils/dateGroups';
import { resizePhotos, describePhotoFailures, IMAGE_ACCEPT } from '../utils/resizeImage';
import { THAI_PROVINCES } from '../utils/thaiProvinces';

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
 *
 * เพิ่มได้ทีละหลายคัน (ปุ่ม "+ เพิ่มอีกคัน") — แต่ละคันมีฟอร์มของตัวเอง กดบันทึกครั้งเดียว
 * สร้างคิวทุกคันต่อเนื่องกัน ลูกค้าคนเดียวกัน (ชื่อ+เบอร์ตรงกัน) ใช้ลูกค้ารายเดียว ไม่สร้างซ้ำ
 */
// prefill: ใช้ตอนกด "สร้างคิว" จากใบเสนอราคาเดิมในหน้านัดหมาย (ลูกค้ามัดจำ/นัดวันไว้
// แล้ว วันนัดถึงแล้วมาทำจริง) — เติมข้อมูลลูกค้า/รถ/อาการจากใบเดิมให้ทันที ไม่ต้อง
// พิมพ์ใหม่ ยังแก้ไขได้ทุกช่องเหมือนโหมดปกติ ทะเบียนที่เติมมาตรงกับ vehicles ที่โหลด
// มาอยู่แล้ว (เป็นรถเดิม) ดังนั้น matchedVehicle ด้านล่างจะ resolve เจอเองตามปกติ
// โดยไม่ต้องเขียน branch แยก — quotation_id ต้องส่งต่อไปกับ POST /jobs ด้วยเพื่อผูก
// งานใหม่เข้ากับใบเสนอราคาเดิมตั้งแต่ตอนสร้าง (กันสร้างใบเสนอราคาซ้ำซ้อน)
// โหมด prefill เป็นคันเดียวเสมอ (ผูกกับใบเสนอราคาใบเดียว) จึงไม่มีปุ่มเพิ่มอีกคัน

let carKeySeq = 0;
function newCar(overrides = {}) {
  carKeySeq += 1;
  return {
    key: carKeySeq,
    plate: '', province: '', customerName: '', phone: '', brand: '', model: '', color: '',
    year: '', mileage: '', symptom: '', photos: [], photosBusy: false,
    // ใบเสนอราคาเดิมที่ค้างของรถคันนี้ (ทุกใบ) + id ใบที่พนักงานเลือกดึงเข้าคิว
    openQuotations: [], pullInId: null,
    ...overrides,
  };
}

// จับคู่รถจากทะเบียน + จังหวัด: ทะเบียนซ้ำกันได้ถ้าคนละจังหวัด
//   - กรอกจังหวัด → ต้องตรงจังหวัด หรือรถเดิมยังไม่เคยระบุจังหวัด (ถือว่าตรงทุกจังหวัดจนกว่าจะกรอก)
//   - ไม่กรอกจังหวัด → จับคู่ได้เมื่อมีรถทะเบียนนี้คันเดียวเท่านั้น (หลายคันต้องระบุจังหวัด)
function plateCandidates(vehicles, plate) {
  const upper = plate.trim().toUpperCase();
  return upper ? vehicles.filter((v) => (v.license_plate || '').trim().toUpperCase() === upper) : [];
}
function findVehicle(vehicles, plate, province) {
  const candidates = plateCandidates(vehicles, plate);
  const prov = (province || '').trim();
  if (prov) {
    return candidates.find((v) => (v.province || '').trim() === prov)
      || candidates.find((v) => !(v.province || '').trim())
      || null;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

// ฟอร์มของรถหนึ่งคัน (controlled — state อยู่ที่ AddJobModal) มี effect ค้นข้อมูลรถเดิม/ใบเสนอราคาค้างของตัวเอง
function CarForm({
  car, index, total, vehicles, brands, prefill, onChange, onRemove,
  queueNo, onQueueNoChange, setError,
}) {
  const [models, setModels] = useState([]);
  const matchedVehicle = useMemo(() => findVehicle(vehicles, car.plate, car.province), [vehicles, car.plate, car.province]);
  const plateAmbiguous = !car.province.trim() && plateCandidates(vehicles, car.plate).length > 1;

  useEffect(() => {
    if (!car.brand.trim()) { setModels([]); return; }
    client.get('/vehicle-models/models', { params: { brand: car.brand.trim() } }).then((res) => setModels(res.data.data || []));
  }, [car.brand]);

  // เจอทะเบียนเดิม — เติมข้อมูลลูกค้า/รถให้อัตโนมัติเหมือนเดิม (พนักงานยังแก้ต่อ
  // ได้ทุกช่อง เผื่อเปลี่ยนเบอร์/สี ฯลฯ) ไม่ทับค่าที่พิมพ์เองไปแล้วถ้าทะเบียนไม่ตรง
  useEffect(() => {
    if (!matchedVehicle) return;
    onChange({
      customerName: matchedVehicle.customer_name || '',
      brand: matchedVehicle.brand || '',
      model: matchedVehicle.model || '',
      color: matchedVehicle.color || '',
      year: matchedVehicle.year ? String(matchedVehicle.year) : '',
      ...(car.province.trim() ? {} : { province: matchedVehicle.province || '' }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedVehicle]);

  // ใบเสนอราคาเดิมที่ยังเปิดอยู่ของรถคันนี้ (ไม่จำกัดวันที่ ต่างจากการจับคู่อัตโนมัติ
  // ตอนบันทึกที่จำกัดแค่วันเดียวกัน) — เจอทะเบียนแล้วเช็คว่ามีใบค้างไว้ไหม (เช่นคุยไว้
  // ทางไลน์เมื่อวาน มีรายการ/มัดจำอยู่แล้ว) ให้พนักงานเลือกดึงเข้ามาผูกกับคิววันนี้ได้
  // เอง แทนที่จะพึ่งการจับคู่อัตโนมัติ/พิมพ์ไลน์ซ้ำ (เคยเจอปัญหาไลน์ทับรายการเดิมมาแล้ว)
  useEffect(() => {
    onChange({ openQuotations: [], pullInId: null });
    if (!matchedVehicle) return;
    client.get(`/vehicles/${matchedVehicle.id}/open-quotations`)
      .then((res) => onChange({ openQuotations: res.data.data || [] }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedVehicle?.id]);

  // อัปโหลดกี่รูปก็ได้ — ทั้งถ่ายจากกล้อง (input capture="environment") และเลือก
  // จากคลังรูปมือถือ (input ธรรมดา) มาต่อท้ายรายการเดียวกัน ย่อขนาดก่อนเก็บใน
  // state เสมอ (utils/resizeImage.js) กันการ์ดหน่วงตอน preview รูปเยอะ ๆ
  async function handleFilesSelected(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    onChange({ photosBusy: true });
    try {
      // รูปรถตอนรับเข้า — ลูกค้าเปิดดูและเซฟรูปเองได้จากหน้าประวัติ (/track) ใช้ขนาด/
      // คุณภาพสูงกว่าค่าเริ่มต้นของฟังก์ชัน (ซึ่งตั้งไว้สำหรับรูปการ์ดอะไหล่เล็ก ๆ)
      // กันรูปแตกตอนลูกค้าเซฟไปดูจริง — เก็บรูปย่อเล็กจริง ๆ คู่กันไปด้วย (thumb) ให้
      // GET /jobs ใช้โชว์บนการ์ดรายการงานวันนี้แทนรูปเต็ม 1280px (เดิมโหลดหนักทั้งวัน)
      const { photos: resized, failed } = await resizePhotos(files);
      if (resized.length > 0) onChange({ photos: [...car.photos, ...resized] });
      if (failed.length > 0) setError(describePhotoFailures(failed));
    } catch {
      setError('เพิ่มรูปไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      onChange({ photosBusy: false });
    }
  }

  function removePhoto(idx) {
    onChange({ photos: car.photos.filter((_, i) => i !== idx) });
  }

  // สลับตำแหน่งรูป — เลขที่โชว์บนรูปคือลำดับ (รูปที่ 1 คือรูปปกที่จะโชว์บนการ์ด
  // หน้ารายการงานวันนี้ ดู photo_thumb ที่ GET /jobs)
  function movePhoto(idx, dir) {
    const target = idx + dir;
    if (target < 0 || target >= car.photos.length) return;
    const next = [...car.photos];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange({ photos: next });
  }

  const idp = `ajm-${car.key}`;
  return (
    <section className="ajm-car">
      {total > 1 && (
        <div className="ajm-car-head">
          <strong>คันที่ {index + 1}</strong>
          {onRemove && (
            <button type="button" className="ajm-car-remove" onClick={onRemove}>✕ เอาคันนี้ออก</button>
          )}
        </div>
      )}

      {index === 0 && prefill && (
        <p style={{ margin: '0 0 12px', color: '#15803d', fontSize: 13 }}>
          ✅ เติมข้อมูลจากใบเสนอราคา {prefill.quotation_no} ให้แล้ว แก้ไขได้ตามจริง
        </p>
      )}

      {!prefill && car.openQuotations.length > 0 && (
        <div className="ajm-quote-pick">
          <p className="ajm-quote-pick-title">
            📋 รถคันนี้มีใบเสนอราคาเดิมค้างอยู่ {car.openQuotations.length} ใบ — เลือกใบที่จะดึงเข้าคิวนี้ (รายการเดิมจะติดมาด้วย ไม่ต้องพิมพ์ใหม่)
          </p>
          {car.openQuotations.map((q) => (
            <label key={q.id} className={`ajm-quote-option${car.pullInId === q.id ? ' is-on' : ''}`}>
              <input
                type="radio" name={`pull-${car.key}`} checked={car.pullInId === q.id}
                onChange={() => onChange({
                  pullInId: q.id,
                  ...(!car.symptom.trim() && q.symptom ? { symptom: q.symptom } : {}),
                })}
              />
              <span>
                <strong>{q.quotation_no}</strong> · {formatDateTh(q.quotation_date)} · ฿{Number(q.total_amount).toLocaleString('th-TH')}
                {q.deposit_amount > 0 && ` (มัดจำ ฿${Number(q.deposit_amount).toLocaleString('th-TH')})`}
                {q.status === 'declined' && <em className="ajm-quote-tag"> ลูกค้าไม่ได้ทำ</em>}
                {q.status === 'scheduled' && <em className="ajm-quote-tag"> นัดหมายแล้ว</em>}
                {q.product_summary && <small>{q.product_summary}</small>}
              </span>
            </label>
          ))}
          <label className={`ajm-quote-option${car.pullInId === null ? ' is-on' : ''}`}>
            <input
              type="radio" name={`pull-${car.key}`} checked={car.pullInId === null}
              onChange={() => onChange({ pullInId: null })}
            />
            <span>ไม่ดึงใบเดิม (เริ่มคิวใหม่เปล่า ๆ)</span>
          </label>
        </div>
      )}

      <label>ทะเบียนรถ</label>
      <div className="ajm-plate-row">
        <input
          type="text" placeholder="เช่น กข1234" value={car.plate}
          onChange={(e) => onChange({ plate: e.target.value })} autoFocus={index === 0}
        />
        <input
          type="text" placeholder="จังหวัด" list={`${idp}-provinces`} value={car.province}
          onChange={(e) => onChange({ province: e.target.value })}
        />
      </div>
      <datalist id={`${idp}-provinces`}>
        {THAI_PROVINCES.map((p) => <option key={p} value={p} />)}
      </datalist>
      {matchedVehicle && (
        <p style={{ margin: '4px 0 8px', color: '#15803d', fontSize: 13 }}>✅ พบรถเดิม — เติมข้อมูลให้แล้ว แก้ไขได้ตามจริง</p>
      )}
      {plateAmbiguous && (
        <p style={{ margin: '4px 0 8px', color: '#b45309', fontSize: 13 }}>
          ⚠️ มีรถทะเบียนนี้หลายคัน (คนละจังหวัด) — เลือกจังหวัดเพื่อให้ระบบหารถเดิมให้
        </p>
      )}

      <label>ชื่อลูกค้า</label>
      <input type="text" value={car.customerName} onChange={(e) => onChange({ customerName: e.target.value })} />

      <label>เบอร์โทรศัพท์</label>
      <input type="text" value={car.phone} onChange={(e) => onChange({ phone: e.target.value })} />

      <label>ยี่ห้อรถ</label>
      <input
        type="text" list={`${idp}-brands`} value={car.brand}
        onChange={(e) => onChange({ brand: e.target.value, model: '' })}
      />
      <datalist id={`${idp}-brands`}>
        {brands.map((b) => <option key={b} value={b} />)}
      </datalist>

      <label>รุ่นรถ</label>
      <input type="text" list={`${idp}-models`} value={car.model} onChange={(e) => onChange({ model: e.target.value })} />
      <datalist id={`${idp}-models`}>
        {models.map((m) => <option key={m.model} value={m.model} />)}
      </datalist>

      <label>สีรถ</label>
      <input type="text" value={car.color} onChange={(e) => onChange({ color: e.target.value })} />

      <label>ปีรถ (ไม่บังคับ — ใส่ไว้ช่วยจับคู่อะไหล่ตามรุ่นให้แม่นขึ้น)</label>
      <input type="number" min="1990" max="2100" placeholder="เช่น 2015" value={car.year} onChange={(e) => onChange({ year: e.target.value })} />

      <label>เลขไมล์</label>
      <input type="number" min="0" value={car.mileage} onChange={(e) => onChange({ mileage: e.target.value })} />

      {index === 0 ? (
        <>
          <label>เลขคิว</label>
          <input type="text" value={queueNo} onChange={(e) => onQueueNoChange(e.target.value)} />
        </>
      ) : (
        <p className="ajm-queue-auto">เลขคิวของคันนี้ระบบจะรันต่อจากคันก่อนหน้าให้อัตโนมัติ</p>
      )}

      <label>อาการ</label>
      <textarea rows={3} value={car.symptom} onChange={(e) => onChange({ symptom: e.target.value })} />

      <label>รูปรถ</label>
      <div className="job-photo-picker">
        {car.photos.map((photo, idx) => (
          <div className="job-photo-thumb" key={idx}>
            <span className="job-photo-num">{idx + 1}</span>
            <img src={photo.full} alt="" />
            <div className="job-photo-thumb-actions">
              <button type="button" onClick={() => movePhoto(idx, -1)} disabled={idx === 0}>◀</button>
              <button type="button" onClick={() => removePhoto(idx)}>✕</button>
              <button type="button" onClick={() => movePhoto(idx, 1)} disabled={idx === car.photos.length - 1}>▶</button>
            </div>
          </div>
        ))}
      </div>
      <div className="job-photo-add-row">
        <label className="btn job-photo-add-btn">
          📷 ถ่ายรูป
          <input type="file" accept={IMAGE_ACCEPT} capture="environment" multiple hidden onChange={handleFilesSelected} />
        </label>
        <label className="btn job-photo-add-btn">
          🖼️ เลือกรูป
          <input type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={handleFilesSelected} />
        </label>
        {car.photosBusy && <span style={{ fontSize: 13, color: '#6b7280' }}>กำลังย่อรูป...</span>}
      </div>
    </section>
  );
}

export default function AddJobModal({ onClose, onCreated, prefill = null }) {
  const [vehicles, setVehicles] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [queueNo, setQueueNo] = useState('');
  const [cars, setCars] = useState(() => [newCar({
    plate: prefill?.license_plate || '',
    province: prefill?.province || '',
    customerName: prefill?.customer_name || '',
    phone: prefill?.phone || '',
    brand: prefill?.brand || '',
    model: prefill?.model || '',
    color: prefill?.color || '',
    year: prefill?.year ? String(prefill.year) : '',
    mileage: prefill?.mileage ? String(prefill.mileage) : '',
    symptom: prefill?.symptom || '',
  })]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // id งานแรกที่สร้างสำเร็จแล้วในรอบที่บางคันผิดพลาด — ปิดฟอร์มแล้วต้องรีเฟรชรายการด้วย
  const [partialJobId, setPartialJobId] = useState(null);

  useEffect(() => {
    client.get('/vehicles').then((res) => setVehicles(res.data.data || [])).finally(() => setLoadingVehicles(false));
    client.get('/vehicle-models/brands').then((res) => setBrands(res.data.data || []));
    client.get('/jobs/next-queue-no').then((res) => setQueueNo(res.data.queue_no || ''));
  }, []);

  const updateCar = (key, patch) => {
    setCars((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  };

  // คันถัดไปเติมชื่อ/เบอร์ลูกค้าจากคันก่อนหน้าให้ (เจ้าของมักพามาหลายคัน) แก้ได้ทุกช่อง
  const addCar = () => {
    setCars((prev) => {
      const last = prev[prev.length - 1];
      return [...prev, newCar({ customerName: last.customerName, phone: last.phone })];
    });
  };

  const removeCar = (key) => setCars((prev) => prev.filter((c) => c.key !== key));

  // สร้างลูกค้า/รถ (ถ้ายังไม่มี) แล้วสร้างคิวของรถหนึ่งคัน — คืน id ของงานที่สร้าง
  // customerCache: ลูกค้าที่สร้างไปแล้วในรอบเดียวกัน (ชื่อ+เบอร์ตรงกัน) ใช้ซ้ำ ไม่สร้างลูกค้าซ้ำ
  async function createOneJob(car, isFirst, customerCache) {
    const plateUpper = car.plate.trim().toUpperCase();
    const province = car.province.trim();
    const matchedVehicle = findVehicle(vehicles, car.plate, car.province);
    // ยังไม่มี matchedVehicle (เช่น /vehicles ยังโหลดไม่เสร็จตอนกดบันทึกเร็วมาก)
    // แต่ทะเบียนยังตรงกับที่ prefill มา — ใช้ id จาก prefill ไปก่อนได้เลย เพราะเป็น
    // รถ/ลูกค้าเดิมของใบเสนอราคานั้นอยู่แล้วแน่นอน
    const prefillStillMatches = isFirst && prefill && plateUpper === (prefill.license_plate || '').trim().toUpperCase();
    let vehicleId = matchedVehicle?.id || (prefillStillMatches ? prefill.vehicle_id : undefined);
    let customerId = matchedVehicle?.customer_id || (prefillStillMatches ? prefill.customer_id : undefined);
    const hadVehicle = !!vehicleId;
    const name = car.customerName.trim();
    const phone = car.phone.trim();

    if (!vehicleId) {
      const cacheKey = `${name}|${phone}`;
      if (customerCache.has(cacheKey)) {
        customerId = customerCache.get(cacheKey);
      } else {
        const custRes = await client.post('/customers', { customer_name: name, phone });
        customerId = custRes.data.data.id;
        customerCache.set(cacheKey, customerId);
      }

      // ยี่ห้อ/รุ่นที่พิมพ์มาไม่มีในแคตตาล็อก — เพิ่มเข้าไปเลย (ไม่บล็อกถ้าพลาด
      // ยังสร้างรถ/รับเข้าคิวต่อได้ปกติ แค่ครั้งหน้าจะไม่เด้งเป็นตัวเลือกให้)
      const brand = car.brand.trim();
      const model = car.model.trim();
      const brandKnown = brands.includes(brand);
      let modelKnown = false;
      if (brandKnown) {
        const res = await client.get('/vehicle-models/models', { params: { brand } }).catch(() => null);
        modelKnown = !!res?.data?.data?.some((m) => m.model === model);
      }
      if (!brandKnown || !modelKnown) {
        await client.post('/vehicle-models', { brand, model }).catch(() => {});
      }

      const vehRes = await client.post('/vehicles', {
        customer_id: customerId, brand, model,
        color: car.color.trim(), license_plate: plateUpper, province, mileage: Number(car.mileage) || 0,
        year: Number(car.year) || null,
      });
      vehicleId = vehRes.data.data.id;
    } else if (matchedVehicle && province && !(matchedVehicle.province || '').trim()) {
      // รถเดิมยังไม่เคยระบุจังหวัด — บันทึกจังหวัดที่กรอกครั้งนี้ลงรถคันเดิมให้ (ใช้ค่าเดิมของรถทุกช่อง)
      await client.put(`/vehicles/${matchedVehicle.id}`, {
        brand: matchedVehicle.brand, model: matchedVehicle.model, color: matchedVehicle.color,
        license_plate: matchedVehicle.license_plate, mileage: matchedVehicle.mileage, year: matchedVehicle.year,
        province,
      }).catch(() => {});
    }
    if (hadVehicle && name !== (matchedVehicle?.customer_name ?? prefill?.customer_name)) {
      // แก้ชื่อลูกค้าตรงนี้ก่อนบันทึก (พิมพ์ทับค่าที่เติมมาให้อัตโนมัติ) — อัปเดต
      // ลูกค้าเดิมไปด้วยเลย กันข้อมูลไม่ตรงกันระหว่างตารางลูกค้ากับที่กรอกจริง
      await client.put(`/customers/${customerId}`, { customer_name: name, phone }).catch(() => {});
    }

    const res = await client.post('/jobs', {
      vehicle_id: vehicleId,
      customer_id: customerId,
      // คันแรกใช้เลขคิวที่เห็นในฟอร์ม คันถัดไปไม่ส่ง — เซิร์ฟเวอร์รันเลขถัดไปที่ว่างให้เอง
      queue_no: isFirst ? queueNo : undefined,
      mileage_in: Number(car.mileage) || null,
      symptom: car.symptom.trim(),
      photos: car.photos,
      quotation_id: car.pullInId || (isFirst ? prefill?.quotation_id || null : null),
    });
    return res.data.id;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    // ตรวจทุกคันก่อนสร้างจริง — ผิดคันไหนแจ้งเลขคันนั้นและยังไม่สร้างอะไรเลย
    const seenPlates = new Set();
    for (let i = 0; i < cars.length; i += 1) {
      const c = cars[i];
      const label = cars.length > 1 ? `คันที่ ${i + 1}: ` : '';
      const plate = `${c.plate.trim().toUpperCase()}|${c.province.trim()}`;
      if (!c.customerName.trim()) return setError(`${label}กรุณากรอกชื่อลูกค้า`);
      if (!c.plate.trim()) return setError(`${label}กรุณากรอกทะเบียนรถ`);
      if (seenPlates.has(plate)) return setError(`${label}ทะเบียน ${c.plate.trim().toUpperCase()} ซ้ำกับคันก่อนหน้าในรอบนี้`);
      seenPlates.add(plate);
      if (!c.brand.trim() || !c.model.trim()) return setError(`${label}กรุณากรอกยี่ห้อและรุ่นรถ`);
    }

    setSubmitting(true);
    const customerCache = new Map();
    const createdKeys = [];
    let firstJobId = null;
    try {
      for (let i = 0; i < cars.length; i += 1) {
        const jobId = await createOneJob(cars[i], i === 0, customerCache);
        if (firstJobId === null) firstJobId = jobId;
        createdKeys.push(cars[i].key);
      }
      onCreated(firstJobId);
    } catch (err) {
      const msg = err.response?.data?.error || 'เพิ่มคิวไม่สำเร็จ';
      if (createdKeys.length > 0) {
        // เอาคันที่สร้างสำเร็จแล้วออกจากฟอร์ม กันกดบันทึกซ้ำแล้วได้คิวซ้ำ
        setCars((prev) => prev.filter((c) => !createdKeys.includes(c.key)));
        setError(`สร้างคิวสำเร็จแล้ว ${createdKeys.length} คัน แต่คันถัดไปผิดพลาด: ${msg} (คันที่สร้างแล้วถูกเอาออกจากฟอร์มแล้ว แก้แล้วกดบันทึกอีกครั้ง)`);
        setPartialJobId(firstJobId);
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const multi = cars.length > 1;
  // ปิดฟอร์มหลังสร้างได้บางคันแล้ว → ใช้ onCreated เพื่อรีเฟรชรายการงาน (ซึ่งปิดฟอร์มให้ด้วย)
  const handleClose = () => (partialJobId !== null ? onCreated(partialJobId) : onClose());
  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div className="modal-card" style={{ maxWidth: multi ? 560 : 480 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{prefill ? '+ สร้างคิวจากใบเสนอราคาเดิม' : '+ เพิ่มคิวรับรถ'}</h3>
        <p style={{ marginBottom: 12, color: '#6b7280', fontSize: 14 }}>
          {multi ? `${cars.length} คัน — ` : ''}คิว {queueNo || '-'}{multi ? ' เป็นต้นไป' : ''} — {formatDateTh(todayStr())}
        </p>

        <form onSubmit={handleSubmit} className="modal-form">
          {cars.map((car, idx) => (
            <CarForm
              key={car.key}
              car={car}
              index={idx}
              total={cars.length}
              vehicles={vehicles}
              brands={brands}
              prefill={prefill}
              onChange={(patch) => updateCar(car.key, patch)}
              onRemove={cars.length > 1 ? () => removeCar(car.key) : null}
              queueNo={queueNo}
              onQueueNoChange={setQueueNo}
              setError={setError}
            />
          ))}

          {!prefill && (
            <button type="button" className="ajm-add-car" onClick={addCar} disabled={submitting}>
              + เพิ่มอีกคัน
            </button>
          )}

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button type="submit" className="btn-primary" disabled={submitting || loadingVehicles}>
              {submitting ? 'กำลังบันทึก...' : (multi ? `เพิ่มคิว ${cars.length} คัน` : 'เพิ่มคิว')}
            </button>
            <button type="button" onClick={handleClose} disabled={submitting}>{partialJobId !== null ? "ปิด" : "ยกเลิก"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
