import React, { useEffect, useMemo, useState } from 'react';

const pad = (n) => String(n).padStart(2, '0');

// 01:25:10
function clockText(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${pad(hours)}:${pad(minutes)}:${pad(totalSeconds % 60)}`;
}

// 1 ชม. 25 นาที
function durationText(totalSeconds) {
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes === 0) return 'ไม่ถึง 1 นาที';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return [hours > 0 ? `${hours} ชม.` : '', minutes > 0 || hours === 0 ? `${minutes} นาที` : ''].filter(Boolean).join(' ');
}

// Time a car has spent at "กำลังซ่อม" on its queue card. The server sends the seconds so far (see utils/repairTime.js);
// a running timer counts on from the moment they arrived, so a device with a wrong clock still shows the right time.
export default function RepairTimer({ seconds, running }) {
  const [now, setNow] = useState(() => Date.now());
  const receivedAt = useMemo(() => Date.now(), [seconds, running]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (seconds === null || seconds === undefined) return null;

  if (!running) {
    return <div className="job-card-timer">⏱️ ใช้เวลาซ่อม {durationText(seconds)}</div>;
  }
  const elapsed = seconds + Math.max(0, Math.floor((now - receivedAt) / 1000));
  return <div className="job-card-timer job-card-timer-running" role="timer">⏱️ กำลังซ่อมมาแล้ว {clockText(elapsed)}</div>;
}
