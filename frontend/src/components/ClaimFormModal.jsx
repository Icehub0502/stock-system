import React, { useRef, useState } from 'react';
import client from '../api/client';
import ClaimCaseForm from './ClaimCaseForm';

// ฟอร์มเคส (มาแก้งาน/เคลมอะไหล่) — เลือกลูกค้า+รถที่มีอยู่แล้วในระบบ (รถที่เคยซ่อมมาก่อน
// ไม่ใช่รถใหม่ จึงไม่มีโหมด "เพิ่มลูกค้า/รถใหม่" แบบ AddJobModal.jsx) แล้วกรอกรายละเอียดเคส
// (ClaimCaseForm.jsx) — 2 ขั้นตอนในโมดัลเดียว มิเรอร์ step state ของ RepairNoticePage.jsx
// (ค้นหารถ → กรอกรายละเอียด) แต่เป็น modal ไม่ใช่หน้าเต็ม
//
// claim: null = สร้างใหม่, object = แก้ไขเคลมเดิม (มาจาก GET /claims/:id)
export default function ClaimFormModal({ claim, onClose, onSaved }) {
  const isEdit = Boolean(claim?.id);
  const [step, setStep] = useState(isEdit ? 'details' : 'vehicle');

  const [vehicleQuery, setVehicleQuery] = useState('');
  const [vehicleResults, setVehicleResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef(null);

  const [selectedVehicle, setSelectedVehicle] = useState(
    isEdit
      ? {
          vehicle_id: claim.vehicle_id,
          customer_id: claim.customer_id,
          brand: claim.brand,
          model: claim.model,
          color: claim.color,
          license_plate: claim.license_plate,
          customer_name: claim.customer_name,
          phone: claim.phone,
        }
      : null
  );

  const handleVehicleQueryChange = (value) => {
    setVehicleQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) {
      setVehicleResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await client.get('/claims/vehicle-search', { params: { search: value } });
        setVehicleResults(res.data.data || []);
      } catch (err) {
        console.error('Error searching vehicles:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const pickVehicle = (v) => {
    setSelectedVehicle(v);
    setStep('details');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? `แก้ไขเคส ${claim.claim_no}` : 'เปิดเคสใหม่'}</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        {step === 'vehicle' ? (
          <div className="modal-form">
            <p className="subtitle">ค้นหารถของลูกค้าที่กลับมา (ทะเบียนรถ, ชื่อลูกค้า, หรือเบอร์โทร)</p>
            <input
              autoFocus
              type="text"
              className="search-input"
              value={vehicleQuery}
              onChange={(e) => handleVehicleQueryChange(e.target.value)}
              placeholder="พิมพ์ทะเบียนรถ, ชื่อลูกค้า, หรือเบอร์โทร"
            />
            {searching && <p className="loading">กำลังค้นหา...</p>}
            <div className="jdp-selected-list" style={{ marginTop: 12 }}>
              {vehicleResults.map((v) => (
                <button
                  key={v.vehicle_id}
                  type="button"
                  className="jdp-selected-row"
                  style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => pickVehicle(v)}
                >
                  <span className="jdp-selected-name">
                    {v.license_plate || '-'} · {v.brand} {v.model} {v.color ? `· ${v.color}` : ''}
                    <br />
                    {v.customer_name} {v.phone ? `· ${v.phone}` : ''}
                  </span>
                </button>
              ))}
              {!searching && vehicleQuery && vehicleResults.length === 0 && (
                <p className="empty-message">ไม่พบรถที่ตรงกับคำค้นหา</p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="info-card" style={{ marginBottom: 12 }}>
              <div className="info-card-title">
                {selectedVehicle.license_plate || '-'} · {selectedVehicle.brand} {selectedVehicle.model}
                {selectedVehicle.color ? ` · ${selectedVehicle.color}` : ''}
              </div>
              <div>{selectedVehicle.customer_name} {selectedVehicle.phone ? `· ${selectedVehicle.phone}` : ''}</div>
              {!isEdit && (
                <button type="button" onClick={() => setStep('vehicle')} style={{ marginTop: 8 }}>เปลี่ยนรถ</button>
              )}
            </div>
            <ClaimCaseForm claim={claim} vehicle={selectedVehicle} onSaved={onSaved} onCancel={onClose} />
          </>
        )}
      </div>
    </div>
  );
}
