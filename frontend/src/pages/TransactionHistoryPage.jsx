import React, { useEffect, useState } from 'react';
import client from '../api/client';

export default function TransactionHistoryPage() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    client.get('/transactions').then((res) => setRows(res.data));
  }, []);

  return (
    <div>
      <h2>ประวัติรายการรับ-จ่ายสต็อก</h2>
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
              <td>{new Date(r.created_at).toLocaleString('th-TH')}</td>
              <td>{r.type === 'IN' ? 'รับเข้า' : 'จ่ายออก'}</td>
              <td>{r.model_code}</td>
              <td>{r.rack_name}</td>
              <td>{r.qty}</td>
              <td>{r.full_name || r.username}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
