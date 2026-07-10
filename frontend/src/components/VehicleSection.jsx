import React from 'react';
import CarBrandAutocomplete from './CarBrandAutocomplete';

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
          <div className="form-group">
            <label>ยี่ห้อ</label>
            <CarBrandAutocomplete
              value={newVehicle.brand}
              onChange={(val) => onNewVehicleFieldChange('brand', val)}
              placeholder="Honda"
            />
          </div>
          <div className="form-group">
            <label>รุ่น</label>
            <input
              type="text"
              value={newVehicle.model}
              onChange={(e) => onNewVehicleFieldChange('model', e.target.value)}
              placeholder="Accord"
            />
          </div>
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
