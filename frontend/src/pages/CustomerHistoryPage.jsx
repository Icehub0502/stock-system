import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import client from '../api/client';
import VisitTimeline from '../components/VisitTimeline';

/**
 * ประวัติการเข้ารับบริการของลูกค้าคนหนึ่ง — รวมทุกรถ ทุกครั้ง (ดู
 * backend/src/utils/visitHistory.js) เข้าถึงจากปุ่ม "ดูประวัติ" ใน
 * CustomerManagementPage.jsx
 */
export default function CustomerHistoryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    client.get(`/customers/${id}/history`)
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.response?.data?.error || 'โหลดประวัติไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="quotation-page"><div className="loading">กำลังโหลด...</div></div>;
  if (error || !data) return <div className="quotation-page"><div className="error-message">{error || 'ไม่พบข้อมูล'}</div></div>;

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>{data.customer.customer_name}</h1>
          <p className="subtitle">{data.customer.customer_code} · {data.customer.phone || '-'}</p>
        </div>
        <button type="button" onClick={() => navigate('/customers')}>← กลับรายการลูกค้า</button>
      </div>

      {data.vehicles.length > 0 && (
        <div className="dash-panel">
          <div className="dash-panel-title">รถของลูกค้า ({data.vehicles.length} คัน)</div>
          <div className="history-vehicle-chips">
            {data.vehicles.map((v) => (
              <Link key={v.id} to={`/vehicles/${v.id}/history`} className="history-vehicle-chip">
                {v.license_plate || '-'} · {v.brand} {v.model}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="dash-panel">
        <div className="dash-panel-title">ประวัติการเข้ารับบริการ ({data.visits.length} ครั้ง)</div>
        <VisitTimeline visits={data.visits} />
      </div>
    </div>
  );
}
