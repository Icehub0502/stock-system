import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { canChange } from '../utils/roles';
import { formatDateTh } from '../utils/dateGroups';
import { formatDbDateTime } from '../utils/format';
import { WARRANTY_STATUS, daysLeftText, kmLeftText } from '../utils/warrantyLabels';

const FILTERS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'active', label: 'อยู่ในประกัน' },
  { key: 'soon', label: 'ใกล้หมด' },
  { key: 'expired', label: 'หมดประกัน' },
  { key: 'needs_number', label: 'แร็คที่ยังไม่มีเลข' },
  { key: 'none', label: 'ยังไม่ระบุประกัน' },
  { key: 'waiting', label: 'รอออกใบเสร็จ' },
  { key: 'void', label: 'เลขที่ยกเลิก' },
];

// ทะเบียนประกัน: what is under warranty and how much is left. Racks, suspension sets and ball joints, from what was sold;
// racks carry a running number per branch.
export default function WarrantyRegisterPage() {
  const { user } = useAuth();
  const isManager = canChange(user, 'manager');
  const mayAssign = canChange(user, 'office');
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startInput, setStartInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('/warranty-register', { params: { q: search.trim() || undefined, status: status || undefined } });
      setData(res.data.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดทะเบียนประกันไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  const saveStart = async (e) => {
    e.preventDefault();
    setNotice('');
    if (!(Number(startInput) >= 1)) {
      setError('เลขเริ่มต้นต้องเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const res = await client.put('/warranty-register/settings', { start_no: Number(startInput) });
      setNotice(`บันทึกแล้ว เลขถัดไปคือ ${data.branch_code} ${res.data.next_no}`);
      setStartInput('');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกเลขเริ่มต้นไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  // a bill that did not come through the queue gets its number here
  const assignToReceipt = async (receiptId) => {
    setSaving(true);
    setNotice('');
    try {
      const res = await client.post('/warranty-register/assign', { receipt_id: receiptId });
      setNotice(`ออกเลข ${res.data.warranty_label} แล้ว`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'ออกเลขประกันไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const counts = data?.counts || {};
  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ทะเบียนประกัน</h1>
          <p className="subtitle">แร็ค ชุดโปรช่วงล่าง และลูกหมาก นับถอยหลังทั้งเวลาและกิโลเมตร อย่างใดถึงก่อนถือว่าหมด</p>
        </div>
        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหาทะเบียน ชื่อ เบอร์ เลขบิล เลขประกัน"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {data && (
        <div className="wr-numbering">
          {data.next_no ? (
            <p>เลขประกันถัดไปของสาขา: <b>{data.branch_code} {data.next_no}</b></p>
          ) : (
            <p className="wr-numbering-warn">
              สาขานี้ยังไม่ได้ตั้งเลขเริ่มต้น จึงยังออกเลขไม่ได้ {isManager ? 'ใส่เลขถัดไปจากทะเบียนเดิมด้านขวา' : 'ให้ผู้จัดการตั้งก่อน'}
            </p>
          )}
          {isManager && (
            <form className="wr-numbering-form" onSubmit={saveStart}>
              <label htmlFor="wr-start">{data.next_no ? 'เปลี่ยนเลขเริ่มต้น' : 'ตั้งเลขเริ่มต้น'}</label>
              <input id="wr-start" type="number" inputMode="numeric" value={startInput} onChange={(e) => setStartInput(e.target.value)} />
              <button type="submit" disabled={saving || !startInput}>บันทึก</button>
            </form>
          )}
          {notice && <p className="wr-numbering-ok">{notice}</p>}
        </div>
      )}

      <div className="wr-filters" role="group" aria-label="กรองตามสถานะ">
        {FILTERS.map((f) => (
          <button type="button" key={f.key} className={status === f.key ? 'is-on' : ''} aria-pressed={status === f.key} onClick={() => setStatus(f.key)}>
            {f.label}{f.key && counts[f.key] !== undefined ? ` (${Number(counts[f.key]).toLocaleString()})` : ''}
          </button>
        ))}
      </div>

      {error && <div className="error-message">{error}</div>}
      {loading && !data ? (
        <div className="loading">กำลังโหลด...</div>
      ) : data && data.rows.length === 0 ? (
        <div className="empty-message">{search.trim() || status ? 'ไม่พบรายการ' : 'ยังไม่มีรายการในทะเบียนประกัน'}</div>
      ) : data && (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>เลขประกัน</th>
                <th>บิล / วันที่เริ่ม</th>
                <th>ลูกค้า</th>
                <th>รถ</th>
                <th>การรับประกัน</th>
                <th>เหลือเวลา</th>
                <th>ระยะทาง</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.receipt_id ? `${row.receipt_id}-${row.warranty_name}` : `no-${row.warranty_no}`}>
                  <td data-label="เลขประกัน">
                    {row.warranty_label ? <b>{row.warranty_label}</b> : row.needs_number ? (
                      data.next_no && mayAssign
                        ? <button type="button" className="wr-assign-btn" onClick={() => assignToReceipt(row.receipt_id)} disabled={saving}>ออกเลข {data.branch_code} {data.next_no}</button>
                        : <span className="wr-status-soon">ยังไม่มีเลข</span>
                    ) : '-'}
                  </td>
                  <td data-label="บิล / วันที่เริ่ม">
                    {row.receipt_no || (row.job_id ? <Link to={`/jobs/${row.job_id}`}>{row.job_no}</Link> : '-')}
                    {row.status === 'void' && <small className="wr-sub">ยกเลิกโดย {row.voided_by || '-'}{row.voided_at ? ` · ${formatDbDateTime(row.voided_at)}` : ''}</small>}
                    <small className="wr-sub">{row.receipt_date ? formatDateTh(row.receipt_date) : ''}</small>
                  </td>
                  <td data-label="ลูกค้า">{row.customer_name || '-'}<small className="wr-sub">{row.phone || ''}</small></td>
                  <td data-label="รถ">{row.license_plate || '-'}<small className="wr-sub">{[row.brand, row.model].filter(Boolean).join(' ')}</small></td>
                  <td data-label="การรับประกัน">
                    {row.warranty_name || '-'}
                    <small className="wr-sub">{(row.item_names || []).slice(0, 3).join(', ')}{(row.item_names || []).length > 3 ? ' ...' : ''}</small>
                  </td>
                  <td data-label="เหลือเวลา">
                    {row.status === 'none' || !row.receipt_id ? '-' : (
                      <>
                        {daysLeftText(row.days_left)}
                        {row.expires_on && <small className="wr-sub">ถึง {formatDateTh(row.expires_on)}</small>}
                      </>
                    )}
                  </td>
                  <td data-label="ระยะทาง">{row.status === 'none' || !row.receipt_id ? '-' : kmLeftText(row)}</td>
                  <td data-label="สถานะ"><span className={WARRANTY_STATUS[row.status].className}>{WARRANTY_STATUS[row.status].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.total > data.rows.length && <p className="wr-more">แสดง {data.rows.length} จาก {data.total.toLocaleString()} รายการ ค้นหาเพื่อดูรายการอื่น</p>}
        </div>
      )}
    </div>
  );
}
