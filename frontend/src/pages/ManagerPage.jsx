import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { formatMoney } from '../utils/format';
import { formatDateTh } from '../utils/dateGroups';

// หน้าผู้จัดการสาขา: what needs a decision today. Data from GET /manager/today (backend/src/routes/manager.routes.js).
// Red = a car in the shop longer than the limit or past its booked day; every row opens the thing to act on.

const REFRESH_MS = 60000;

function carTitle(c) {
  return `${c.license_plate || 'ไม่มีทะเบียน'} · ${c.brand || ''} ${c.model || ''}`.trim();
}

function Phone({ phone }) {
  if (!phone) return null;
  return <a className="mg-phone" href={`tel:${phone}`}>โทร {phone}</a>;
}

// "วันนี้" instead of "0 วันที่แล้ว"
const ageText = (days) => (days === 0 ? 'วันนี้' : `${days} วันที่แล้ว`);

function CarRow({ car, stuckDays }) {
  return (
    <Link to={`/jobs/${car.id}`} className={`mg-row ${car.overdue ? 'mg-row-red' : ''}`}>
      <div className="mg-row-main">
        <strong>{carTitle(car)}</strong>
        <span className="mg-muted">{car.customer_name || '-'}{car.symptom ? ` · ${car.symptom}` : ''}</span>
      </div>
      <div className="mg-row-side">
        {car.overdue_reason === 'late_appointment' && <span className="mg-flag">เลยวันนัด {formatDateTh(car.scheduled_date)}</span>}
        {car.overdue_reason === 'stuck' && <span className="mg-flag">จอด {car.days_in_shop} วัน (เกิน {stuckDays})</span>}
        {!car.overdue && car.status !== 'scheduled' && <span className="mg-muted">{car.days_in_shop === 0 ? 'วันนี้' : `${car.days_in_shop} วัน`}</span>}
        {car.bay && <span className="mg-muted">ช่อง {car.bay}</span>}
      </div>
    </Link>
  );
}

export default function ManagerPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    client.get('/manager/today')
      .then((res) => { setData(res.data.data); setError(''); })
      .catch((err) => setError(err.response?.data?.error || 'โหลดไม่สำเร็จ'));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!data) {
    return <div className="quotation-page">{error ? <div className="error-message">{error}</div> : <div className="loading">กำลังโหลด...</div>}</div>;
  }

  const { cars, chase, money, deposits, stock } = data;
  const waiting = chase.items.filter((q) => q.kind === 'waiting');
  const later = chase.items.filter((q) => q.kind === 'later');

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>หน้าผู้จัดการ</h1>
          <p className="subtitle">{formatDateTh(data.today)} · อัปเดตอัตโนมัติทุกนาที</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load}>รีเฟรช</button>
      </div>
      {error && <div className="error-message">{error}</div>}

      <div className="mg-tiles">
        <div className={`mg-tile ${cars.overdue_count > 0 ? 'mg-tile-red' : ''}`}>
          <span className="mg-tile-num">{cars.overdue_count}</span><span>คันเกินเวลา</span>
        </div>
        <div className="mg-tile"><span className="mg-tile-num">{cars.in_shop}</span><span>รถในอู่</span></div>
        <div className="mg-tile"><span className="mg-tile-num">฿{formatMoney(money.total)}</span><span>ปิดบิลวันนี้ ({money.bill_count} ใบ)</span></div>
        <div className="mg-tile"><span className="mg-tile-num">฿{formatMoney(chase.total_value)}</span><span>รอตามขาย ({chase.items.length} ใบ)</span></div>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">รถในอู่ตอนนี้ ({cars.in_shop} คัน{cars.total > cars.in_shop ? ` + นัดมาทำ ${cars.total - cars.in_shop}` : ''})</div>
        {cars.total === 0 ? <div className="empty-message">ไม่มีรถในอู่</div> : cars.groups.filter((g) => g.cars.length > 0).map((g) => (
          <div key={g.key} className="mg-group">
            <div className="mg-group-title">{g.label} <span className="mg-count">{g.cars.length}</span></div>
            {g.cars.map((c) => <CarRow key={c.id} car={c} stuckDays={data.stuck_days} />)}
          </div>
        ))}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">ใบเสนอราคาที่ต้องตาม (฿{formatMoney(chase.total_value)})</div>
        {chase.items.length === 0 ? <div className="empty-message">ไม่มีรายการค้าง</div> : (
          <>
            {[['ลูกค้ายังไม่ตอบ', waiting], ['ลูกค้า "ขอไว้ก่อน" โทรตามขายต่อได้', later]].map(([title, list]) => list.length > 0 && (
              <div key={title} className="mg-group">
                <div className="mg-group-title">{title} <span className="mg-count">{list.length}</span></div>
                {list.map((q) => (
                  <div key={q.id} className="mg-row">
                    <div className="mg-row-main">
                      <strong>{carTitle(q)}</strong>
                      <span className="mg-muted">{q.customer_name || '-'} · {q.quotation_no} · {ageText(q.age_days)}{q.decline_label ? ` · ${q.decline_label}` : ''}</span>
                    </div>
                    <div className="mg-row-side">
                      <strong>฿{formatMoney(q.total_amount)}</strong>
                      <Phone phone={q.phone} />
                      <Link className="mg-open" to={q.kind === 'later' ? '/quotations/declined-summary' : `/quotations?q=${encodeURIComponent(q.quotation_no)}`}>เปิดดู</Link>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <Link to="/quotations" className="btn btn-secondary">เปิดรายการใบเสนอราคา</Link>
          </>
        )}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">เงินวันนี้ ฿{formatMoney(money.total)}</div>
        {money.by_method.length === 0 ? <div className="empty-message">ยังไม่มีบิลที่ปิดวันนี้</div> : money.by_method.map((m) => (
          <div key={m.method} className="mg-line"><span>{m.method} ({m.bill_count} ใบ)</span><strong>฿{formatMoney(m.total)}</strong></div>
        ))}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">มัดจำที่รับไว้ ยังไม่ปิดงาน (฿{formatMoney(deposits.total)})</div>
        {deposits.items.length === 0 ? <div className="empty-message">ไม่มีมัดจำค้าง</div> : deposits.items.map((d) => (
          <div key={d.id} className="mg-row">
            <div className="mg-row-main">
              <strong>{carTitle(d)}</strong>
              <span className="mg-muted">{d.customer_name || '-'} · {d.quotation_no}{d.deposit_date ? ` · รับ ${formatDateTh(d.deposit_date)}` : ''}</span>
            </div>
            <div className="mg-row-side">
              <strong>฿{formatMoney(d.deposit_amount)}</strong>
              <Phone phone={d.phone} />
              <Link className="mg-open" to={`/quotations?q=${encodeURIComponent(d.quotation_no)}`}>เปิดดู</Link>
            </div>
          </div>
        ))}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">อะไหล่ถึงจุดสั่งซื้อ ({stock.low_count} รายการ)</div>
        {stock.items.length === 0 ? <div className="empty-message">ของยังพอทุกรายการ</div> : (
          <>
            {stock.items.map((i) => (
              <div key={i.id} className="mg-line">
                <span>{i.category ? `${i.category} · ` : ''}{i.oem_code}{i.description ? ` ${i.description}` : ''}</span>
                <strong className={i.stock_qty <= 0 ? 'mg-out' : ''}>เหลือ {i.stock_qty} / ขั้นต่ำ {i.min_stock}</strong>
              </div>
            ))}
            <Link to="/stock-all" className="btn btn-secondary">ไปหน้าสต็อก</Link>
          </>
        )}
      </div>

    </div>
  );
}
