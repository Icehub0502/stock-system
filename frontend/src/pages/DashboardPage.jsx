import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatBaht(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const QUICK_LINKS = [
  { to: "/receipt-list", label: "+ สร้างบิลใหม่" },
  { to: "/quotations", label: "+ สร้างใบเสนอราคา" },
  { to: "/stock-rack", label: "จัดการสต็อกแร็ค (StockRack)" },
  { to: "/wing-arms", label: "จัดการสต็อกปีกนก" },
  { to: "/daily-summary", label: "สรุปยอดขายรายวัน" },
];

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [todaySummary, setTodaySummary] = useState({ bill_count: 0, customer_count: 0, total_revenue: 0 });
  const [lowStockItems, setLowStockItems] = useState([]);
  const [recentReceipts, setRecentReceipts] = useState([]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      client.get('/receipts/daily-summary').catch(() => ({ data: { data: [] } })),
      client.get('/racks').catch(() => ({ data: [] })),
      client.get('/wing-arms').catch(() => ({ data: [] })),
      client.get('/receipts').catch(() => ({ data: { data: [] } })),
    ]).then(([summaryRes, racksRes, wingArmsRes, receiptsRes]) => {
      if (cancelled) return;

      const today = todayStr();
      const todayRow = (summaryRes.data.data || []).find((r) => r.date === today);
      setTodaySummary({
        bill_count: Number(todayRow?.bill_count ?? 0),
        customer_count: Number(todayRow?.customer_count ?? 0),
        total_revenue: Number(todayRow?.total_revenue ?? 0),
      });

      const lowRacks = (racksRes.data || [])
        .filter((r) => r.stock_qty <= r.min_stock)
        .map((r) => ({ id: `rack-${r.id}`, code: r.model_code, name: r.name, qty: r.stock_qty, type: 'แร็ค' }));
      const lowWingArms = (wingArmsRes.data || [])
        .filter((r) => r.stock_qty <= r.min_stock)
        .map((r) => ({ id: `wa-${r.id}`, code: r.sku, name: r.name, qty: r.stock_qty, type: 'ปีกนก' }));
      setLowStockItems(
        [...lowRacks, ...lowWingArms].sort((a, b) => a.qty - b.qty).slice(0, 8)
      );

      setRecentReceipts((receiptsRes.data.data || []).slice(0, 5));
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
          <p className="subtitle">ภาพรวมยอดขายและสต็อกวันนี้</p>
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
            <div className="dash-stat-card dash-stat-highlight">
              <div className="dash-stat-label">ยอดขายวันนี้</div>
              <div className="dash-stat-value">฿{formatBaht(todaySummary.total_revenue)}</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-label">สต็อกใกล้หมด/หมด</div>
              <div className="dash-stat-value">{lowStockItems.length.toLocaleString('en-US')}</div>
            </div>
          </div>

          <div className="dash-columns">
            {/* ── Low stock alerts ── */}
            <div className="dash-panel">
              <div className="dash-panel-title">แจ้งเตือนสต็อกใกล้หมด/หมด</div>
              {lowStockItems.length === 0 ? (
                <div className="dash-empty">สต็อกปกติทุกรายการ</div>
              ) : (
                <div className="dash-list">
                  {lowStockItems.map((item) => (
                    <div key={item.id} className="dash-list-row">
                      <div>
                        <span className="dash-list-code">{item.code}</span>
                        <span className="dash-list-name">{item.name}</span>
                      </div>
                      <span className={`dash-qty-badge ${item.qty === 0 ? 'zero' : ''}`}>
                        {item.type} · {item.qty}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

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

          {/* ── Quick links ── */}
          <div className="dash-panel">
            <div className="dash-panel-title">ทางลัด</div>
            <div className="dash-quicklinks">
              {QUICK_LINKS.map((l) => (
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
