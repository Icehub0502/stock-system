import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import { hasRole } from "../utils/roles";
import PaymentBreakdown from "../components/PaymentBreakdown";
import { methodsFromObject, mergeByMethod } from "../utils/paymentMethods";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatBaht(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatShortBaht(value) {
  const n = Number(value || 0);
  if (n >= 1000) return `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function formatThaiDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

const QUOTATION_STATUS_LABEL = { pending: 'รอดำเนินการ', scheduled: 'นัดหมายแล้ว' };

// Builds a full 14-day calendar range (oldest→newest) so a day with zero sales
// shows as an empty bar instead of silently disappearing from the chart.
function buildTrendDays(dailyRows, days = 14) {
  const byDate = new Map(dailyRows.map((r) => [r.date, r]));
  const result = [];
  const cursor = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const row = byDate.get(dateStr);
    result.push({ date: dateStr, total_revenue: Number(row?.total_revenue ?? 0) });
  }
  return result;
}

const QUICK_LINKS = [
  { to: "/receipt-list", label: "+ สร้างบิลใหม่" },
  { to: "/quotations", label: "+ สร้างใบเสนอราคา" },
  { to: "/stock-all", label: "สต๊อกรวม" },
  { to: "/daily-summary", label: "สรุปยอดขายรายวัน", min: "manager" },
];

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  // sales figures (revenue, payment channels, best sellers) are for managers and above;
  // office staff get the same page without those parts (the API refuses them anyway)
  const { user } = useAuth();
  const canSeeSales = hasRole(user, 'manager');
  const [todaySummary, setTodaySummary] = useState({ bill_count: 0, customer_count: 0, total_revenue: 0 });
  const [todayMethods, setTodayMethods] = useState([]);
  const [monthMethods, setMonthMethods] = useState([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [topVehicleModels, setTopVehicleModels] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [recentReceipts, setRecentReceipts] = useState([]);
  const [revenueTrend, setRevenueTrend] = useState([]);
  const [pendingQuotations, setPendingQuotations] = useState([]);
  const [todayAppointments, setTodayAppointments] = useState([]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      canSeeSales ? client.get('/receipts/daily-summary').catch(() => ({ data: { data: [] } })) : Promise.resolve({ data: { data: [] } }),
      client.get('/stock-items').catch(() => ({ data: [] })),
      client.get('/receipts').catch(() => ({ data: { data: [] } })),
      canSeeSales ? client.get('/receipts/top-products', { params: { days: 30, limit: 5 } }).catch(() => ({ data: { data: [] } })) : Promise.resolve({ data: { data: [] } }),
      canSeeSales ? client.get('/receipts/top-vehicle-models', { params: { limit: 10 } }).catch(() => ({ data: { data: [] } })) : Promise.resolve({ data: { data: [] } }),
      canSeeSales ? client.get('/receipts/top-customers', { params: { limit: 10 } }).catch(() => ({ data: { data: [] } })) : Promise.resolve({ data: { data: [] } }),
      client.get('/quotations').catch(() => ({ data: { data: [] } })),
    ]).then(([summaryRes, stockRes, receiptsRes, topProductsRes, topVehicleModelsRes, topCustomersRes, quotationsRes]) => {
      if (cancelled) return;

      const dailyRows = summaryRes.data.data || [];
      const today = todayStr();
      const todayRow = dailyRows.find((r) => r.date === today);
      setTodaySummary({
        bill_count: Number(todayRow?.bill_count ?? 0),
        customer_count: Number(todayRow?.customer_count ?? 0),
        total_revenue: Number(todayRow?.total_revenue ?? 0),
      });

      setTodayMethods(methodsFromObject(todayRow?.by_method));
      setMonthMethods(methodsFromObject(mergeByMethod(
        dailyRows.filter((r) => String(r.date).slice(0, 7) === today.slice(0, 7)).map((r) => r.by_method)
      )));

      setRevenueTrend(buildTrendDays(dailyRows, 14));

      // สต๊อกรวม: ใกล้หมด/หมด = ยอดรวม ≤ ยอดขั้นต่ำของรายการนั้น
      const lowItems = (stockRes.data || [])
        .filter((r) => Number(r.stock_qty) <= Number(r.min_stock))
        .map((r) => ({ ...r, kind: r.category_name, name: r.description || r.oem_code }));
      setLowStockCount(lowItems.length);
      setLowStockItems(lowItems);

      setTopProducts(topProductsRes.data.data || []);
      setTopVehicleModels(topVehicleModelsRes.data.data || []);
      setTopCustomers(topCustomersRes.data.data || []);
      setRecentReceipts((receiptsRes.data.data || []).slice(0, 5));
      const allQuotations = quotationsRes.data.data || [];
      setPendingQuotations(
        allQuotations
          .filter((q) => q.status !== 'approved')
          .sort((a, b) => new Date(a.quotation_date) - new Date(b.quotation_date))
          .slice(0, 10)
      );
      // Appointments scheduled for today should "pop up" automatically so
      // staff can't miss a customer who's due in — surfaced in its own
      // panel above the general pending list.
      setTodayAppointments(
        allQuotations.filter((q) => q.status === 'scheduled' && q.scheduled_date === today)
      );
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>แดชบอร์ด</h1>
          <p className="subtitle">ภาพรวมยอดขายและสต๊อกวันนี้</p>
        </div>
      </div>

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : (
        <>
          {/* ── Stat cards ── */}
          <div className="dash-stat-grid">
            <div className="dash-stat-card">
              <div className="dash-stat-label">บิลวันนี้</div>
              <div className="dash-stat-value">{todaySummary.bill_count.toLocaleString('en-US')}</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-label">ลูกค้าวันนี้</div>
              <div className="dash-stat-value">{todaySummary.customer_count.toLocaleString('en-US')}</div>
            </div>
            {canSeeSales && (
              <div className="dash-stat-card dash-stat-highlight">
                <div className="dash-stat-label">ยอดขายวันนี้</div>
                <div className="dash-stat-value">฿{formatBaht(todaySummary.total_revenue)}</div>
              </div>
            )}
            <div className="dash-stat-card">
              <div className="dash-stat-label">สต๊อกใกล้หมด/หมด</div>
              <div className="dash-stat-value">{lowStockCount.toLocaleString('en-US')}</div>
            </div>
          </div>

          {canSeeSales && <PaymentBreakdown title="ยอดวันนี้ แยกตามช่องทางชำระ" items={todayMethods} />}
          {canSeeSales && <PaymentBreakdown title="ยอดเดือนนี้ แยกตามช่องทางชำระ" items={monthMethods} />}

          {/* ── Today's scheduled appointments — surfaced prominently so staff
              can't miss a customer who's due in today ── */}
          {todayAppointments.length > 0 && (
            <div className="dash-panel dash-panel-alert">
              <div className="dash-panel-title">🔔 นัดหมายวันนี้ ({todayAppointments.length})</div>
              <div className="dash-list">
                {todayAppointments.map((q) => (
                  <Link key={q.id} to="/quotations" className="dash-list-row dash-list-row-link">
                    <div>
                      <span className="dash-list-code">{q.quotation_no}</span>
                      <span className="dash-list-name">
                        {q.customer_name}
                        {q.queue_no ? ` · คิว ${q.queue_no}` : ''}
                      </span>
                    </div>
                    <span className="dash-amount">฿{formatBaht(q.total_amount)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* ── Revenue trend (last 14 days) ── */}
          {canSeeSales && (
          <div className="dash-panel">
            <div className="dash-panel-title">ยอดขายย้อนหลัง 14 วัน</div>
            {revenueTrend.every((r) => Number(r.total_revenue) === 0) || revenueTrend.length === 0 ? (
              <div className="dash-empty">ยังไม่มีข้อมูลยอดขาย</div>
            ) : (
              <div className="dash-trend-chart">
                {revenueTrend.map((r) => {
                  const max = Math.max(...revenueTrend.map((x) => Number(x.total_revenue || 0)), 1);
                  const pct = Math.max(Number(r.total_revenue || 0) / max * 100, 2);
                  return (
                    <div key={r.date} className="dash-trend-bar-wrap" title={`${formatThaiDate(r.date)}: ฿${formatBaht(r.total_revenue)}`}>
                      <span className="dash-trend-value">{formatShortBaht(r.total_revenue)}</span>
                      <div className="dash-trend-bar" style={{ height: `${pct}%` }} />
                      <span className="dash-trend-label">{formatShortDate(r.date)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          <div className="dash-columns">
            {/* ── Top selling products (last 30 days) ── */}
            {canSeeSales && (
            <div className="dash-panel">
              <div className="dash-panel-title">สินค้าขายดี 5 อันดับแรก (30 วันล่าสุด)</div>
              {topProducts.length === 0 ? (
                <div className="dash-empty">ยังไม่มีข้อมูลการขาย</div>
              ) : (
                <div className="dash-list">
                  {topProducts.map((p, idx) => (
                    <div key={p.product_name} className="dash-list-row">
                      <div className="dash-rank-row">
                        <span className="dash-rank-badge">{idx + 1}</span>
                        <span className="dash-list-name">{p.product_name}</span>
                      </div>
                      <span className="dash-qty-badge sold">{Number(p.total_qty).toLocaleString('en-US')} ชิ้น</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* ── Recent receipts ── */}
            <div className="dash-panel">
              <div className="dash-panel-title">บิลล่าสุด</div>
              {recentReceipts.length === 0 ? (
                <div className="dash-empty">ยังไม่มีบิล</div>
              ) : (
                <div className="dash-list">
                  {recentReceipts.map((r) => (
                    <div key={r.id} className="dash-list-row">
                      <div>
                        <span className="dash-list-code">{r.receipt_no}</span>
                        <span className="dash-list-name">{r.customer_name}</span>
                      </div>
                      <span className="dash-amount">฿{formatBaht(r.total_amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="dash-columns">
            {/* ── Top customers ── */}
            {canSeeSales && (
            <div className="dash-panel">
              <div className="dash-panel-title">ลูกค้ายอดเยี่ยม 10 อันดับแรก</div>
              {topCustomers.length === 0 ? (
                <div className="dash-empty">ยังไม่มีข้อมูลลูกค้า</div>
              ) : (
                <div className="dash-list">
                  {topCustomers.map((c, idx) => (
                    <div key={c.customer_id} className="dash-list-row">
                      <div className="dash-rank-row">
                        <span className="dash-rank-badge">{idx + 1}</span>
                        <span className="dash-list-name">{c.customer_name} · {c.bill_count} บิล</span>
                      </div>
                      <span className="dash-amount">฿{formatBaht(c.total_spent)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* ── Pending quotations ── */}
            <div className="dash-panel">
              <div className="dash-panel-title">ใบเสนอราคาที่ยังไม่ปิดงาน</div>
              {pendingQuotations.length === 0 ? (
                <div className="dash-empty">ไม่มีใบเสนอราคาค้างอยู่</div>
              ) : (
                <div className="dash-list">
                  {pendingQuotations.map((q) => (
                    <div key={q.id} className="dash-list-row">
                      <div>
                        <span className="dash-list-code">{q.quotation_no}</span>
                        <span className="dash-list-name">{q.customer_name}</span>
                      </div>
                      <span className="dash-qty-badge zero">{QUOTATION_STATUS_LABEL[q.status] || q.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Most frequent vehicle models ── */}
          {canSeeSales && (
          <div className="dash-panel">
            <div className="dash-panel-title">รถที่เข้ามาทำบ่อยที่สุด 10 อันดับแรก</div>
            {topVehicleModels.length === 0 ? (
              <div className="dash-empty">ยังไม่มีข้อมูล</div>
            ) : (
              <div className="dash-rank-grid">
                {topVehicleModels.map((v, idx) => (
                  <div key={`${v.brand}-${v.model}`} className="dash-list-row">
                    <div className="dash-rank-row">
                      <span className="dash-rank-badge">{idx + 1}</span>
                      <span className="dash-list-name">{v.brand} {v.model}</span>
                    </div>
                    <span className="dash-qty-badge visit">{Number(v.visit_count).toLocaleString('en-US')} ครั้ง</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {/* ── Low stock detail ── */}
          <div className="dash-panel">
            <div className="dash-panel-title">รายการสต๊อกใกล้หมด/หมด ({lowStockCount})</div>
            {lowStockItems.length === 0 ? (
              <div className="dash-empty">สต๊อกทุกรายการยังเพียงพอ</div>
            ) : (
              <div className="dash-rank-grid">
                {lowStockItems.map((item) => (
                  <div key={`${item.kind}-${item.id}`} className="dash-list-row">
                    <div>
                      <span className="dash-list-code">{item.kind}</span>
                      <span className="dash-list-name">{item.name || item.product_name}</span>
                    </div>
                    <span className={`dash-qty-badge ${Number(item.stock_qty) <= 0 ? 'zero' : ''}`}>
                      {item.stock_qty}/{item.min_stock}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Quick links ── */}
          <div className="dash-panel">
            <div className="dash-panel-title">ทางลัด</div>
            <div className="dash-quicklinks">
              {QUICK_LINKS.filter((l) => !l.min || hasRole(user, l.min)).map((l) => (
                <Link key={l.to} to={l.to} className="dash-quicklink-btn">
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
