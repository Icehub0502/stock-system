import React from 'react';
import { COMPANY } from '../utils/printDoc';
import { normalizeChecklist, SUSPENSION_LABELS } from '../utils/repairChecklist';

function formatThaiDate(dateInput) {
  if (!dateInput) return '-';
  const d = new Date(dateInput);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear() + 543;
  return `${dd}/${mm}/${yyyy}`;
}

function Box({ checked }) {
  return <span className={`rn-box ${checked ? 'rn-box-checked' : ''}`}>{checked ? '✓' : ''}</span>;
}

function CheckLine({ checked, note }) {
  return (
    <div className="rn-check-line">
      <Box checked={checked} />
      <span className="rn-note-line">{note || ''}</span>
    </div>
  );
}

export default function RepairNoticePrintTemplate({ data }) {
  if (!data) return null;
  const {
    code,
    notice_date,
    vehicle = {},
    checked_by,
    repaired_by,
  } = data;

  const checklist = normalizeChecklist(
    typeof data.checklist === 'string' ? JSON.parse(data.checklist) : data.checklist
  );

  return (
    <div className="doc-print-wrap" id="repair-notice-print-area">
      <div className="doc-page rn-page">
        <div className="rn-header">
          <div className="rn-brand">
            <div className="rn-brand-name">{COMPANY.legalName}</div>
            <div className="rn-code">SPK <span className="rn-code-value">{(code || '').replace('SPK-', '')}</span></div>
          </div>
          <div className="rn-title-row">
            <h1>ใบแจ้งซ่อม / รายการซ่อม</h1>
            <div className="rn-plate">ทะเบียน <strong>{vehicle.license_plate || '-'}</strong></div>
          </div>
          <div className="rn-vehicle-line">
            {vehicle.brand || '-'} {vehicle.model || ''} {vehicle.color ? `· ${vehicle.color}` : ''}
            {data.customer_name ? ` · ${data.customer_name}` : ''}
          </div>
        </div>

        <table className="rn-table">
          <tbody>
            <tr>
              <td className="rn-num">1</td>
              <td className="rn-label">แร็คพวงมาลัย (Rack)</td>
              <td className="rn-value"><CheckLine checked={checklist.rack.checked} note={checklist.rack.note} /></td>
            </tr>

            <tr>
              <td className="rn-num" rowSpan={5}>2</td>
              <td className="rn-label">ช่วงล่าง / Suspension</td>
              <td className="rn-value" />
            </tr>
            {Object.keys(SUSPENSION_LABELS).map((key, idx) => (
              <tr key={key}>
                <td className="rn-sublabel">2.{idx + 1} {SUSPENSION_LABELS[key]}</td>
                <td className="rn-value">
                  <CheckLine checked={checklist.suspension[key].checked} note={checklist.suspension[key].note} />
                </td>
              </tr>
            ))}

            <tr>
              <td className="rn-num">3</td>
              <td className="rn-label">ลูกปืนล้อ / Wheel Bearing</td>
              <td className="rn-value">
                <div className="rn-axle-grid">
                  <span>หน้า: L<Box checked={checklist.wheel_bearing.front_l} /> R<Box checked={checklist.wheel_bearing.front_r} /></span>
                  <span>หลัง: L<Box checked={checklist.wheel_bearing.rear_l} /> R<Box checked={checklist.wheel_bearing.rear_r} /></span>
                </div>
              </td>
            </tr>

            <tr>
              <td className="rn-num">4</td>
              <td className="rn-label">เพลาขับ / Drive Shaft</td>
              <td className="rn-value">
                <div className="rn-axle-grid">
                  <span>หน้า: L<Box checked={checklist.drive_shaft.front_l} /> R<Box checked={checklist.drive_shaft.front_r} /></span>
                </div>
              </td>
            </tr>

            <tr>
              <td className="rn-num" rowSpan={2}>5</td>
              <td className="rn-sublabel">หน้า / Front</td>
              <td className="rn-value"><CheckLine checked={checklist.shock.front.checked} note={checklist.shock.front.note} /></td>
            </tr>
            <tr>
              <td className="rn-sublabel">หลัง / Rear (โช็ค / Shock)</td>
              <td className="rn-value"><CheckLine checked={checklist.shock.rear.checked} note={checklist.shock.rear.note} /></td>
            </tr>

            <tr>
              <td className="rn-num">6</td>
              <td className="rn-label">อุปกรณ์ / Equipment</td>
              <td className="rn-value"><CheckLine checked={checklist.equipment.checked} note={checklist.equipment.note} /></td>
            </tr>

            <tr>
              <td className="rn-num">7</td>
              <td className="rn-label">อื่น ๆ / Other</td>
              <td className="rn-value rn-other">{checklist.other || ''}</td>
            </tr>
          </tbody>
        </table>

        <div className="rn-footer">
          <div>ตรวจเช็คโดย <span className="rn-footer-fill">{checked_by || '-'}</span></div>
          <div>ซ่อมโดย <span className="rn-footer-fill">{repaired_by || '-'}</span></div>
          <div>วันที่ <span className="rn-footer-fill">{formatThaiDate(notice_date)}</span></div>
        </div>
      </div>
    </div>
  );
}
