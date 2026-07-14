import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import client from '../api/client';
import { defaultChecklist, normalizeChecklist, SUSPENSION_LABELS } from '../utils/repairChecklist';
import RepairNoticePrintModal from '../components/RepairNoticePrintModal';
import '../styles/repairNotice.css';

import rackImg from '../image/repair-parts/rack.png';
import wishboneImg from '../image/repair-parts/wishbone.png';
import tieRodEndImg from '../image/repair-parts/tie_rod_end.png';
import swayBarLinkImg from '../image/repair-parts/sway_bar_link.png';
import swayBarBushingImg from '../image/repair-parts/sway_bar_bushing.png';
import wheelBearingImg from '../image/repair-parts/wheel_bearing.png';
import driveShaftImg from '../image/repair-parts/drive_shaft.png';
import shockImg from '../image/repair-parts/shock.png';
import equipmentImg from '../image/repair-parts/equipment.png';
import brakePadImg from '../image/repair-parts/brake_pad.png';
import brakeDiscImg from '../image/repair-parts/brake_disc.png';
import workerImg from '../image/repair-parts/worker.png';

const SUSPENSION_IMG = {
  wing: wishboneImg,
  tie_rod_end: tieRodEndImg,
  sway_bar_link: swayBarLinkImg,
  sway_bar_bushing: swayBarBushingImg,
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

// ── Photo + label + checkbox; a note field slides in once ticked ──
function CheckItem({ img, label, checked, note, onToggle, onNote }) {
  return (
    <>
      <button type="button" className={`rnf2-item ${checked ? 'on' : ''}`} onClick={onToggle}>
        {img && <img className="rnf2-thumb" src={img} alt="" />}
        <span className="rnf2-item-label">{label}</span>
        <span className={`rnf2-check ${checked ? 'on' : ''}`}>{checked ? '✓' : ''}</span>
      </button>
      {checked && onNote && (
        <input
          className="rnf2-note"
          value={note || ''}
          onChange={(e) => onNote(e.target.value)}
          placeholder="ระบุยี่ห้อ/รายละเอียด (ถ้ามี)"
        />
      )}
    </>
  );
}

function Chip({ label, on, onToggle }) {
  return (
    <button type="button" className={`rnf2-chip ${on ? 'on' : ''}`} onClick={onToggle}>
      <span className={`rnf2-check-sm ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>
      {label}
    </button>
  );
}

function Card({ number, title, hero, children }) {
  return (
    <div className="rnf2-card">
      <div className="rnf2-card-head">
        <span className="rnf2-num">{number}</span>
        <span className="rnf2-card-title">{title}</span>
        {hero && <img className="rnf2-card-hero" src={hero} alt="" />}
      </div>
      <div className="rnf2-card-body">{children}</div>
    </div>
  );
}

export default function RepairNoticePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isEdit = Boolean(id);
  const prefill = location.state || {};

  const [step, setStep] = useState(prefill.vehicleId ? 'checklist' : 'vehicle');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showPrint, setShowPrint] = useState(false);

  const [vehicleQuery, setVehicleQuery] = useState('');
  const [vehicleResults, setVehicleResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef(null);

  const [selectedVehicle, setSelectedVehicle] = useState(
    prefill.vehicleId
      ? {
          vehicle_id: prefill.vehicleId,
          customer_id: prefill.customerId,
          brand: prefill.brand,
          model: prefill.model,
          color: prefill.color,
          license_plate: prefill.licensePlate,
          customer_name: prefill.customerName,
        }
      : null
  );

  const [code, setCode] = useState('');
  const [noticeDate, setNoticeDate] = useState(todayStr());
  const [checklist, setChecklist] = useState(defaultChecklist());
  const [checkedBy, setCheckedBy] = useState('');
  const [repairedBy, setRepairedBy] = useState('');

  useEffect(() => {
    if (isEdit) {
      loadNotice(id);
    } else {
      fetchNextCode();
    }
  }, [id]);

  const fetchNextCode = async () => {
    try {
      const res = await client.get('/repair-notices/next-code');
      setCode(res.data.code || '');
    } catch (err) {
      console.error('Error fetching next code:', err);
    }
  };

  const loadNotice = async (noticeId) => {
    setLoading(true);
    try {
      const res = await client.get(`/repair-notices/${noticeId}`);
      const data = res.data.data;
      setCode(data.code);
      setNoticeDate(data.notice_date ? data.notice_date.slice(0, 10) : todayStr());
      setChecklist(normalizeChecklist(typeof data.checklist === 'string' ? JSON.parse(data.checklist) : data.checklist));
      setCheckedBy(data.checked_by || '');
      setRepairedBy(data.repaired_by || '');
      setSelectedVehicle({
        vehicle_id: data.vehicle_id,
        customer_id: data.customer_id,
        brand: data.brand,
        model: data.model,
        color: data.color,
        license_plate: data.license_plate,
        customer_name: data.customer_name,
      });
      setStep('checklist');
    } catch (err) {
      console.error('Error loading repair notice:', err);
      setError('โหลดใบแจ้งซ่อมไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

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
        const res = await client.get('/repair-notices/vehicle-search', { params: { search: value } });
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
    setStep('checklist');
  };

  const toggleSimple = (path) => {
    setChecklist((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let cur = next;
      for (let i = 0; i < keys.length - 1; i += 1) cur = cur[keys[i]];
      const lastKey = keys[keys.length - 1];
      cur[lastKey] = !cur[lastKey];
      return next;
    });
  };

  const toggleChecked = (path) => toggleSimple(`${path}.checked`);
  const setNote = (path, value) => {
    setChecklist((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let cur = next;
      for (let i = 0; i < keys.length - 1; i += 1) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedVehicle?.vehicle_id) {
      setError('กรุณาเลือกรถก่อน');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        customer_id: selectedVehicle.customer_id,
        vehicle_id: selectedVehicle.vehicle_id,
        quotation_id: prefill.quotationId || null,
        notice_date: noticeDate,
        checklist,
        checked_by: checkedBy.trim() || null,
        repaired_by: repairedBy.trim() || null,
      };
      if (isEdit) {
        await client.put(`/repair-notices/${id}`, payload);
        navigate('/repair-notices', { state: { toast: 'บันทึกการแก้ไขสำเร็จ' } });
      } else {
        const res = await client.post('/repair-notices', payload);
        setToast('บันทึกใบแจ้งซ่อมสำเร็จ');
        navigate(`/repair-notices/${res.data.id}`, { replace: true });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="rnf2-page"><div className="rnf2-body">กำลังโหลด...</div></div>;
  }

  // ── STEP: pick a vehicle ──
  if (step === 'vehicle') {
    return (
      <div className="rnf2-page">
        <div className="rnf2-search">
          <h2 className="rnf2-h1">ใบแจ้งซ่อม / รายการซ่อม</h2>
          <p className="rnf2-hsub">ค้นหารถของลูกค้าเพื่อเริ่มรายการตรวจเช็ค</p>

          <input
            autoFocus
            type="text"
            className="rnf2-input"
            value={vehicleQuery}
            onChange={(e) => handleVehicleQueryChange(e.target.value)}
            placeholder="พิมพ์ทะเบียนรถ, ชื่อลูกค้า, หรือเบอร์โทร"
          />

          {searching && <p className="rnf2-hint">กำลังค้นหา...</p>}

          <div>
            {vehicleResults.map((v) => (
              <button key={v.vehicle_id} type="button" className="rnf2-vcard" onClick={() => pickVehicle(v)}>
                <div className="rnf2-vplate">{v.license_plate || '-'}</div>
                <div className="rnf2-vmeta">{v.brand} {v.model} {v.color ? `· ${v.color}` : ''}</div>
                <div className="rnf2-vcust">{v.customer_name} {v.phone ? `· ${v.phone}` : ''}</div>
              </button>
            ))}
            {!searching && vehicleQuery && vehicleResults.length === 0 && (
              <p className="rnf2-hint">ไม่พบรถที่ตรงกับคำค้นหา</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // reusable: a front/rear (or L/R) axle chip group
  const AxleChips = (rows) => (
    <>
      {rows.map(({ axle, cells }) => (
        <div key={axle}>
          <div className="rnf2-axle">{axle}</div>
          <div className="rnf2-chips">
            {cells.map(({ label, path }) => (
              <Chip key={path} label={label} on={getPath(checklist, path)} onToggle={() => toggleSimple(path)} />
            ))}
          </div>
        </div>
      ))}
    </>
  );

  // ── STEP: checklist ──
  return (
    <div className="rnf2-page">
      <div className="rnf2-topbar">
        <div>
          <p className="rnf2-topbar-title">ใบแจ้งซ่อม {code || ''}</p>
          <p className="rnf2-topbar-sub">
            {selectedVehicle?.license_plate || '-'} · {selectedVehicle?.brand} {selectedVehicle?.model}
            {selectedVehicle?.customer_name ? ` · ${selectedVehicle.customer_name}` : ''}
          </p>
        </div>
        <div className="rnf2-topbar-actions">
          {isEdit && (
            <button type="button" className="rnf2-tbtn rnf2-tbtn-print" onClick={() => setShowPrint(true)}>🖨️ พิมพ์</button>
          )}
          {!prefill.vehicleId && !isEdit && (
            <button type="button" className="rnf2-tbtn rnf2-tbtn-ghost" onClick={() => setStep('vehicle')}>เปลี่ยนรถ</button>
          )}
        </div>
      </div>

      <div className="rnf2-body">
        {error && <div className="rnf2-err">{error}</div>}

        <div className="rnf2-grid">
          <Card number="1" title="แร็คพวงมาลัย / Rack" hero={rackImg}>
            <CheckItem
              img={rackImg}
              label="แร็คพวงมาลัย"
              checked={checklist.rack.checked}
              note={checklist.rack.note}
              onToggle={() => toggleChecked('rack')}
              onNote={(v) => setNote('rack.note', v)}
            />
          </Card>

          <Card number="2" title="ช่วงล่าง / Suspension">
            {Object.keys(SUSPENSION_LABELS).map((key, i) => (
              <CheckItem
                key={key}
                img={SUSPENSION_IMG[key]}
                label={`2.${i + 1} ${SUSPENSION_LABELS[key]}`}
                checked={checklist.suspension[key].checked}
                note={checklist.suspension[key].note}
                onToggle={() => toggleChecked(`suspension.${key}`)}
                onNote={(v) => setNote(`suspension.${key}.note`, v)}
              />
            ))}
          </Card>

          <Card number="3" title="ลูกปืนล้อ / Wheel Bearing" hero={wheelBearingImg}>
            <div className="rnf2-hero-row"><img className="rnf2-thumb" style={{ width: 100, height: 78 }} src={wheelBearingImg} alt="" /></div>
            {AxleChips([
              { axle: 'หน้า / Front', cells: [{ label: 'L', path: 'wheel_bearing.front_l' }, { label: 'R', path: 'wheel_bearing.front_r' }] },
              { axle: 'หลัง / Rear', cells: [{ label: 'L', path: 'wheel_bearing.rear_l' }, { label: 'R', path: 'wheel_bearing.rear_r' }] },
            ])}
          </Card>

          <Card number="4" title="เพลาขับ / Drive Shaft" hero={driveShaftImg}>
            <div className="rnf2-hero-row"><img className="rnf2-thumb" style={{ width: 120, height: 70 }} src={driveShaftImg} alt="" /></div>
            {AxleChips([
              { axle: 'หน้า / Front', cells: [{ label: 'L', path: 'drive_shaft.front_l' }, { label: 'R', path: 'drive_shaft.front_r' }] },
            ])}
          </Card>

          <Card number="5" title="โช๊ค / Shock" hero={shockImg}>
            <CheckItem
              img={shockImg}
              label="โช๊ค หน้า / Front"
              checked={checklist.shock.front.checked}
              note={checklist.shock.front.note}
              onToggle={() => toggleChecked('shock.front')}
              onNote={(v) => setNote('shock.front.note', v)}
            />
            <CheckItem
              label="โช๊ค หลัง / Rear"
              checked={checklist.shock.rear.checked}
              note={checklist.shock.rear.note}
              onToggle={() => toggleChecked('shock.rear')}
              onNote={(v) => setNote('shock.rear.note', v)}
            />
          </Card>

          <Card number="6" title="อุปกรณ์ / Equipment" hero={equipmentImg}>
            <CheckItem
              img={equipmentImg}
              label="อุปกรณ์"
              checked={checklist.equipment.checked}
              note={checklist.equipment.note}
              onToggle={() => toggleChecked('equipment')}
              onNote={(v) => setNote('equipment.note', v)}
            />
          </Card>

          <Card number="7" title="ผ้าเบรค / Brake Pad" hero={brakePadImg}>
            <div className="rnf2-hero-row"><img className="rnf2-thumb" style={{ width: 100, height: 78 }} src={brakePadImg} alt="" /></div>
            {AxleChips([
              { axle: 'หน้า / Front', cells: [{ label: 'ผ้าเบรคหน้า', path: 'brake_pad.front' }] },
              { axle: 'หลัง / Rear', cells: [{ label: 'ผ้าเบรคหลัง', path: 'brake_pad.rear' }] },
            ])}
          </Card>

          <Card number="8" title="เจียจานเบรค / Brake Disc" hero={brakeDiscImg}>
            <div className="rnf2-hero-row"><img className="rnf2-thumb" style={{ width: 90, height: 78 }} src={brakeDiscImg} alt="" /></div>
            {AxleChips([
              { axle: 'หน้า / Front', cells: [{ label: 'จานหน้า', path: 'brake_disc.front' }] },
              { axle: 'หลัง / Rear', cells: [{ label: 'จานหลัง', path: 'brake_disc.rear' }] },
            ])}
          </Card>

          <Card number="9" title="อื่น ๆ / Other" hero={workerImg}>
            <textarea
              className="rnf2-textarea"
              value={checklist.other}
              onChange={(e) => setNote('other', e.target.value)}
              placeholder="รายละเอียดเพิ่มเติม..."
              rows={3}
            />
          </Card>
        </div>

        <div className="rnf2-footer">
          <div className="rnf2-fgrid">
            <div>
              <label className="rnf2-flabel">วันที่</label>
              <input type="date" className="rnf2-input" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
            </div>
            <div>
              <label className="rnf2-flabel">ตรวจเช็คโดย</label>
              <input type="text" className="rnf2-input" value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} placeholder="ชื่อผู้ตรวจเช็ค" />
            </div>
            <div>
              <label className="rnf2-flabel">ซ่อมโดย</label>
              <input type="text" className="rnf2-input" value={repairedBy} onChange={(e) => setRepairedBy(e.target.value)} placeholder="ชื่อช่างผู้ซ่อม" />
            </div>
          </div>
        </div>
      </div>

      <div className="rnf2-savebar">
        <button type="button" className="rnf2-savebtn" onClick={handleSave} disabled={saving}>
          {saving ? 'กำลังบันทึก...' : isEdit ? 'บันทึกการแก้ไข' : 'บันทึกใบแจ้งซ่อม'}
        </button>
      </div>

      {toast && <div className="rnf2-toast">{toast}</div>}
      {showPrint && <RepairNoticePrintModal noticeId={id} onClose={() => setShowPrint(false)} />}
    </div>
  );
}
