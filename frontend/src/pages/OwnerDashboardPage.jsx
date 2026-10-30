import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { foundViaLabel } from '../utils/foundViaChannels';

// ภาพรวมเจ้าของ: numbers only, readable on a phone in 30 seconds. Data from GET /owner-stats/summary
// (backend/src/routes/ownerStats.routes.js). Profit needs the cost of parts, which is not stored yet.

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const baht = (v) => `฿${Math.round(Number(v) || 0).toLocaleString('th-TH')}`;
const count = (v) => (Number(v) || 0).toLocaleString('th-TH');

function monthLabel(key) { // '2026-10' → 'ต.ค. 69'
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${String((y + 543) % 100).padStart(2, '0')}`;
}
function dayLabel(key) { // '2026-10-30' → '30'
  return String(Number(key.slice(8, 10)));
}

// "+12%" / "-5%" against an earlier figure; nothing to compare with = a dash
function Delta({ now, before, label }) {
  if (!before || !now) return <span className="od-delta od-delta-none">{label} —</span>;
  const pct = ((now - before) / before) * 100;
  const up = pct >= 0;
  return (
    <span className={`od-delta ${up ? 'od-delta-up' : 'od-delta-down'}`}>
      {label} {up ? '▲' : '▼'} {Math.abs(Math.round(pct))}%
    </span>
  );
}

function Tile({ title, period, extra }) {
  return (
    <div className="od-tile">
      <div className="od-tile-title">{title}</div>
      <div className="od-tile-num">{baht(period.revenue)}</div>
      <div className="od-tile-sub">{count(period.cars)} คัน · เฉลี่ย {baht(period.avg_per_car)}/คัน</div>
      <div className="od-deltas">{extra}</div>
    </div>
  );
}

function Bars({ rows, labelOf, every = 1 }) {
  const [picked, setPicked] = useState(null);
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  const chosen = rows.find((r) => r.key === picked);
  return (
    <>
      <p className="od-muted od-picked">{chosen ? `${labelOf(chosen)}: ${baht(chosen.revenue)}` : 'แตะแท่งกราฟเพื่อดูยอดเงิน'}</p>
      <div className="od-bars">
        {rows.map((r, i) => (
          <button key={r.key} type="button" className={`od-bar-col ${picked === r.key ? 'picked' : ''}`} onClick={() => setPicked(r.key)} aria-label={`${labelOf(r)} ${baht(r.revenue)}`}>
            <div className="od-bar" style={{ height: `${Math.max(2, (r.revenue / max) * 100)}%` }} />
            <div className="od-bar-label">{i % every === 0 ? labelOf(r) : ''}</div>
          </button>
        ))}
      </div>
    </>
  );
}

export default function OwnerDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [shopId, setShopId] = useState('');
  const [range, setRange] = useState('month');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError('');
    client.get('/owner-stats/summary', { params: shopId ? { shops: shopId } : {} })
      .then((res) => { if (!cancelled) setData(res.data.data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error || 'โหลดไม่สำเร็จ'); });
    return () => { cancelled = true; };
  }, [shopId, reload]);

  // accounting categories that are not shop expenses (e.g. buying parts is already the cost of goods)
  const toggleExcluded = (category) => {
    const current = data.expenses.excluded || [];
    const next = current.includes(category) ? current.filter((c) => c !== category) : [...current, category];
    client.put('/owner-stats/expense-settings', { excluded: next })
      .then(() => setReload((n) => n + 1))
      .catch((err) => setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ'));
  };

  const bars = useMemo(() => {
    if (!data) return [];
    if (range === 'day') return data.series.daily.map((r) => ({ key: r.day, revenue: r.revenue, label: dayLabel(r.day) }));
    if (range === 'year') return data.series.yearly.map((r) => ({ key: String(r.year), revenue: r.revenue, label: String(r.year + 543) }));
    return data.series.monthly.map((r) => ({ key: r.month, revenue: r.revenue, label: monthLabel(r.month) }));
  }, [data, range]);

  if (!data) {
    return <div className="quotation-page">{error ? <div className="error-message">{error}</div> : <div className="loading">กำลังโหลด...</div>}</div>;
  }

  const { periods, forecast, sales, customers, branches, unusual, cost, expenses } = data;
  const currentMonth = forecast.months[0];
  // every category seen in the last 12 months (so one can be left out even in a month without it), this month's total beside it
  const expenseRows = expenses.available
    ? expenses.all_categories
      .map((name) => ({
        category: name,
        total: (expenses.by_category.find((c) => c.category === name) || { total: 0 }).total,
        excluded: expenses.excluded.includes(name),
      }))
      .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, 'th'))
    : [];
  // a trend that has fallen to nothing is not a forecast worth showing
  const notEnough = forecast.confidence === 'none' || forecast.months.every((m) => m.likely === 0);
  const decline = sales.month.decline_reasons;
  const declineMax = Math.max(1, ...decline.map((d) => d.value));

  return (
    <div className="quotation-page od-page">
      <div className="quotation-header">
        <div>
          <h1>ภาพรวม</h1>
          <p className="subtitle">ข้อมูล ณ {data.today}{data.data_since ? ` · มียอดขายในระบบตั้งแต่ ${data.data_since}` : ''}</p>
        </div>
        {data.shops.length > 1 && (
          <select value={shopId} onChange={(e) => setShopId(e.target.value)} aria-label="เลือกสาขา">
            <option value="">ทุกสาขา</option>
            {data.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>
      {error && <div className="error-message">{error}</div>}

      <div className="od-tiles">
        <Tile title="วันนี้" period={periods.today} extra={<Delta now={periods.today.revenue} before={periods.today.previous.revenue} label="เทียบเมื่อวาน" />} />
        <Tile
          title="เดือนนี้"
          period={periods.month}
          extra={(
            <>
              <Delta now={periods.month.revenue} before={periods.month.previous.revenue} label="เทียบเดือนก่อน (วันเดียวกัน)" />
              <Delta now={periods.month.revenue} before={periods.month.last_year.revenue} label="เทียบปีก่อน" />
            </>
          )}
        />
        <Tile title="ปีนี้" period={periods.year} extra={<Delta now={periods.year.revenue} before={periods.year.previous.revenue} label="เทียบปีก่อน (ช่วงเดียวกัน)" />} />
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">กำไรและต้นทุน (เดือนนี้)</div>
        {!cost.available ? (
          <p className="od-muted">ยังไม่มีข้อมูลต้นทุนอะไหล่ จึงยังคำนวณกำไรไม่ได้ จะแสดงเมื่อพนักงานกรอกต้นทุนตอนรับของเข้าสต็อก</p>
        ) : (
          <>
            {cost.deduct_coverage_pct !== null && cost.deduct_coverage_pct < 100 && (
              <p className="od-warn">⚠️ ต้นทุนครอบคลุมแค่ {cost.deduct_coverage_pct}% ของอะไหล่ที่ใช้เดือนนี้ กำไรจึงอาจสูงกว่าความจริง ให้กรอกต้นทุนที่ยังขาด</p>
            )}
            <div className="od-line"><span>กำไรขั้นต้น</span><strong>{baht(cost.gross_profit_month)}{cost.margin_pct !== null ? ` (${cost.margin_pct}%)` : ''}</strong></div>
            <div className="od-line"><span>ต้นทุนอะไหล่ที่ใช้</span><strong>{baht(cost.cogs_month)}</strong></div>
            <div className="od-line"><span>มูลค่าสต็อกคงเหลือ</span><strong>{baht(cost.stock_value)}</strong></div>
            <div className="od-line"><span>ของไม่เคลื่อนไหวเกิน 90 วัน ({count(cost.slow_count)} รายการ)</span><strong>{baht(cost.slow_value)}</strong></div>
            {cost.items_without_cost > 0 && <p className="od-muted">ยังไม่มีต้นทุน {count(cost.items_without_cost)} รายการในสต็อก (ไม่นับในมูลค่าสต็อก)</p>}
            <p className="od-muted">กำไรคิดทั้งเดือน = รายได้ − ต้นทุนของอะไหล่ที่ตัดออกจากสต็อก ไม่ใช่รายบิล</p>
          </>
        )}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">ค่าใช้จ่ายร้าน (จากโปรแกรมบัญชี)</div>
        {!expenses.available ? (
          <p className="od-muted">
            {expenses.reason === 'not_configured'
              ? 'ยังไม่ได้เชื่อมกับโปรแกรมบัญชี'
              : 'อ่านข้อมูลจากโปรแกรมบัญชีไม่ได้ในขณะนี้ ลองใหม่ภายหลัง'}
          </p>
        ) : (
          <>
            <p className="od-big">เดือนนี้ใช้จ่าย <strong>{baht(expenses.month_total)}</strong></p>
            <div className="od-deltas"><Delta now={expenses.month_total} before={expenses.previous_month_same_days_total} label="เทียบเดือนก่อน (วันเดียวกัน)" /></div>
            {expenses.net_profit_month !== null && (
              <div className="od-line">
                <span>กำไรสุทธิเดือนนี้ (กำไรขั้นต้น − ค่าใช้จ่าย)</span>
                <strong className={expenses.net_profit_month < 0 ? 'od-neg' : ''}>{baht(expenses.net_profit_month)}</strong>
              </div>
            )}
            <div className="od-subtitle">หมวดค่าใช้จ่าย ยอดเดือนนี้ (ติ๊ก "ไม่นับ" ถ้าไม่ใช่ค่าใช้จ่ายร้าน เช่น ซื้ออะไหล่ ที่นับเป็นต้นทุนอะไหล่แล้ว)</div>
            {expenseRows.length === 0 ? <div className="empty-message">ยังไม่มีรายการค่าใช้จ่าย</div> : expenseRows.map((c) => (
              <label key={c.category} className={`od-line od-check ${c.excluded ? 'od-off' : ''}`}>
                <span><input type="checkbox" checked={c.excluded} onChange={() => toggleExcluded(c.category)} /> ไม่นับ · {c.category}</span>
                <strong>{baht(c.total)}</strong>
              </label>
            ))}
            <div className="od-subtitle">ค่าใช้จ่าย 12 เดือน</div>
            <Bars rows={expenses.series.map((r) => ({ key: r.month, revenue: r.total }))} labelOf={(r) => monthLabel(r.key)} />
            <p className="od-muted">ยอดนี้เป็นของทั้งธุรกิจตามที่บันทึกในโปรแกรมบัญชี ไม่แยกสาขา</p>
          </>
        )}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">คาดการณ์ยอดขาย</div>
        {forecast.confidence === 'low' && !notEnough && (
          <p className="od-warn">⚠️ คำนวณจากข้อมูลแค่ {forecast.months_used} เดือน ยังน้อย ตัวเลขอาจเปลี่ยนมาก</p>
        )}
        {notEnough ? (
          <p className="od-big">ยังคาดการณ์ไม่ได้ <span className="od-muted">— {forecast.confidence === 'none' ? 'ข้อมูลย้อนหลังยังไม่พอ' : 'แนวโน้มยอดขายที่ผ่านมายังไม่นิ่งพอ'}</span></p>
        ) : (
          <>
            {currentMonth && (
              <p className="od-big">
                เดือนนี้ถ้าขายเท่านี้ต่อไป จะปิดที่ <strong>{baht(currentMonth.likely)}</strong>
                <span className="od-muted"> (ช่วงที่น่าจะเป็น {baht(currentMonth.low)} – {baht(currentMonth.high)})</span>
              </p>
            )}
            {forecast.year_end && (
              <p className="od-big">ทั้งปีนี้ประมาณ <strong>{baht(forecast.year_end.likely)}</strong> <span className="od-muted">({baht(forecast.year_end.low)} – {baht(forecast.year_end.high)})</span></p>
            )}
            {forecast.months.length > 1 && (
              <div className="od-forecast-rows">
                {forecast.months.slice(1).map((m) => (
                  <div key={m.month} className="od-line"><span>{monthLabel(m.month)}</span><strong>{baht(m.likely)}</strong><span className="od-muted">{baht(m.low)} – {baht(m.high)}</span></div>
                ))}
              </div>
            )}
          </>
        )}
        <p className="od-muted">
          {forecast.confidence === 'none' && `มีข้อมูลเต็มเดือนแค่ ${forecast.months_used} เดือน ต้องมีอย่างน้อย 3 เดือนถึงจะคาดการณ์แนวโน้มได้`}
          {forecast.confidence !== 'none' && !notEnough && `คำนวณจากแนวโน้มย้อนหลัง ${forecast.months_used} เดือน ยังไม่ได้ปรับตามฤดูกาล ช่วงตัวเลขคือโอกาสราว 80%`}
        </p>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">ยอดขาย</div>
        <div className="od-tabs">
          {[['day', '30 วัน'], ['month', '12 เดือน'], ['year', 'รายปี']].map(([key, label]) => (
            <button key={key} type="button" className={`od-tab ${range === key ? 'active' : ''}`} onClick={() => setRange(key)}>{label}</button>
          ))}
        </div>
        {bars.length === 0 ? <div className="empty-message">ยังไม่มีข้อมูล</div> : <Bars key={range} rows={bars} labelOf={(r) => r.label} every={range === 'day' ? 5 : 1} />}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">การปิดการขายเดือนนี้</div>
        {sales.month.close_rate_value === null ? <div className="empty-message">ยังไม่มีใบเสนอราคาเดือนนี้</div> : (
          <>
            <p className="od-big">
              ลูกค้าอนุมัติ <strong>{sales.month.close_rate_value}%</strong> ของมูลค่าที่เสนอ
              <span className="od-muted"> ({baht(sales.month.approved_value)} จาก {baht(sales.month.offered_value)})</span>
            </p>
            {sales.previous_month.close_rate_value !== null && <p className="od-muted">เดือนก่อน {sales.previous_month.close_rate_value}%</p>}
          </>
        )}
        {decline.length > 0 && (
          <>
            <div className="od-subtitle">เหตุผลที่ลูกค้าไม่ซ่อม (ตามมูลค่า)</div>
            {decline.map((d) => (
              <div key={d.reason} className="od-hbar">
                <span>{d.reason} ({d.count})</span>
                <div className="od-hbar-track"><div className="od-hbar-fill" style={{ width: `${(d.value / declineMax) * 100}%` }} /></div>
                <strong>{baht(d.value)}</strong>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">ลูกค้า (เดือนนี้)</div>
        <div className="od-line"><span>ลูกค้าที่มาใช้บริการ</span><strong>{count(customers.active)} คน</strong></div>
        <div className="od-line"><span>ลูกค้าใหม่ / กลับมาซ้ำ</span><strong>{count(customers.new)} / {count(customers.returning)}</strong></div>
        <div className="od-line"><span>เคลม</span><strong>{count(customers.claims)} ครั้ง{customers.claim_rate !== null ? ` (${customers.claim_rate}% ของรถที่ทำ)` : ''}</strong></div>
        <div className="od-subtitle">ลูกค้ามาจากช่องทางไหน เทียบยอดขาย</div>
        {customers.channels.length === 0 ? <div className="empty-message">ยังไม่มีข้อมูล</div> : customers.channels.map((c) => (
          <div key={c.channel} className="od-line">
            <span>{c.channel === 'unknown' ? 'ยังไม่ระบุ' : foundViaLabel(c.channel)} ({count(c.customers)} คน)</span>
            <strong>{baht(c.revenue)}</strong>
          </div>
        ))}
        <p className="od-muted">ถ้ากรอกงบโฆษณาของแต่ละช่องทาง จะดูได้ว่าได้ลูกค้าหนึ่งคนในราคาเท่าไร</p>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">ขายดีเดือนนี้</div>
        <div className="od-subtitle">สินค้า/บริการ</div>
        {data.top_items.length === 0 ? <div className="empty-message">ยังไม่มีข้อมูล</div> : data.top_items.map((i) => (
          <div key={i.name} className="od-line"><span>{i.name} ({count(i.qty)})</span><strong>{baht(i.revenue)}</strong></div>
        ))}
        <div className="od-subtitle">ยี่ห้อรถ</div>
        {data.top_brands.map((b) => (
          <div key={b.brand} className="od-line"><span>{b.brand} ({count(b.cars)} คัน)</span><strong>{baht(b.revenue)}</strong></div>
        ))}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">เทียบสาขา (เดือนนี้)</div>
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead><tr><th>สาขา</th><th>รายได้</th><th>เทียบเดือนก่อน</th><th>รถ</th><th>เฉลี่ย/คัน</th></tr></thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.shop_id}>
                  <td data-label="สาขา">{b.name}</td>
                  <td data-label="รายได้"><strong>{baht(b.revenue)}</strong></td>
                  <td data-label="เทียบเดือนก่อน"><Delta now={b.revenue} before={b.revenue_prev} label="" /></td>
                  <td data-label="รถ">{count(b.cars)}</td>
                  <td data-label="เฉลี่ย/คัน">{baht(b.avg_per_car)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link to="/owner/overview" className="btn btn-secondary">เทียบรายวันแยกเงินสด/โอน</Link>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">สัญญาณผิดปกติ (เดือนนี้)</div>
        {unusual.discount_bills === 0 && unusual.deleted.length === 0 && unusual.stock_adjustments.length === 0 && (
          <p className="od-muted">✅ ไม่พบความผิดปกติในเดือนนี้</p>
        )}
        <details>
          <summary>ส่วนลด {count(unusual.discount_bills)} บิล รวม {baht(Math.abs(unusual.discount_total))}</summary>
          {unusual.discounts.map((d, i) => <div key={i} className="od-line"><span>{d.receipt_no} · {d.day} · {d.name}</span><strong>{baht(d.amount)}</strong></div>)}
        </details>
        <details>
          <summary>บิล/ใบเสนอราคาที่ถูกลบ {count(unusual.deleted.length)} รายการ</summary>
          {unusual.deleted.map((d, i) => (
            <div key={i} className="od-line"><span>{d.label} · {d.at} · {d.deleted_by_name || '-'}</span><span className="od-muted">{d.restored ? 'กู้คืนแล้ว' : 'ยังถูกลบ'}</span></div>
          ))}
        </details>
        <details>
          <summary>ปรับสต็อกด้วยมือ {count(unusual.stock_adjustments.length)} ครั้ง</summary>
          {unusual.stock_adjustments.map((a, i) => (
            <div key={i} className="od-line"><span>{a.oem_code} · {a.at} · {a.full_name}</span><strong>{a.qty_before} → {a.qty_after}</strong></div>
          ))}
        </details>
      </div>
    </div>
  );
}
