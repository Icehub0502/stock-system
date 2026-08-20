import React from 'react';
import { MAIN_PATH, jobStatusDef } from '../utils/jobStatus';

// หลอดสถานะ — แสดงความคืบหน้าบนเส้นทางหลัก (MAIN_PATH) เป็นจุดไล่กัน จุดที่ผ่าน
// แล้ว/ปัจจุบันจะทึบ ที่เหลือโปร่ง งานที่แยกออกจากเส้นทางหลัก (นัดวันมาทำ/
// ไม่อนุมัติ/เอารถลง) ไม่ได้อยู่บนเส้นนี้ตั้งแต่แรก โชว์เป็น badge สถานะแทน
export default function StatusTrack({ status }) {
  const idx = MAIN_PATH.indexOf(status);

  if (idx === -1) {
    const st = jobStatusDef(status);
    return (
      <div className="status-track status-track-off">
        <span className={`status-badge ${st.badge}`}>{st.label}</span>
      </div>
    );
  }

  return (
    <div className="status-track" title={jobStatusDef(status).label}>
      {MAIN_PATH.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <div className={`status-track-line ${i <= idx ? 'done' : ''}`} />}
          <div className={`status-track-dot ${i < idx ? 'done' : i === idx ? 'current' : ''}`} />
        </React.Fragment>
      ))}
    </div>
  );
}
