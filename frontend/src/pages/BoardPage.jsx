import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { WORK_BAYS, ALIGN_BAY } from '../utils/workBays';

// axios ตรง ๆ ไม่ผ่าน ../api/client — client.js แนบ Bearer token จาก localStorage
// ให้ทุก request และ redirect ไป /login ทันทีที่เจอ 401 ซึ่งพังกับหน้านี้ที่ตั้งใจ
// ให้เปิดแบบสาธารณะ ไม่มีใครล็อกอิน (จอ TV ห้องรับรอง) ยิง /api/board ตรง ๆ พอ
const boardClient = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

const POLL_MS = 8000;

/**
 * จอบอร์ดห้องรับรอง — สาธารณะ ไม่ต้องล็อกอิน (ดู board.routes.js ฝั่ง backend ที่
 * ตัดข้อมูลลูกค้าออกตั้งแต่ระดับ SQL แล้ว หน้านี้แค่แสดงสิ่งที่ backend ส่งมาตรง ๆ)
 * เจ้าของร้านสั่ง: ไม่ต้องเลื่อนอัตโนมัติ (ต่างจากโครง ChamppowerD ที่เลื่อนทุก 3 วิ)
 * — คิวเยอะแค่ไหนก็ปล่อยให้ยาวลงไปเป็นหน้าจอเดียว ลูกค้าเลื่อนดูเองได้ถ้าจำเป็น
 */
export default function BoardPage() {
  const [bays, setBays] = useState(WORK_BAYS);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await boardClient.get('/board');
        if (cancelled) return;
        setBays(res.data.bays || WORK_BAYS);
        setRows(res.data.data || []);
      } catch (err) {
        // จอสาธารณะ ไม่มีใครกดปิด error ได้ — เงียบไว้แล้วลองรอบถัดไปพอ
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const bayOccupant = (bay) => rows.find((r) => r.bay === bay);

  return (
    <div className="board-page">
      <header className="board-header">
        <span className="board-title">Champpower SPK</span>
        <span className="board-clock">{now.toLocaleTimeString('th-TH')}</span>
      </header>

      <div className="board-bays">
        {bays.map((bay) => {
          const occupant = bayOccupant(bay);
          return (
            <div className={`board-bay ${occupant ? 'occupied' : ''} ${bay === ALIGN_BAY ? 'board-bay-align' : ''}`} key={bay}>
              <div className="board-bay-label">{bay}</div>
              {occupant ? (
                <div className="board-bay-plate">{occupant.plate || '-'}</div>
              ) : (
                <div className="board-bay-empty">ว่าง</div>
              )}
            </div>
          );
        })}
      </div>

      {loading ? (
        <div className="board-loading">กำลังโหลด...</div>
      ) : rows.length === 0 ? (
        <div className="board-empty">ยังไม่มีรถวันนี้</div>
      ) : (
        <div className="board-rows">
          {rows.map((r) => (
            <div className="board-row" key={r.id}>
              <div className="board-row-queue">
                {r.queue_no ? <span className="board-row-queue-n">{r.queue_no}</span> : <span className="board-row-queue-dash">—</span>}
              </div>
              <div className="board-row-plate">{r.plate || '-'}</div>
              <div className="board-row-model">
                {r.brand} {r.model} {r.color && `· ${r.color}`}
              </div>
              <div className="board-row-bay">{r.bay || '-'}</div>
              <div className={`status-badge ${statusBadgeCls(r.status)}`}>{r.status_label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// จอบอร์ดโหลด constants ฝั่งเดียวเองแบบย่อ (ไม่ดึง utils/jobStatus.js เต็มไฟล์)
// เพราะ status_label ที่ backend ส่งมาใช้แสดงข้อความอยู่แล้ว ไฟล์นี้เดาแค่สีจาก key
function statusBadgeCls(status) {
  if (status === 'approved' || status === 'ready') return 'status-badge-success';
  if (status === 'rejected') return 'status-badge-danger';
  if (status === 'repairing' || status === 'aligning') return 'status-badge-today';
  if (status === 'scheduled' || status === 'quoted' || status === 'inspecting') return 'status-badge-warning';
  return 'status-badge-neutral';
}
