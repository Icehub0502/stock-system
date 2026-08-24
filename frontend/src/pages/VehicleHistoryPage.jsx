import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import client from '../api/client';
import VisitTimeline from '../components/VisitTimeline';

/**
 * ประวัติการเข้ารับบริการของรถคันหนึ่ง — ดู backend/src/utils/visitHistory.js
 * เข้าถึงจากปุ่ม "ดูประวัติ" ใน VehicleManagementPage.jsx หรือลิงก์รถจาก
 * CustomerHistoryPage.jsx
 */
export default function VehicleHistoryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    client.get(`/vehicles/${id}/history`)
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.response?.data?.error || 'โหลดประวัติไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="quotation-page"><div className="loading">กำลังโหลด...</div></div>;
  if (error || !data) return <div className="quotation-page"><div className="error-message">{error || 'ไม่พบข้อมูล'}</div></div>;

  const { vehicle, visits } = data;

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>{vehicle.license_plate || '-'}</h1>
          <p className="subtitle">
            {vehicle.brand} {vehicle.model} {vehicle.color && `· ${vehicle.color}`} · เลขไมล์ล่าสุด {Number(vehicle.mileage || 0).toLocaleString('th-TH')}
          </p>
          <p className="subtitle">
            เจ้าของ: <Link to={`/customers/${vehicle.customer_id}/history`}>{vehicle.customer_name} ({vehicle.customer_code})</Link>
          </p>
        </div>
        <button type="button" onClick={() => navigate('/vehicles')}>← กลับรายการรถ</button>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">ประวัติการเข้ารับบริการ ({visits.length} ครั้ง)</div>
        <VisitTimeline visits={visits} />
      </div>
    </div>
  );
}
