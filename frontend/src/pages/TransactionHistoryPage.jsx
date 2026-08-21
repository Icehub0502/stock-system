import React, { useCallback, useEffect, useState } from 'react';
import client from '../api/client';
import { formatDbDateTime } from '../utils/format';
import useRealtimeEvent from '../hooks/useRealtimeEvent';

export default function TransactionHistoryPage() {
  const [rows, setRows] = useState([]);

  const loadRows = useCallback(async () => {
    const res = await client.get('/transactions');
    setRows(res.data);
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  // Realtime: หน้านี้เป็นแค่ตารางประวัติ อ่านอย่างเดียว ไม่มีฟอร์ม/โหมดแก้ไขที่
  // ต้องกันการรีเฟรชระหว่างทาง จึงรีเฟรชได้ทันทีโดยไม่ต้อง guard
  useRealtimeEvent(['stock:tx-created', 'stock:tx-deleted'], () => loadRows());

  return (
    <div className="office-dashboard container">
      <div className="dashboard-header">
        <h2>ประวัติรายการรับ-จ่ายสต็อก</h2>
      </div>

      <div className="table-wrapper">
        <table className="rack-table">
          <thead>
            <tr>
              <th>วันที่</th>
              <th>ประเภท</th>
              <th>รหัสรุ่น</th>
              <th>รายการ</th>
              <th>จำนวน</th>
              <th>ผู้ทำรายการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="วันที่">{formatDbDateTime(r.created_at)}</td>
                <td data-label="ประเภท">{r.type === 'IN' ? 'รับเข้า' : 'จ่ายออก'}</td>
                <td data-label="รหัสรุ่น">{r.model_code}</td>
                <td data-label="รายการ">{r.rack_name}</td>
                <td data-label="จำนวน">{r.qty}</td>
                <td data-label="ผู้ทำรายการ">{r.full_name || r.username}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="no-result-text">ยังไม่มีประวัติรายการ</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
