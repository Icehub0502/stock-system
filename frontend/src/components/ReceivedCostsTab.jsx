// components/ReceivedCostsTab.jsx
// Read-only view of what stock items cost according to this branch's receive bills
// (the cost per piece typed on บิลรับเข้า), shown as a tab of the product cost page.
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";

const API = "/product-costs/received";
const PAGE_SIZE = 50;

const baht = (n) =>
  n == null ? "-" : `฿${Number(n).toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;

const thaiDate = (ymd) => {
  if (!ymd) return "-";
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
};

const FILTERS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "with", label: "มีต้นทุนแล้ว" },
  { key: "without", label: "ยังไม่มีต้นทุน" },
];

function HistoryModal({ item, onClose }) {
  const [lines, setLines] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    client.get(`${API}/${item.id}/lines`)
      .then((res) => { if (alive) setLines(res.data.data || []); })
      .catch((err) => { if (alive) setError(err.response?.data?.message || "โหลดประวัติราคาไม่สำเร็จ"); });
    return () => { alive = false; };
  }, [item.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pcp-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pcp-modal-box" role="dialog" aria-modal="true" aria-labelledby="rct-history-title">
        <div className="pcp-modal-header">
          <h3 id="rct-history-title">ประวัติราคารับเข้า</h3>
          <button className="pcp-modal-close" onClick={onClose} aria-label="ปิด">✕</button>
        </div>
        <div className="pcp-modal-body">
          <p className="rct-history-item">
            {item.oem_code && <span className="pcp-parts-badge">{item.oem_code}</span>} {item.description}
          </p>
          <p className="rct-muted">ต้นทุนเฉลี่ย {baht(item.avg_cost)} (เฉลี่ยตามจำนวนชิ้นจากบิลที่มีต้นทุน)</p>
          {error ? (
            <div className="pcp-empty">{error}</div>
          ) : lines === null ? (
            <div className="pcp-loading">กำลังโหลด...</div>
          ) : lines.length === 0 ? (
            <div className="pcp-empty">ยังไม่มีบิลรับเข้าของสินค้านี้</div>
          ) : (
            <div className="pcp-table-wrap">
              <table className="pcp-table rct-history-table">
                <thead>
                  <tr>
                    <th>วันที่บิล</th>
                    <th>ร้านที่ซื้อ</th>
                    <th>เลขบิล</th>
                    <th className="pcp-col-price">จำนวน</th>
                    <th className="pcp-col-price">ต้นทุน/ชิ้น</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td data-label="วันที่บิล">{thaiDate(l.bill_date)}</td>
                      <td data-label="ร้านที่ซื้อ">{l.supplier_name || "-"}</td>
                      <td data-label="เลขบิล">{l.invoice_no || "-"}</td>
                      <td className="pcp-col-price" data-label="จำนวน">
                        {l.qty}{l.position ? ` (${l.position})` : ""}
                      </td>
                      <td className="pcp-col-price" data-label="ต้นทุน/ชิ้น">
                        {l.unit_cost != null
                          ? <span className="pcp-price-val">{baht(l.unit_cost)}</span>
                          : <span className="pcp-price-na">ยังไม่ใส่</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="pcp-modal-footer">
          <button className="pcp-btn-cancel" onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

export default function ReceivedCostsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [historyItem, setHistoryItem] = useState(null);

  const load = useCallback(async (term) => {
    setLoading(true);
    setError("");
    try {
      const res = await client.get(API, { params: term ? { search: term } : {} });
      setItems(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || "โหลดต้นทุนจากบิลรับเข้าไม่สำเร็จ");
    }
    setLoading(false);
  }, []);

  // debounce typing so each keystroke does not hit the server
  useEffect(() => {
    const timer = setTimeout(() => load(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search, load]);

  useEffect(() => { setPage(1); }, [search, filter]);

  const counts = useMemo(() => {
    const withCost = items.filter((i) => i.avg_cost != null).length;
    return { all: items.length, with: withCost, without: items.length - withCost };
  }, [items]);

  const shown = useMemo(() => {
    if (filter === "with") return items.filter((i) => i.avg_cost != null);
    if (filter === "without") return items.filter((i) => i.avg_cost == null);
    return items;
  }, [items, filter]);

  // value of what is on the shelf at its average cost (items without a cost are left out)
  const stockValue = useMemo(
    () => items.reduce((sum, i) => (i.avg_cost != null && i.stock_qty > 0 ? sum + i.avg_cost * i.stock_qty : sum), 0),
    [items]
  );

  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <>
      <p className="rct-muted rct-intro">
        ต้นทุนต่อชิ้นที่กรอกในบิลรับเข้าของสาขานี้ อัปเดตเองทุกครั้งที่กรอกต้นทุนในบิล แก้ต้นทุนได้ที่บิลรับเข้า
        หรือหน้า <Link to="/stock-costs">กรอกต้นทุนที่ยังขาด</Link>
      </p>

      <div className="pcp-filters">
        <div className="pcp-filter-search">
          <span className="pcp-filter-icon">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="9" cy="9" r="7" /><line x1="15" y1="15" x2="19" y2="19" />
            </svg>
          </span>
          <input
            placeholder="ค้นหารหัส ชื่อ หรือหมวด..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="ค้นหาต้นทุนจากบิลรับเข้า"
          />
          {search && <button className="pcp-filter-clear" onClick={() => setSearch("")} aria-label="ล้างคำค้นหา">✕</button>}
        </div>
      </div>

      <div className="pcp-stats-row">
        <div className="pcp-stats">
          <div className="pcp-stat-badge">ทั้งหมด <strong>{counts.all}</strong> รายการ</div>
          <div className="pcp-stat-badge pcp-stat-value">มูลค่าสต๊อกตามต้นทุน <strong>{baht(Math.round(stockValue))}</strong></div>
        </div>
        <div className="stock-all-filters" role="group" aria-label="กรองตามต้นทุน">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`stock-all-chip${filter === f.key ? " stock-all-chip--active" : ""}`}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label} {counts[f.key]}
            </button>
          ))}
        </div>
      </div>

      <div className="pcp-table-wrap">
        {loading ? (
          <div className="pcp-loading">กำลังโหลด...</div>
        ) : error ? (
          <div className="pcp-empty">{error}</div>
        ) : shown.length === 0 ? (
          <div className="pcp-empty">
            <span className="pcp-empty-icon">◻</span>
            {items.length === 0 ? "สาขานี้ยังไม่มีบิลรับเข้า" : "ไม่พบรายการ"}
          </div>
        ) : (
          <table className="pcp-table">
            <thead>
              <tr>
                <th className="pcp-col-parts">รหัส</th>
                <th className="pcp-col-desc">สินค้า</th>
                <th className="pcp-col-cat">หมวด</th>
                <th className="pcp-col-price">คงเหลือ</th>
                <th className="pcp-col-price">ต้นทุนเฉลี่ย</th>
                <th className="pcp-col-price">ต้นทุนล่าสุด</th>
                <th>ร้านที่ซื้อล่าสุด</th>
                <th className="pcp-col-action">ประวัติ</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((i) => (
                <tr key={i.id}>
                  <td className="pcp-col-parts" data-label="รหัส">
                    {i.oem_code ? <span className="pcp-parts-badge">{i.oem_code}</span> : "-"}
                  </td>
                  <td className="pcp-col-desc" data-label="สินค้า">{i.description}</td>
                  <td className="pcp-col-cat" data-label="หมวด"><span className="pcp-cat-chip">{i.category_name}</span></td>
                  <td className="pcp-col-price" data-label="คงเหลือ">{i.stock_qty}</td>
                  <td className="pcp-col-price" data-label="ต้นทุนเฉลี่ย">
                    {i.avg_cost != null ? (
                      <>
                        <span className="pcp-price-val">{baht(i.avg_cost)}</span>
                        {i.cost_source === "manual" && <div className="rct-muted">กรอกเอง</div>}
                      </>
                    ) : <span className="pcp-price-na">ยังไม่มี</span>}
                  </td>
                  <td className="pcp-col-price" data-label="ต้นทุนล่าสุด">
                    {i.last_cost != null ? (
                      <>
                        {baht(i.last_cost)}
                        <div className="rct-muted">{thaiDate(i.last_cost_date)}</div>
                      </>
                    ) : <span className="pcp-price-na">-</span>}
                  </td>
                  <td data-label="ร้านที่ซื้อล่าสุด">{i.last_supplier || "-"}</td>
                  <td className="pcp-col-action">
                    <button
                      type="button"
                      className="pcp-btn-edit"
                      onClick={() => setHistoryItem(i)}
                      disabled={i.lines_total === 0}
                      title={i.lines_total === 0 ? "ยังไม่มีบิลรับเข้า" : undefined}
                    >
                      ดู ({i.lines_total})
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && shown.length > PAGE_SIZE && (
        <div className="pcp-pagination">
          <button className="pcp-btn-page" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>ก่อนหน้า</button>
          <span className="pcp-page-info">หน้า {safePage} / {totalPages} &nbsp;({shown.length} รายการ)</span>
          <button className="pcp-btn-page" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>ถัดไป</button>
        </div>
      )}

      {historyItem && <HistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />}
    </>
  );
}
