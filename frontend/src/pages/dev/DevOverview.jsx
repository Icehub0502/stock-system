import React, { useEffect, useState } from 'react';
import client from '../../api/client';

export const formatBytes = (bytes) => {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const formatDateTime = (value) => (value ? new Date(String(value).replace(' ', 'T')).toLocaleString('th-TH') : '-');

export default function DevOverview() {
  const [overview, setOverview] = useState(null);
  const [shops, setShops] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([client.get('/dev/overview'), client.get('/dev/shops')])
      .then(([o, s]) => {
        setOverview(o.data.data);
        setShops(s.data.data);
      })
      .catch((err) => setError(err.response?.data?.error || 'โหลดภาพรวมไม่สำเร็จ'));
  }, []);

  // active shops with nothing happening for a week stand out
  const quiet = shops.filter((s) => {
    if (s.status !== 'active') return false;
    if (!s.last_activity) return true;
    return Date.now() - new Date(String(s.last_activity).replace(' ', 'T')).getTime() > 7 * 24 * 3600 * 1000;
  });

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ภาพรวมระบบ</h1>
          <p className="subtitle">จำนวนร้านและผู้ใช้ทั้งหมดบนระบบ (ไม่แสดงตัวเลขเงินของร้านต่างๆ)</p>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      {overview && (
        <>
          <div className="dash-stat-grid">
            <div className="dash-stat-card"><div className="dash-stat-label">ร้านทั้งหมด</div><div className="dash-stat-value">{overview.shops}</div></div>
            <div className="dash-stat-card"><div className="dash-stat-label">ใช้งานอยู่</div><div className="dash-stat-value">{overview.active_shops}</div></div>
            <div className="dash-stat-card"><div className="dash-stat-label">ถูกระงับ</div><div className="dash-stat-value">{overview.suspended_shops}</div></div>
            <div className="dash-stat-card"><div className="dash-stat-label">กลุ่มสาขา</div><div className="dash-stat-value">{overview.groups}</div></div>
          </div>
          <div className="dash-stat-grid">
            <div className="dash-stat-card"><div className="dash-stat-label">ผู้ใช้ทั้งหมด</div><div className="dash-stat-value">{overview.users}</div></div>
            <div className="dash-stat-card"><div className="dash-stat-label">บัญชีที่ปิดอยู่</div><div className="dash-stat-value">{overview.disabled_users}</div></div>
            <div className="dash-stat-card"><div className="dash-stat-label">รายการในถังขยะ</div><div className="dash-stat-value">{overview.trash_records}</div></div>
            <div className="dash-stat-card"><div className="dash-stat-label">ขนาดถังขยะ</div><div className="dash-stat-value">{formatBytes(overview.trash_bytes)}</div></div>
          </div>
        </>
      )}

      <div className="dash-panel">
        <div className="dash-panel-title">ปริมาณงานวันนี้ของแต่ละร้าน</div>
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr><th>ร้าน</th><th>กลุ่ม</th><th>สถานะ</th><th>คิววันนี้</th><th>บิลวันนี้</th><th>ใช้งานล่าสุด</th></tr>
            </thead>
            <tbody>
              {shops.map((s) => (
                <tr key={s.id}>
                  <td data-label="ร้าน">{s.name} <span className="subtitle">({s.code})</span></td>
                  <td data-label="กลุ่ม">{s.group_name}</td>
                  <td data-label="สถานะ">{s.status === 'active' ? 'ใช้งาน' : 'ระงับ'}</td>
                  <td data-label="คิววันนี้">{s.jobs_today}</td>
                  <td data-label="บิลวันนี้">{s.receipts_today}</td>
                  <td data-label="ใช้งานล่าสุด">{formatDateTime(s.last_activity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {quiet.length > 0 && (
          <p className="subtitle">ร้านที่เงียบเกิน 7 วัน: {quiet.map((s) => s.name).join(', ')}</p>
        )}
      </div>
    </div>
  );
}

const ACTION_LABEL = {
  create_shop: 'สร้างร้าน',
  update_shop: 'แก้ไข/ระงับ/เปิดร้าน',
  reset_password: 'รีเซ็ตรหัสผ่าน',
  change_role: 'เปลี่ยนสิทธิ์ผู้ใช้',
  disable_user: 'ปิดบัญชี',
  enable_user: 'เปิดบัญชี',
  switch_shop: 'สลับเข้าสาขา',
  trash_restore: 'กู้คืนรายการที่ลบ',
  trash_delete_forever: 'ลบรายการในถังขยะถาวร',
  trash_purge: 'ล้างถังขยะตามอายุ',
  trash_settings: 'ตั้งค่าถังขยะ',
};

export function DevAudit() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/dev/audit', { params: { limit: 200 } })
      .then((res) => setRows(res.data.data))
      .catch((err) => setError(err.response?.data?.error || 'โหลดบันทึกไม่สำเร็จ'));
  }, []);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>บันทึกการทำงาน</h1>
          <p className="subtitle">สิ่งที่ผู้ดูแลระบบทำ และการสลับสาขา (200 รายการล่าสุด)</p>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      <div className="quotation-table-wrap">
        <table className="quotation-table">
          <thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>การกระทำ</th><th>ร้าน</th><th>รายละเอียด</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="เวลา">{formatDateTime(r.created_at)}</td>
                <td data-label="ผู้ทำ">{r.username || '-'}</td>
                <td data-label="การกระทำ">{ACTION_LABEL[r.action] || r.action}</td>
                <td data-label="ร้าน">{r.shop_code || '-'}</td>
                <td data-label="รายละเอียด" className="dev-detail">{r.detail || ''}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5}>ยังไม่มีบันทึก</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
