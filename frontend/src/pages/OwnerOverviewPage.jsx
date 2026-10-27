import React, { useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const baht = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

const PRESETS = [
  { key: 'today', label: 'วันนี้', range: () => [todayStr(), todayStr()] },
  { key: 'yesterday', label: 'เมื่อวาน', range: () => [shiftDays(todayStr(), -1), shiftDays(todayStr(), -1)] },
  { key: 'month', label: 'เดือนนี้', range: () => [`${todayStr().slice(0, 7)}-01`, todayStr()] },
  { key: 'custom', label: 'กำหนดเอง', range: null },
];

// Owner: sales / bills / queues of every branch of the group, plus the total.
export default function OwnerOverviewPage() {
  const { user, switchShop } = useAuth();
  const [preset, setPreset] = useState('today');
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    client.get('/owner/overview', { params: { from, to } })
      .then((res) => { if (!cancelled) setData(res.data.data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error || 'โหลดภาพรวมไม่สำเร็จ'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const choose = (p) => {
    setPreset(p.key);
    if (p.range) {
      const [f, t] = p.range();
      setFrom(f);
      setTo(t);
    }
  };

  const methods = useMemo(() => {
    const names = new Set();
    (data?.branches || []).forEach((b) => Object.keys(b.by_method).forEach((m) => names.add(m)));
    return [...names];
  }, [data]);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ภาพรวมทุกสาขา</h1>
          <p className="subtitle">{data ? `กลุ่ม ${data.group_name}` : 'ยอดขายและงานของทุกสาขาในกลุ่มของคุณ'}</p>
        </div>
      </div>

      <div className="owner-range">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`btn-tab ${preset === p.key ? 'btn-tab-active' : ''}`}
            onClick={() => choose(p)}
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <span>ถึง</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}
      {loading && <div className="loading">กำลังโหลด...</div>}

      {!loading && data && (
        <>
          <div className="dash-stat-grid">
            <div className="dash-stat-card dash-stat-highlight">
              <div className="dash-stat-label">ยอดขายรวมทุกสาขา</div>
              <div className="dash-stat-value">฿{baht(data.total.total_revenue)}</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-label">บิลรวม</div>
              <div className="dash-stat-value">{data.total.bill_count.toLocaleString('en-US')}</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-label">คิว/งานรวม</div>
              <div className="dash-stat-value">{data.total.job_count.toLocaleString('en-US')}</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-label">จำนวนสาขา</div>
              <div className="dash-stat-value">{data.branches.length}</div>
            </div>
          </div>

          <div className="dash-panel">
            <div className="dash-panel-title">แยกตามสาขา</div>
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead>
                  <tr>
                    <th>สาขา</th>
                    <th>ยอดขาย</th>
                    <th>บิล</th>
                    <th>ลูกค้า</th>
                    <th>คิว/งาน</th>
                    {methods.map((m) => <th key={m}>{m}</th>)}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.branches.map((b) => (
                    <tr key={b.shop_id}>
                      <td data-label="สาขา">{b.name}{b.status === 'suspended' ? ' (ระงับ)' : ''}</td>
                      <td data-label="ยอดขาย">฿{baht(b.total_revenue)}</td>
                      <td data-label="บิล">{b.bill_count}</td>
                      <td data-label="ลูกค้า">{b.customer_count}</td>
                      <td data-label="คิว/งาน">{b.job_count}</td>
                      {methods.map((m) => (
                        <td key={m} data-label={m}>{b.by_method[m] ? `฿${baht(b.by_method[m].total)}` : '-'}</td>
                      ))}
                      <td className="actions">
                        {b.shop_id !== user.shop_id && b.status === 'active' && (
                          <button type="button" onClick={() => switchShop(b.shop_id)}>เข้าไปดูสาขานี้</button>
                        )}
                        {b.shop_id === user.shop_id && <span className="subtitle">สาขาปัจจุบัน</span>}
                      </td>
                    </tr>
                  ))}
                  <tr className="owner-total-row">
                    <td data-label="สาขา"><strong>รวม</strong></td>
                    <td data-label="ยอดขาย"><strong>฿{baht(data.total.total_revenue)}</strong></td>
                    <td data-label="บิล"><strong>{data.total.bill_count}</strong></td>
                    <td data-label="ลูกค้า">-</td>
                    <td data-label="คิว/งาน"><strong>{data.total.job_count}</strong></td>
                    {methods.map((m) => (
                      <td key={m} data-label={m}><strong>{data.total.by_method[m] ? `฿${baht(data.total.by_method[m].total)}` : '-'}</strong></td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
