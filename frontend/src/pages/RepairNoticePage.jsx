import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import client from '../api/client';
import { defaultChecklist, normalizeChecklist, SUSPENSION_LABELS } from '../utils/repairChecklist';
import {
  IconRack, IconWishbone, IconTieRodEnd, IconSwayBarLink, IconSwayBarBushing,
  IconWheelBearing, IconDriveShaft, IconShock, IconEquipment,
} from '../components/RepairPartIcons';

const SUSPENSION_ICONS = {
  wing: IconWishbone,
  tie_rod_end: IconTieRodEnd,
  sway_bar_link: IconSwayBarLink,
  sway_bar_bushing: IconSwayBarBushing,
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Checkbox + note row (rack / suspension sub-items / shock / equipment) ──
function CheckNoteRow({ label, checked, note, onToggle, onNoteChange, Icon }) {
  return (
    <div style={styles.checkRow}>
      <button
        type="button"
        style={{ ...styles.checkTap, ...(checked ? styles.checkTapOn : {}) }}
        onClick={onToggle}
      >
        {Icon && (
          <span style={{ ...styles.partIcon, ...(checked ? styles.partIconOn : {}) }}>
            <Icon size={26} />
          </span>
        )}
        <span style={{ ...styles.checkbox, ...(checked ? styles.checkboxOn : {}) }}>
          {checked && '✓'}
        </span>
        <span style={styles.checkLabel}>{label}</span>
      </button>
      {checked && (
        <input
          type="text"
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="ระบุยี่ห้อ/รายละเอียด (ถ้ามี)"
          style={styles.noteInput}
        />
      )}
    </div>
  );
}

// ── Small checkbox chip used for wheel-bearing / drive-shaft grids ──
function ChipCheck({ label, checked, onToggle }) {
  return (
    <button
      type="button"
      style={{ ...styles.chip, ...(checked ? styles.chipOn : {}) }}
      onClick={onToggle}
    >
      <span style={{ ...styles.checkboxSm, ...(checked ? styles.checkboxOn : {}) }}>
        {checked && '✓'}
      </span>
      {label}
    </button>
  );
}

function Section({ number, title, Icon, children }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionNum}>{number}</span>
        <span style={styles.sectionTitle}>{title}</span>
        {Icon && <span style={styles.sectionIcon}><Icon size={26} /></span>}
      </div>
      <div style={styles.sectionBody}>{children}</div>
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
      } else {
        await client.post('/repair-notices', payload);
      }
      setToast('บันทึกใบแจ้งซ่อมสำเร็จ');
      setTimeout(() => navigate('/repair-notices'), 900);
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={styles.page}><div style={styles.container}>กำลังโหลด...</div></div>;
  }

  // ── STEP: pick a vehicle ──
  if (step === 'vehicle') {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <h2 style={styles.pageTitle}>ใบแจ้งซ่อม / รายการซ่อม</h2>
          <p style={styles.pageSub}>ค้นหารถของลูกค้าเพื่อเริ่มรายการตรวจเช็ค</p>

          <input
            autoFocus
            type="text"
            value={vehicleQuery}
            onChange={(e) => handleVehicleQueryChange(e.target.value)}
            placeholder="พิมพ์ทะเบียนรถ, ชื่อลูกค้า, หรือเบอร์โทร"
            style={styles.searchInput}
          />

          {searching && <p style={styles.hint}>กำลังค้นหา...</p>}

          <div style={{ marginTop: 12 }}>
            {vehicleResults.map((v) => (
              <button key={v.vehicle_id} type="button" style={styles.vehicleCard} onClick={() => pickVehicle(v)}>
                <div style={styles.vehiclePlate}>{v.license_plate || '-'}</div>
                <div style={styles.vehicleMeta}>{v.brand} {v.model} {v.color ? `· ${v.color}` : ''}</div>
                <div style={styles.vehicleCustomer}>{v.customer_name} {v.phone ? `· ${v.phone}` : ''}</div>
              </button>
            ))}
            {!searching && vehicleQuery && vehicleResults.length === 0 && (
              <p style={styles.hint}>ไม่พบรถที่ตรงกับคำค้นหา</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── STEP: checklist ──
  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <p style={styles.topBarTitle}>ใบแจ้งซ่อม {code || ''}</p>
          <p style={styles.topBarSub}>
            {selectedVehicle?.license_plate || '-'} · {selectedVehicle?.brand} {selectedVehicle?.model}
            {selectedVehicle?.customer_name ? ` · ${selectedVehicle.customer_name}` : ''}
          </p>
        </div>
        {!prefill.vehicleId && !isEdit && (
          <button type="button" style={styles.changeVehicleBtn} onClick={() => setStep('vehicle')}>
            เปลี่ยนรถ
          </button>
        )}
      </div>

      <div style={styles.container}>
        {error && <div style={styles.errorBox}>{error}</div>}

        <Section number="1" title="แร็คพวงมาลัย (Rack)" Icon={IconRack}>
          <CheckNoteRow
            label="แร็คพวงมาลัย"
            checked={checklist.rack.checked}
            note={checklist.rack.note}
            onToggle={() => toggleChecked('rack')}
            onNoteChange={(v) => setNote('rack.note', v)}
          />
        </Section>

        <Section number="2" title="ช่วงล่าง (Suspension)">
          {Object.keys(SUSPENSION_LABELS).map((key) => (
            <CheckNoteRow
              key={key}
              label={SUSPENSION_LABELS[key]}
              checked={checklist.suspension[key].checked}
              note={checklist.suspension[key].note}
              onToggle={() => toggleChecked(`suspension.${key}`)}
              onNoteChange={(v) => setNote(`suspension.${key}.note`, v)}
              Icon={SUSPENSION_ICONS[key]}
            />
          ))}
        </Section>

        <Section number="3" title="ลูกปืนล้อ (Wheel Bearing)" Icon={IconWheelBearing}>
          <div style={styles.axleLabel}>หน้า / Front</div>
          <div style={styles.chipRow}>
            <ChipCheck label="L" checked={checklist.wheel_bearing.front_l} onToggle={() => toggleSimple('wheel_bearing.front_l')} />
            <ChipCheck label="R" checked={checklist.wheel_bearing.front_r} onToggle={() => toggleSimple('wheel_bearing.front_r')} />
          </div>
          <div style={styles.axleLabel}>หลัง / Rear</div>
          <div style={styles.chipRow}>
            <ChipCheck label="L" checked={checklist.wheel_bearing.rear_l} onToggle={() => toggleSimple('wheel_bearing.rear_l')} />
            <ChipCheck label="R" checked={checklist.wheel_bearing.rear_r} onToggle={() => toggleSimple('wheel_bearing.rear_r')} />
          </div>
        </Section>

        <Section number="4" title="เพลาขับ (Drive Shaft)" Icon={IconDriveShaft}>
          <div style={styles.axleLabel}>หน้า / Front</div>
          <div style={styles.chipRow}>
            <ChipCheck label="L" checked={checklist.drive_shaft.front_l} onToggle={() => toggleSimple('drive_shaft.front_l')} />
            <ChipCheck label="R" checked={checklist.drive_shaft.front_r} onToggle={() => toggleSimple('drive_shaft.front_r')} />
          </div>
        </Section>

        <Section number="5" title="โช็ค (Shock)" Icon={IconShock}>
          <div style={styles.axleLabel}>หน้า / Front</div>
          <CheckNoteRow
            label="โช็คหน้า"
            checked={checklist.shock.front.checked}
            note={checklist.shock.front.note}
            onToggle={() => toggleChecked('shock.front')}
            onNoteChange={(v) => setNote('shock.front.note', v)}
          />
          <div style={styles.axleLabel}>หลัง / Rear</div>
          <CheckNoteRow
            label="โช็คหลัง"
            checked={checklist.shock.rear.checked}
            note={checklist.shock.rear.note}
            onToggle={() => toggleChecked('shock.rear')}
            onNoteChange={(v) => setNote('shock.rear.note', v)}
          />
        </Section>

        <Section number="6" title="อุปกรณ์ (Equipment)" Icon={IconEquipment}>
          <CheckNoteRow
            label="อุปกรณ์"
            checked={checklist.equipment.checked}
            note={checklist.equipment.note}
            onToggle={() => toggleChecked('equipment')}
            onNoteChange={(v) => setNote('equipment.note', v)}
          />
        </Section>

        <Section number="7" title="อื่น ๆ (Other)">
          <textarea
            value={checklist.other}
            onChange={(e) => setNote('other', e.target.value)}
            placeholder="รายละเอียดเพิ่มเติม..."
            rows={3}
            style={styles.otherTextarea}
          />
        </Section>

        <div style={styles.footerCard}>
          <label style={styles.fieldLabel}>วันที่</label>
          <input type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} style={styles.footerInput} />
          <label style={styles.fieldLabel}>ตรวจเช็คโดย</label>
          <input type="text" value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} placeholder="ชื่อผู้ตรวจเช็ค" style={styles.footerInput} />
          <label style={styles.fieldLabel}>ซ่อมโดย</label>
          <input type="text" value={repairedBy} onChange={(e) => setRepairedBy(e.target.value)} placeholder="ชื่อช่างผู้ซ่อม" style={styles.footerInput} />
        </div>

        <div style={{ height: 90 }} />
      </div>

      <div style={styles.saveBar}>
        <button type="button" style={{ ...styles.saveBtn, opacity: saving ? 0.6 : 1 }} onClick={handleSave} disabled={saving}>
          {saving ? 'กำลังบันทึก...' : isEdit ? 'บันทึกการแก้ไข' : 'บันทึกใบแจ้งซ่อม'}
        </button>
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f5f5f0' },
  container: { maxWidth: 560, margin: '0 auto', padding: '16px 14px' },
  pageTitle: { fontSize: 20, fontWeight: 700, color: '#111', margin: '4px 0 2px' },
  pageSub: { fontSize: 13, color: '#6b7280', marginBottom: 16 },
  searchInput: {
    width: '100%', boxSizing: 'border-box', padding: '13px 14px', fontSize: 15,
    border: '1.5px solid #e5e7eb', borderRadius: 12, outline: 'none', background: '#fff',
  },
  hint: { fontSize: 13, color: '#9ca3af', marginTop: 10, textAlign: 'center' },
  vehicleCard: {
    display: 'block', width: '100%', textAlign: 'left', background: '#fff',
    border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px', marginBottom: 8, cursor: 'pointer',
  },
  vehiclePlate: { fontSize: 15, fontWeight: 700, color: '#111' },
  vehicleMeta: { fontSize: 13, color: '#374151', marginTop: 2 },
  vehicleCustomer: { fontSize: 12, color: '#6b7280', marginTop: 2 },

  topBar: {
    background: '#111111', color: '#fff', padding: '14px 16px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    position: 'sticky', top: 0, zIndex: 10,
  },
  topBarTitle: { fontSize: 15, fontWeight: 700, margin: 0 },
  topBarSub: { fontSize: 12, color: '#d1d5db', margin: '2px 0 0' },
  changeVehicleBtn: {
    background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)',
    color: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
  },

  errorBox: {
    background: '#fee2e2', color: '#991b1b', padding: '10px 12px',
    borderRadius: 10, fontSize: 13, marginBottom: 12,
  },

  section: { background: '#fff', borderRadius: 14, border: '1px solid #e5e3de', marginBottom: 12, overflow: 'hidden' },
  sectionHeader: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
    background: '#f3f4f6', borderBottom: '1px solid #e5e3de',
  },
  sectionNum: {
    width: 24, height: 24, borderRadius: '50%', background: '#111', color: '#fff',
    fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#111', flex: 1 },
  sectionIcon: { color: '#6b7280', flexShrink: 0, display: 'flex' },
  sectionBody: { padding: '10px 14px 14px' },

  checkRow: { marginBottom: 8 },
  checkTap: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
    background: '#f9fafb', border: '1.5px solid #e5e7eb', borderRadius: 10,
    padding: '12px 12px', cursor: 'pointer', minHeight: 48,
  },
  partIcon: { color: '#9ca3af', flexShrink: 0, display: 'flex' },
  partIconOn: { color: '#2563eb' },
  checkTapOn: { background: '#eff6ff', borderColor: '#93c5fd' },
  checkbox: {
    width: 24, height: 24, borderRadius: 7, border: '2px solid #d1d5db', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700,
  },
  checkboxSm: {
    width: 20, height: 20, borderRadius: 6, border: '2px solid #d1d5db', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700,
  },
  checkboxOn: { background: '#2563eb', borderColor: '#2563eb' },
  checkLabel: { fontSize: 14, fontWeight: 500, color: '#111' },
  noteInput: {
    width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '10px 12px',
    fontSize: 13, border: '1.5px solid #e5e7eb', borderRadius: 9, outline: 'none', background: '#fff',
  },

  axleLabel: { fontSize: 12, fontWeight: 600, color: '#6b7280', margin: '8px 0 6px' },
  chipRow: { display: 'flex', gap: 10, marginBottom: 6 },
  chip: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px',
    border: '1.5px solid #e5e7eb', borderRadius: 10, background: '#f9fafb', cursor: 'pointer',
    fontSize: 14, fontWeight: 600, color: '#111',
  },
  chipOn: { background: '#eff6ff', borderColor: '#93c5fd' },

  otherTextarea: {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14,
    border: '1.5px solid #e5e7eb', borderRadius: 10, outline: 'none', fontFamily: 'inherit', resize: 'vertical',
  },

  footerCard: { background: '#fff', borderRadius: 14, border: '1px solid #e5e3de', padding: '14px' },
  fieldLabel: { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, marginTop: 10 },
  footerInput: {
    width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 14,
    border: '1.5px solid #e5e7eb', borderRadius: 10, outline: 'none',
  },

  saveBar: {
    position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff',
    borderTop: '1px solid #e5e3de', padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))',
    zIndex: 20,
  },
  saveBtn: {
    width: '100%', maxWidth: 560, margin: '0 auto', display: 'block',
    padding: '14px', background: '#2563eb', color: '#fff', border: 'none',
    borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer',
  },
  toast: {
    position: 'fixed', top: 16, left: 16, right: 16, background: '#022c22', color: '#fff',
    padding: '12px 16px', borderRadius: 12, fontSize: 13, fontWeight: 600, textAlign: 'center', zIndex: 60,
  },
};
