import React, { useState } from 'react';
import axios from 'axios';
import StatusTrack from '../components/StatusTrack';
import { jobStatusDef } from '../utils/jobStatus';
import { formatDbDateTime } from '../utils/format';
import { formatDateTh } from '../utils/dateGroups';

// axios ตรง ๆ ไม่ผ่าน ../api/client — client.js แนบ Bearer token จาก localStorage
// ให้ทุก request และ redirect ไป /login ทันทีที่เจอ 401/ไม่มี token เลย ซึ่งพังกับ
// หน้านี้ที่ตั้งใจให้เปิดแบบสาธารณะ ไม่มีใครล็อกอิน (มาจาก QR/พิมพ์เอง — ดู
// BoardPage.jsx ที่ใช้รูปแบบเดียวกัน)
const trackClient = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

/**
 * หน้าติดตามสถานะรถ — สาธารณะ ไม่ต้องล็อกอิน (ลูกค้าสแกน QR ที่พนักงานพิมพ์/โชว์ให้
 * หรือพิมพ์ URL เอง) พิสูจน์ตัวตนด้วยทะเบียนรถ + เบอร์โทร 4 ตัวท้าย ก่อนเห็นข้อมูล
 * (ดู track.routes.js ฝั่ง backend ที่ตัดราคา/ชื่อช่าง/หมายเหตุภายในออกตั้งแต่ระดับ
 * SQL แล้ว หน้านี้แค่แสดงสิ่งที่ backend ส่งมาตรง ๆ)
 */
export default function TrackPage() {
  const params = new URLSearchParams(window.location.search);
  const [plate, setPlate] = useState(params.get('plate') || '');
  const [phoneLast4, setPhoneLast4] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!plate.trim()) return setError('กรุณากรอกทะเบียนรถ');
    if (!/^\d{4}$/.test(phoneLast4.trim())) return setError('กรุณากรอกเบอร์โทร 4 ตัวท้ายให้ถูกต้อง');

    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await trackClient.get('/track', { params: { plate: plate.trim(), phone_last4: phoneLast4.trim() } });
      setResult(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'ค้นหาข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="track-page">
      <header className="track-header">
        <span className="navbar-brand-text">
          <span className="brand-champ">Champ</span>
          <span className="brand-power">power</span>
        </span>
        <p>ติดตามสถานะรถของคุณ</p>
      </header>

      <form className="track-form" onSubmit={handleSubmit}>
        <label>ทะเบียนรถ</label>
        <input type="text" placeholder="เช่น กข1234" value={plate} onChange={(e) => setPlate(e.target.value)} autoFocus />

        <label>เบอร์โทร 4 ตัวท้าย</label>
        <input
          type="tel" inputMode="numeric" maxLength={4} placeholder="เช่น 1234"
          value={phoneLast4}
          onChange={(e) => setPhoneLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
        />

        {error && <p className="error-text">{error}</p>}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'กำลังค้นหา...' : 'ค้นหา'}
        </button>
      </form>

      {result && (
        <div className="track-result">
          <div className="track-vehicle-card">
            <div className="track-vehicle-plate">{result.vehicle.license_plate}</div>
            <div className="track-vehicle-model">
              {result.vehicle.brand} {result.vehicle.model} {result.vehicle.color && `· ${result.vehicle.color}`}
            </div>
            <div className="track-vehicle-customer">{result.customer_name}</div>
          </div>

          <div className="track-status-block">
            <StatusTrack status={result.job.status} />
            <div className={`status-badge ${jobStatusDef(result.job.status).badge} track-status-badge`}>
              {result.job.status_label}
            </div>
            {result.job.symptom && <p className="track-symptom">อาการที่แจ้ง: {result.job.symptom}</p>}
          </div>

          {result.deposit && (
            <div className="track-deposit">
              💰 มัดจำแล้ว ฿{Number(result.deposit.amount).toLocaleString('th-TH')}
              {result.deposit.date && ` เมื่อวันที่ ${formatDateTh(result.deposit.date)}`}
            </div>
          )}

          {result.items.length > 0 && (
            <div className="track-section">
              <h3>รายการที่ทำ</h3>
              <ul className="track-item-list">
                {result.items.map((it, idx) => (
                  <li key={idx}>{it.product_name} {it.quantity > 1 && `x${it.quantity}`}</li>
                ))}
              </ul>
            </div>
          )}

          {result.photos.intake.length > 0 && (
            <div className="track-section">
              <h3>รูปรถตอนรับเข้า</h3>
              <div className="track-photo-grid">
                {result.photos.intake.map((src, idx) => <img key={idx} src={src} alt="" />)}
              </div>
            </div>
          )}

          {result.photos.part.length > 0 && (
            <div className="track-section">
              <h3>รูปอะไหล่ของใหม่</h3>
              <div className="track-photo-grid">
                {result.photos.part.map((src, idx) => <img key={idx} src={src} alt="" />)}
              </div>
            </div>
          )}

          <div className="track-section">
            <h3>ประวัติสถานะ</h3>
            <ul className="job-history-list">
              {result.status_history.map((h, idx) => (
                <li key={idx}>
                  <span className={`status-badge ${jobStatusDef(h.status).badge}`}>{h.status_label}</span>
                  <span className="job-history-time">{formatDbDateTime(h.changed_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
