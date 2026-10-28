import React, { useEffect, useState } from 'react';
import client from '../api/client';
import ComboInput from './ComboInput';

// Brand → model (with its years, "Vios ปี '07-13") searched from the vehicle book, typing a new one is allowed
function BrandModelFields({ newVehicle, onFieldChange }) {
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  useEffect(() => {
    client.get('/vehicle-models/brands').then((res) => setBrands(res.data.data || [])).catch(() => setBrands([]));
  }, []);
  const known = brands.find((b) => b.toLowerCase() === newVehicle.brand.trim().toLowerCase()) || '';
  useEffect(() => {
    if (!known) { setModels([]); return; }
    client.get('/vehicle-models/models', { params: { brand: known } })
      .then((res) => setModels((res.data.data || []).map((m) => ({ value: m.display_name, pending: m.pending }))))
      .catch(() => setModels([]));
  }, [known]);

  const changeBrand = (value) => {
    onFieldChange('brand', value);
    if (value.trim().toLowerCase() !== newVehicle.brand.trim().toLowerCase()) onFieldChange('model', '');
  };

  return (
    <>
      <div className="form-group">
        <label>ยี่ห้อ</label>
        <ComboInput value={newVehicle.brand} options={brands.map((b) => ({ value: b }))} placeholder="พิมพ์ค้นหายี่ห้อ" onChange={changeBrand} />
      </div>
      <div className="form-group">
        <label>รุ่น (ปี)</label>
        <ComboInput
          value={newVehicle.model}
          options={models}
          disabled={!newVehicle.brand.trim()}
          placeholder={newVehicle.brand.trim() ? 'พิมพ์ค้นหารุ่น เช่น vios 07' : 'เลือกยี่ห้อก่อน'}
          onChange={(value) => onFieldChange('model', value)}
        />
      </div>
    </>
  );
}

export default function VehicleSection({
  vehicles,
  vehicleMode,
  vehicleId,
  newVehicle,
  mileage,
  fieldErrors,
  onVehicleSelect,
  onVehicleModeChange,
  onNewVehicleFieldChange,
  onMileageChange,
}) {
  return (
    <div className="info-card">
      <div className="info-card-title">ข้อมูลรถ</div>
      <div className="info-card-grid">
        <div className="form-group receipt-vehicle-group">
          <label>เลือกรถ</label>
          {vehicles.length > 0 ? (
            <select
              value={vehicleMode === 'new' ? 'new' : vehicleId}
              onChange={(e) => onVehicleSelect(e.target.value)}
            >
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.brand} {vehicle.model} / {vehicle.license_plate || '-'}
                </option>
              ))}
              <option value="new">+ เพิ่มรถใหม่</option>
            </select>
          ) : (
            <div className="no-data-note">ลูกค้านี้ยังไม่มีรถ กรุณากรอกข้อมูลรถ</div>
          )}
          {fieldErrors.vehicle_id && <div className="field-error">{fieldErrors.vehicle_id}</div>}
        </div>
        <div className="form-group">
          <label>เลขไมล์</label>
          <input type="number" min="0" value={mileage} onChange={(e) => onMileageChange(e.target.value)} />
        </div>
      </div>
      <div className="customer-mode-toggle two-column info-card-toggle">
        <label>
          <input
            type="radio"
            name="vehicleMode"
            value="existing"
            checked={vehicleMode === 'existing'}
            onChange={() => onVehicleModeChange('existing')}
          />
          รถเก่า
        </label>
        <label>
          <input
            type="radio"
            name="vehicleMode"
            value="new"
            checked={vehicleMode === 'new'}
            onChange={() => onVehicleModeChange('new')}
          />
          รถใหม่
        </label>
      </div>
      {(vehicleMode === 'new' || vehicles.length === 0) && (
        <div className="form-row vehicle-new-grid">
          <BrandModelFields newVehicle={newVehicle} onFieldChange={onNewVehicleFieldChange} />
          <div className="form-group">
            <label>สี</label>
            <input
              type="text"
              value={newVehicle.color}
              onChange={(e) => onNewVehicleFieldChange('color', e.target.value)}
              placeholder="เทา"
            />
          </div>
          <div className="form-group">
            <label>ทะเบียน</label>
            <input
              type="text"
              value={newVehicle.license_plate}
              onChange={(e) => onNewVehicleFieldChange('license_plate', e.target.value)}
              placeholder="กข1234"
            />
            {fieldErrors.vehicle && <div className="field-error">{fieldErrors.vehicle}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
