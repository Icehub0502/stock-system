import React, { useEffect, useState } from 'react';
import client from '../api/client';
import { formatMoney } from '../utils/format';
import { formatDateTh } from '../utils/dateGroups';
import { CASE_TYPE_LABEL } from '../utils/claimCases';
import ClaimPrintModal from '../components/ClaimPrintModal';

// ใบเคลม (งานขาย → ใบเคลม): every claim document given to a customer, to look up and print again. A document is issued
// from its case, on the job page of a come-back or in the case list.
export default function ClaimDocumentsPage() {
  const [claims, setClaims] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [printId, setPrintId] = useState(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await client.get('/claims', { params: { issued: 1, search: search.trim() || undefined } });
        setClaims(res.data.data || []);
        setError('');
      } catch (err) {
        setError(err.response?.data?.error || 'โหลดใบเคลมไม่สำเร็จ');
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ใบเคลม</h1>
          <p className="subtitle">ใบเคลมที่ออกให้ลูกค้าทั้งหมด ค้นและพิมพ์ซ้ำได้</p>
        </div>
        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหาเลขที่ ทะเบียน ชื่อลูกค้า"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : claims.length === 0 ? (
        <div className="empty-message">{search.trim() ? 'ไม่พบใบเคลม' : 'ยังไม่มีใบเคลม ออกได้จากหน้างานแก้ของรถคันนั้น'}</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>เลขที่ใบเคลม</th>
                <th>วันที่</th>
                <th>ประเภท</th>
                <th>ลูกค้า</th>
                <th>รถ</th>
                <th>ปัญหา</th>
                <th>วิธีแก้ไข</th>
                <th>ค่าใช้จ่าย</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td data-label="เลขที่ใบเคลม">{c.claim_no}</td>
                  <td data-label="วันที่">{formatDateTh(c.claim_date)}</td>
                  <td data-label="ประเภท">{CASE_TYPE_LABEL[c.case_type] || '-'}</td>
                  <td data-label="ลูกค้า">{c.customer_name} {c.phone ? `· ${c.phone}` : ''}</td>
                  <td data-label="รถ">{c.license_plate || '-'} · {c.brand} {c.model}</td>
                  <td data-label="ปัญหา">{c.symptom || '-'}</td>
                  <td data-label="วิธีแก้ไข">{c.resolution || '-'}</td>
                  <td data-label="ค่าใช้จ่าย">{Number(c.charge_total) ? `฿${formatMoney(c.charge_total)}` : 'ไม่คิดเงิน'}</td>
                  <td className="actions" data-label="จัดการ">
                    <button type="button" onClick={() => setPrintId(c.id)}>ดู / พิมพ์</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {printId && <ClaimPrintModal claimId={printId} onClose={() => setPrintId(null)} />}
    </div>
  );
}
