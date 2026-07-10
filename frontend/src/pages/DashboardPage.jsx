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
  const [lowStockCount, setLowStockCount] = useState(0);
  const [topProducts, setTopProducts] = useState([]);
  const [topVehicleModels, setTopVehicleModels] = useState([]);
  const [recentReceipts, setRecentReceipts] = useState([]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      client.get('/receipts/daily-summary').catch(() => ({ data: { data: [] } })),
      client.get('/racks').catch(() => ({ data: [] })),
      client.get('/wing-arms').catch(() => ({ data: [] })),
      client.get('/receipts').catch(() => ({ data: { data: [] } })),
      client.get('/receipts/top-products', { params: { days: 30, limit: 5 } }).catch(() => ({ data: { data: [] } })),
      client.get('/receipts/top-vehicle-models', { params: { limit: 10 } }).catch(() => ({ data: { data: [] } })),
    ]).then(([summaryRes, racksRes, wingArmsRes, receiptsRes, topProductsRes, topVehicleModelsRes]) => {
      if (cancelled) return;

      const today = todayStr();
      const todayRow = (summaryRes.data.data || []).find((r) => r.date === today);
      setTodaySummary({
        bill_count: Number(todayRow?.bill_count ?? 0),
        customer_count: Number(todayRow?.customer_count ?? 0),
        total_revenue: Number(todayRow?.total_revenue ?? 0),
      });

      const lowRacksCount = (racksRes.data || []).filter((r) => r.stock_qty <= r.min_stock).length;
      const lowWingArmsCount = (wingArmsRes.data || []).filter((r) => r.stock_qty <= r.min_stock).length;
      setLowStockCount(lowRacksCount + lowWingArmsCount);

      setTopProducts(topProductsRes.data.data || []);
      setTopVehicleModels(topVehicleModelsRes.data.data || []);
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
              <div className="dash-stat-value">{lowStockCount.toLocaleString('en-US')}</div>
            </div>
          </div>

          <div className="dash-columns">
            {/* ── Top selling products (last 30 days) ── */}
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

          {/* ── Most frequent vehicle models ── */}
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
