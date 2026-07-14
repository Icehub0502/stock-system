import React from 'react';
import { normalizeChecklist, SUSPENSION_LABELS } from '../utils/repairChecklist';
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

function formatThaiDate(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear() + 543}`;
}

function Box({ on }) {
  return <span className={`rnf-box ${on ? 'rnf-box-on' : ''}`}>{on ? '✓' : ''}</span>;
}

// checkbox + a note line (rack / suspension sub-items / shock / equipment)
function NoteAnswer({ on, note }) {
  return (
    <div className="rnf-answer">
      <Box on={on} />
      <span className="rnf-note">{note || ''}</span>
    </div>
  );
}

// Label on the left, part illustration pushed to the right edge of the cell.
function PartLabel({ img, children, sub }) {
  return (
    <div className={`rnf-part-in ${sub ? 'rnf-sub' : ''}`}>
      <span className="rnf-label">{children}</span>
      {img ? <img className="rnf-img" src={img} alt="" /> : null}
    </div>
  );
}

// A checkbox row prefixed with a หน้า/หลัง (or similar) axle label.
function AxleAnswer({ title, on, note }) {
  return (
    <div className="rnf-answer">
      <span className="rnf-lr-title">{title}</span>
      <Box on={on} />
      {note !== undefined ? <span className="rnf-note">{note || ''}</span> : null}
    </div>
  );
}

export default function RepairNoticePrintTemplate({ data }) {
  if (!data) return null;
  const { code, notice_date, queue_no, vehicle = {}, checked_by, repaired_by } = data;
  const c = normalizeChecklist(
    typeof data.checklist === 'string' ? JSON.parse(data.checklist) : data.checklist
  );

  return (
    <div className="doc-print-wrap" id="repair-notice-print-area">
      <div className="doc-page rnf-page">
        {/* ── Header: SPK box (left) · brand + title (center) · queue no (right) ── */}
        <div className="rnf-header">
          <div className="rnf-spk">
            <div className="rnf-spk-label">SPK</div>
            <div className="rnf-spk-blank" />
          </div>

          <div className="rnf-title">
            <div className="rnf-brand">
              <span className="rnf-champ">Champ</span><span className="rnf-power">power</span><span className="rnf-spktext">SPK</span>
            </div>
            <div className="rnf-doctitle">ใบแจ้งซ่อม / รายการซ่อม</div>
            <div className="rnf-plate">
              {[vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(' ')} · ทะเบียน{' '}
              <strong>{vehicle.license_plate || '____________'}</strong>
            </div>
          </div>

          <div className="rnf-queue">
            <div className="rnf-queue-label">เลขที่คิว</div>
            <div className="rnf-queue-value">{queue_no || '—'}</div>
          </div>
        </div>

        {/* ── Checklist ── */}
        <table className="rnf-table">
          <tbody>
            <tr>
              <td className="rnf-num"><span>1</span></td>
              <td className="rnf-part"><PartLabel img={rackImg}>แร็คพวงมาลัย / Rack</PartLabel></td>
              <td className="rnf-ans"><NoteAnswer on={c.rack.checked} note={c.rack.note} /></td>
            </tr>

            <tr className="rnf-subhead">
              <td className="rnf-num" rowSpan={5}><span>2</span></td>
              <td colSpan={2}>ช่วงล่าง / Suspension</td>
            </tr>
            {Object.keys(SUSPENSION_LABELS).map((key, i) => (
              <tr key={key}>
                <td className="rnf-part">
                  <PartLabel img={SUSPENSION_IMG[key]} sub>{`2.${i + 1} ${SUSPENSION_LABELS[key]}`}</PartLabel>
                </td>
                <td className="rnf-ans">
                  <NoteAnswer on={c.suspension[key].checked} note={c.suspension[key].note} />
                </td>
              </tr>
            ))}

            <tr>
              <td className="rnf-num"><span>3</span></td>
              <td className="rnf-part"><PartLabel img={wheelBearingImg}>ลูกปืนล้อ / Wheel Bearing</PartLabel></td>
              <td className="rnf-ans">
                <div className="rnf-lr"><span className="rnf-lr-title">หน้า / Front</span><Box on={c.wheel_bearing.front_l} />L<Box on={c.wheel_bearing.front_r} />R</div>
                <div className="rnf-lr"><span className="rnf-lr-title">หลัง / Rear</span><Box on={c.wheel_bearing.rear_l} />L<Box on={c.wheel_bearing.rear_r} />R</div>
              </td>
            </tr>

            <tr>
              <td className="rnf-num"><span>4</span></td>
              <td className="rnf-part"><PartLabel img={driveShaftImg}>เพลาขับ / Drive Shaft</PartLabel></td>
              <td className="rnf-ans">
                <div className="rnf-lr"><span className="rnf-lr-title">หน้า / Front</span><Box on={c.drive_shaft.front_l} />L<Box on={c.drive_shaft.front_r} />R</div>
              </td>
            </tr>

            <tr>
              <td className="rnf-num"><span>5</span></td>
              <td className="rnf-part"><PartLabel img={shockImg}>โช๊ค / Shock</PartLabel></td>
              <td className="rnf-ans">
                <AxleAnswer title="หน้า / Front" on={c.shock.front.checked} note={c.shock.front.note} />
                <AxleAnswer title="หลัง / Rear" on={c.shock.rear.checked} note={c.shock.rear.note} />
              </td>
            </tr>

            <tr>
              <td className="rnf-num"><span>6</span></td>
              <td className="rnf-part"><PartLabel img={equipmentImg}>อุปกรณ์ / Equipment</PartLabel></td>
              <td className="rnf-ans"><NoteAnswer on={c.equipment.checked} note={c.equipment.note} /></td>
            </tr>

            <tr>
              <td className="rnf-num"><span>7</span></td>
              <td className="rnf-part"><PartLabel img={brakePadImg}>ผ้าเบรค / Brake Pad</PartLabel></td>
              <td className="rnf-ans">
                <AxleAnswer title="หน้า / Front" on={c.brake_pad.front} note="" />
                <AxleAnswer title="หลัง / Rear" on={c.brake_pad.rear} note="" />
              </td>
            </tr>

            <tr>
              <td className="rnf-num"><span>8</span></td>
              <td className="rnf-part"><PartLabel img={brakeDiscImg}>เจียจานเบรค / Brake Disc</PartLabel></td>
              <td className="rnf-ans">
                <AxleAnswer title="หน้า / Front" on={c.brake_disc.front} note="" />
                <AxleAnswer title="หลัง / Rear" on={c.brake_disc.rear} note="" />
              </td>
            </tr>

            <tr>
              <td className="rnf-num"><span>9</span></td>
              <td className="rnf-part"><PartLabel img={workerImg}>อื่น ๆ / Other</PartLabel></td>
              <td className="rnf-ans"><div className="rnf-other">{c.other || ''}</div></td>
            </tr>
          </tbody>
        </table>

        {/* ── Footer ── */}
        <div className="rnf-footer">
          <div>ตรวจเช็คโดย <span className="rnf-fill">{checked_by || ''}</span></div>
          <div>ซ่อมโดย <span className="rnf-fill">{repaired_by || ''}</span></div>
          <div>วันที่ <span className="rnf-fill">{formatThaiDate(notice_date)}</span></div>
        </div>
        <div className="rnf-code">{code || ''}</div>
      </div>
    </div>
  );
}
