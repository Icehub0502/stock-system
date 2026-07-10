// pages/ProductCostPage.jsx
import React, { useState, useEffect, useCallback } from "react";
import client from "../api/client";

function detectCategory(desc = "") {
  const d = desc.toLowerCase();
  if (d.includes("แร็คมือสอง") || d.includes("มือสอง")) return "แร็คมือสอง";
  if (d.includes("แร็คบิวใหม่") || d.includes("บิวใหม่")) return "แร็คบิวใหม่";
  if (d.includes("แร็คใหม่") || d.includes("แร็ค oem")) return "แร็คใหม่ OEM";
  if (d.includes("ปีกนก")) return "ปีกนก";
  if (d.includes("ยางกันฝุ่น") || d.includes("ยางกันกระแทก")) return "ยางกันฝุ่น/กันกระแทก";
  if (d.includes("ยางกันโคลง")) return "ยางกันโคลง";
  if (d.includes("สกรูกันโคลง")) return "สกรูกันโคลง";
  if (d.includes("ลูกหมากแร็ค")) return "ลูกหมากแร็ค";
  if (d.includes("ลูกหมากคันชัก")) return "ลูกหมากคันชัก";
  if (d.includes("ลูกหมากกันโคลง")) return "ลูกหมากกันโคลง";
  if (d.includes("ลูกหมากบน")) return "ลูกหมากบน";
  if (d.includes("ลูกหมากล่าง")) return "ลูกหมากล่าง";
  if (d.includes("ลูกหมาก")) return "ลูกหมาก";
  if (d.includes("บูช")) return "บูช";
  return "อื่นๆ";
}

function detectBrand(desc = "") {
  const brands = [
    "TOYOTA","HONDA","NISSAN","ISUZU","MITSUBISHI","MAZDA","FORD",
    "CHEVROLET","SUZUKI","SUBARU","BMW","BENZ","VOLKSWAGEN","LEXUS",
    "HYUNDAI","KIA","VOLVO","MG","PROTON","HAVAL","RANGE ROVER",
  ];
  const d = desc.toUpperCase();
  for (const b of brands) if (d.includes(b)) return b;
  return "อื่นๆ";
}

const fmt = (n) =>
  n == null ? "-" : Number(n).toLocaleString("th-TH", { minimumFractionDigits: 0 });

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ─── SingleForm ─────────────────────────────────────────────────── */
function SingleForm({ form, setForm }) {
  const f = (k) => (e) => setForm((prev) => ({ ...prev, [k]: e.target.value }));
  return (
    <div className="pcp-single-form">
      <div className="pcp-form-row-2">
        <div className="pcp-form-field">
          <label>No.</label>
          <input
            type="number"
            value={form.no}
            readOnly
            tabIndex={-1}
            style={{ background: "#f9f9f9", color: "#9ca3af", cursor: "default" }}
          />
        </div>
        <div className="pcp-form-field">
          <label>Parts *</label>
          <input value={form.parts} onChange={f("parts")} placeholder="รหัสอะไหล่" />
        </div>
      </div>
      <div className="pcp-form-field">
        <label>Description *</label>
        <input value={form.description} onChange={f("description")} placeholder="รายละเอียดสินค้า" />
      </div>
      <div className="pcp-form-row-2">
        <div className="pcp-form-field">
          <label>Brand</label>
          <input value={form.brand} onChange={f("brand")} placeholder="แบรนด์" />
        </div>
        <div className="pcp-form-field">
          <label>ต้นทุน (บาท)</label>
          <input type="number" value={form.price} onChange={f("price")} placeholder="0.00" />
        </div>
      </div>
    </div>
  );
}

/* ─── ProductModal ──────────────────────────────────────────────── */
function ProductModal({ mode, initial, nextNo, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(
    initial || { no: nextNo, parts: "", description: "", brand: "", price: "" }
  );
  const [bulkText, setBulkText] = useState("");
  const [bulkItems, setBulkItems] = useState([]);
  const [bulkError, setBulkError] = useState("");
  const [saving, setSaving] = useState(false);
  const isAdd = mode === "add";

  const parseBulk = (text) => {
    setBulkError("");
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const parsed = [], errors = [];
    lines.forEach((line, i) => {
      const cols = line.includes("\t") ? line.split("\t") : line.split(",");
      if (cols.length < 3) {
        errors.push(`บรรทัด ${i + 1}: ต้องมีอย่างน้อย 3 คอลัมน์ (no, parts, description)`);
        return;
      }
      parsed.push({
        no: cols[0]?.trim() || "",
        parts: cols[1]?.trim() || "",
        description: cols[2]?.trim() || "",
        brand: cols[3]?.trim() || "",
        price: cols[4]?.trim() || "",
      });
    });
    if (errors.length) setBulkError(errors.join("\n"));
    setBulkItems(parsed);
  };

  const handleSave = async () => {
    setSaving(true);
    if (isAdd) {
      await onSave(bulkItems.length > 0 ? bulkItems : [form]);
    } else {
      await onSave(form);
    }
    setSaving(false);
  };

  return (
    <div
      className="pcp-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pcp-modal-box">
        <div className="pcp-modal-header">
          <h3>{isAdd ? "เพิ่มสินค้า" : "แก้ไขสินค้า"}</h3>
          <button className="pcp-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="pcp-modal-body">
          {isAdd ? (
            <>
              <div className="pcp-bulk-hint">
                <span>วางข้อมูลหลายรายการ (แต่ละบรรทัด = 1 รายการ)</span>
                <small>รูปแบบ: no &emsp; parts &emsp; description &emsp; brand &emsp; ราคา</small>
              </div>
              <textarea
                className="pcp-bulk-textarea"
                placeholder={`1\tRTTO5201\tแร็คใหม่ OEM TOYOTA COROLLA AE100\tBBBTEK\t4050\n2\tRTHO7201\tแร็คใหม่ OEM HONDA BRIO 2011-2018\tBBBTEK\t3100`}
                value={bulkText}
                rows={9}
                onChange={(e) => { setBulkText(e.target.value); parseBulk(e.target.value); }}
              />
              {bulkError && <pre className="pcp-bulk-error">{bulkError}</pre>}
              {bulkItems.length > 0 && (
                <div className="pcp-bulk-preview">
                  <p>พบ {bulkItems.length} รายการ พร้อมเพิ่ม</p>
                  <div className="pcp-preview-scroll">
                    <table className="pcp-preview-table">
                      <thead>
                        <tr><th>No</th><th>Parts</th><th>Description</th><th>Brand</th><th>ราคา</th></tr>
                      </thead>
                      <tbody>
                        {bulkItems.slice(0, 10).map((it, i) => (
                          <tr key={i}>
                            <td>{it.no}</td>
                            <td>{it.parts}</td>
                            <td className="pcp-td-desc">{it.description}</td>
                            <td>{it.brand}</td>
                            <td>{it.price}</td>
                          </tr>
                        ))}
                        {bulkItems.length > 10 && (
                          <tr>
                            <td colSpan={5} className="pcp-td-more">
                              และอีก {bulkItems.length - 10} รายการ
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="pcp-divider-or"><span>หรือเพิ่มทีละรายการ</span></div>
              <SingleForm form={form} setForm={setForm} />
            </>
          ) : (
            <>
              <SingleForm form={form} setForm={setForm} />
              {/* ── ปุ่มลบอยู่ใน edit modal ── */}
              <div className="pcp-edit-delete-zone">
                <hr className="pcp-edit-divider" />
                <button
                  className="pcp-btn-delete-in-modal"
                  onClick={() => onDelete && onDelete()}
                >
                  ลบรายการนี้
                </button>
              </div>
            </>
          )}
        </div>

        <div className="pcp-modal-footer">
          <button className="pcp-btn-cancel" onClick={onClose}>ยกเลิก</button>
          <button className="pcp-btn-save" onClick={handleSave} disabled={saving}>
            {saving ? "กำลังบันทึก..." : isAdd ? "เพิ่มสินค้า" : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── ConfirmModal ──────────────────────────────────────────────── */
function ConfirmModal({ message, onConfirm, onClose }) {
  return (
    <div
      className="pcp-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pcp-modal-box pcp-modal-sm">
        <div className="pcp-modal-header">
          <h3>ยืนยันการลบ</h3>
          <button className="pcp-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="pcp-modal-body">
          <p style={{ margin: 0, color: "#374151" }}>{message}</p>
        </div>
        <div className="pcp-modal-footer">
          <button className="pcp-btn-cancel" onClick={onClose}>ยกเลิก</button>
          <button className="pcp-btn-delete-confirm" onClick={onConfirm}>ลบ</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────── */
export default function ProductCostPage() {
  const API = "/product-costs";

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterCarBrand, setFilterCarBrand] = useState("");
  const [categories, setCategories] = useState([]);
  const [carBrands, setCarBrands] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [totalCount, setTotalCount] = useState(0);
  const [categoryCounts, setCategoryCounts] = useState({});
  const [totalValue, setTotalValue] = useState(0);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  /* ─ fetch ─ */
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (filterCategory) params.category = filterCategory;
      if (filterCarBrand) params.car_brand = filterCarBrand;
      const res = await client.get(API, { params });
      const json = res.data;
      if (json.success) {
        setProducts(json.data);
        if (json.total_count != null) setTotalCount(json.total_count);
        else if (!search && !filterCategory && !filterCarBrand) setTotalCount(json.data.length);
      }
    } catch { showToast("error", "โหลดข้อมูลล้มเหลว"); }
    setLoading(false);
  }, [search, filterCategory, filterCarBrand]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await client.get(`${API}/categories`);
      const json = res.data;
      if (json.success) {
        setCategories(json.categories);
        setCarBrands(json.car_brands);
        setCategoryCounts(json.category_counts || {});
        setTotalValue(json.total_value || 0);
      }
    } catch {}
  }, []);

  const fetchTotalCount = useCallback(async () => {
    try {
      const res = await client.get(API);
      const json = res.data;
      if (json.success) setTotalCount(json.data.length);
    } catch {}
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { fetchCategories(); }, [fetchCategories]);
  useEffect(() => { setPage(1); }, [search, filterCategory, filterCarBrand]);

  /* ─ toast ─ */
  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  /* ─ add ─ */
  const handleAdd = async (items) => {
    const arr = Array.isArray(items) ? items : [items];
    if (!arr[0]?.parts) return showToast("error", "กรุณากรอกข้อมูล");
    try {
      const res = await client.post(API, { items: arr });
      showToast("success", res.data.message);
      setModal(null);
      fetchProducts();
      fetchCategories();
      fetchTotalCount();
    } catch (err) { showToast("error", err.response?.data?.message || "เพิ่มข้อมูลล้มเหลว"); }
  };

  /* ─ edit ─ */
  const handleEdit = async (form) => {
    if (!form.parts) return showToast("error", "กรุณากรอก Parts");
    try {
      await client.put(`${API}/${modal.data.id}`, form);
      showToast("success", "แก้ไขสำเร็จ");
      setModal(null);
      fetchProducts();
    } catch (err) { showToast("error", err.response?.data?.message || "แก้ไขล้มเหลว"); }
  };

  /* ─ delete single ─ */
  const handleDelete = async (id) => {
    try {
      await client.delete(`${API}/${id}`);
      showToast("success", "ลบสำเร็จ");
      setModal(null);
      fetchProducts();
      fetchCategories();
      fetchTotalCount();
    } catch (err) { showToast("error", err.response?.data?.message || "ลบล้มเหลว"); }
  };

  /* ─ delete bulk ─ */
  const handleDeleteSelected = async () => {
    try {
      const res = await client.delete(API, { data: { ids: [...selected] } });
      showToast("success", res.data.message);
      setSelected(new Set());
      setSelectionMode(false);
      setModal(null);
      fetchProducts();
      fetchCategories();
      fetchTotalCount();
    } catch (err) { showToast("error", err.response?.data?.message || "ลบล้มเหลว"); }
  };

  /* ─ print selected ─ */
  const handlePrint = () => {
    const rows = products.filter((p) => selected.has(p.id));
    const printDate = new Date().toLocaleDateString("th-TH", {
      year: "numeric", month: "long", day: "numeric",
    });
    const win = window.open("", "_blank");
    win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8"/>
<title>รายการต้นทุนสินค้า</title>
<style>
  @page { size: A4 landscape; margin: 12mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Sarabun', 'Segoe UI', Arial, sans-serif;
    font-size: 10.5pt;
    color: #111;
    margin: 0;
  }
  .doc-header { margin-bottom: 14px; }
  .doc-title {
    font-size: 15pt;
    font-weight: 700;
    margin: 0 0 3px;
    letter-spacing: -0.01em;
  }
  .doc-meta {
    font-size: 8.5pt;
    color: #666;
    margin: 0;
  }
  .doc-divider {
    border: none;
    border-top: 2px solid #111;
    margin: 10px 0 14px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
  }
  thead th {
    background: #111;
    color: #fff;
    padding: 7px 10px;
    text-align: left;
    font-weight: 700;
    font-size: 8pt;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  thead th.th-right { text-align: right; }
  tbody tr:nth-child(even) td { background: #f9f9f9; }
  tbody td {
    padding: 6px 10px;
    border-bottom: 1px solid #e5e7eb;
    vertical-align: top;
    line-height: 1.4;
  }
  .td-no    { width: 36px; text-align: center; color: #999; font-size: 8.5pt; }
  .td-parts { width: 110px; font-family: 'Consolas','Courier New',monospace; font-size: 9pt; white-space: nowrap; }
  .td-desc  { min-width: 200px; }
  .td-cat   { width: 130px; }
  .td-carbrand { width: 90px; }
  .td-brand { width: 80px; color: #555; font-size: 8.5pt; }
  .td-price { width: 90px; text-align: right; font-weight: 700; white-space: nowrap; }
  .badge-car {
    background: #111; color: #fff;
    border-radius: 20px; padding: 1px 8px;
    font-size: 8pt; display: inline-block;
  }
  .badge-cat {
    background: #f0f0f0; color: #374151;
    border: 1px solid #d1d5db;
    border-radius: 20px; padding: 1px 8px;
    font-size: 8pt; display: inline-block;
  }
  .doc-footer {
    margin-top: 14px;
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #999;
    border-top: 1px solid #e5e7eb;
    padding-top: 8px;
  }
  .total-row td {
    background: #f5f5f5 !important;
    font-weight: 700;
    border-top: 2px solid #111;
    border-bottom: none;
  }
</style>
</head>
<body>
<div class="doc-header">
  <div class="doc-title">รายการต้นทุนสินค้า</div>
  <div class="doc-meta">พิมพ์วันที่ ${printDate} &nbsp;|&nbsp; รวม ${rows.length} รายการ</div>
</div>
<hr class="doc-divider"/>
<table>
  <thead>
    <tr>
      <th class="td-no">No.</th>
      <th class="td-parts">Parts</th>
      <th class="td-desc">Description</th>
      <th class="td-cat">หมวดหมู่</th>
      <th class="td-carbrand">ยี่ห้อรถ</th>
      <th class="td-brand">Brand</th>
      <th class="td-price th-right">ต้นทุน (฿)</th>
    </tr>
  </thead>
  <tbody>
    ${rows.map((p, i) => `
    <tr>
      <td class="td-no">${i + 1}</td>
      <td class="td-parts">${escapeHtml(p.parts)}</td>
      <td class="td-desc">${escapeHtml(p.description)}</td>
      <td class="td-cat"><span class="badge-cat">${escapeHtml(detectCategory(p.description))}</span></td>
      <td class="td-carbrand"><span class="badge-car">${escapeHtml(detectBrand(p.description))}</span></td>
      <td class="td-brand">${p.brand ? escapeHtml(p.brand) : "-"}</td>
      <td class="td-price">${p.price != null ? Number(p.price).toLocaleString("th-TH") : "-"}</td>
    </tr>`).join("")}
    <tr class="total-row">
      <td colspan="6" style="text-align:right;padding-right:10px;">รวมทั้งหมด</td>
      <td class="td-price">
        ${rows.reduce((sum, p) => sum + (p.price != null ? Number(p.price) : 0), 0).toLocaleString("th-TH")}
      </td>
    </tr>
  </tbody>
</table>
<div class="doc-footer">
  <span>champpower-stock · ระบบจัดการต้นทุนสินค้า</span>
  <span>champ-powerspk.com</span>
</div>
</body>
</html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  };

  /* ─ checkbox ─ */
  const toggleSelect = (id) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () =>
    selected.size === products.length ? setSelected(new Set()) : setSelected(new Set(products.map((p) => p.id)));

  /* ─ exit selection mode ─ */
  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelected(new Set());
  };

  const hasFilter = search || filterCategory || filterCarBrand;

  /* ─ pagination ─ */
  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const pagedProducts = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /* ─ category quick-filter chips ─ */
  const toggleCategoryFilter = (cat) =>
    setFilterCategory((prev) => (prev === cat ? "" : cat));
  const sortedCategories = [...categories].sort(
    (a, b) => (categoryCounts[b] || 0) - (categoryCounts[a] || 0)
  );

  return (
    <div className="pcp-root">
      {/* ── Header ── */}
      <div className="pcp-header">
        <div>
          <h1 className="pcp-title">ต้นทุนสินค้า</h1>
          <p className="pcp-subtitle">จัดการราคาต้นทุนอะไหล่ทั้งหมด</p>
        </div>
        <div className="pcp-header-actions">
          <button
            className={`pcp-btn-select-mode ${selectionMode ? "active" : ""}`}
            onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
          >
            {selectionMode ? "ยกเลิกการเลือก" : "เลือกรายการ"}
          </button>
          <button
            className="pcp-btn-add"
            onClick={() => setModal({ type: "add" })}
          >
            + เพิ่มสินค้า
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="pcp-filters">
        <div className="pcp-filter-search">
          <span className="pcp-filter-icon">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="9" cy="9" r="7" /><line x1="15" y1="15" x2="19" y2="19" />
            </svg>
          </span>
          <input
            placeholder="ค้นหา parts, description, brand..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && <button className="pcp-filter-clear" onClick={() => setSearch("")}>✕</button>}
        </div>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="pcp-select">
          <option value="">ทุกหมวดหมู่</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterCarBrand} onChange={(e) => setFilterCarBrand(e.target.value)} className="pcp-select">
          <option value="">ทุกยี่ห้อรถ</option>
          {carBrands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        {hasFilter && (
          <button className="pcp-btn-clear-all" onClick={() => { setSearch(""); setFilterCategory(""); setFilterCarBrand(""); }}>
            ล้างตัวกรอง
          </button>
        )}
      </div>

      {/* ── Bulk bar (แสดงเฉพาะตอน selectionMode) ── */}
      {selectionMode && (
        <div className="pcp-bulk-bar">
          <input
            type="checkbox"
            checked={selected.size === products.length && products.length > 0}
            onChange={toggleSelectAll}
            style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#111" }}
          />
          <span>เลือกทั้งหมด</span>
          {selected.size > 0 && (
            <>
              <span className="pcp-bulk-count">เลือกแล้ว {selected.size} รายการ</span>
              {/* ── ปุ่มปริ้น ── */}
              <button className="pcp-btn-print-bulk" onClick={handlePrint}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display:"inline-block", verticalAlign:"middle", marginRight:5 }}>
                  <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
                </svg>
                ปริ้นเอกสาร
              </button>
              <button className="pcp-btn-delete-bulk" onClick={() => setModal({ type: "confirmDeleteBulk" })}>
                ลบที่เลือก
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Stats ── */}
      <div className="pcp-stats-row">
        <div className="pcp-stats">
          <div className="pcp-stat-badge">ทั้งหมด <strong>{products.length}</strong> รายการ</div>
          <div className="pcp-stat-badge pcp-stat-value">มูลค่ารวม <strong>฿{fmt(totalValue)}</strong></div>
          {filterCarBrand && (
            <div className="pcp-stat-badge active">
              {filterCarBrand}
              <button className="pcp-chip-clear" onClick={() => setFilterCarBrand("")}>✕</button>
            </div>
          )}
        </div>
        <div className="pcp-cat-chips">
          {sortedCategories.map((cat) => (
            <button
              key={cat}
              className={`pcp-cat-chip-btn ${filterCategory === cat ? "active" : ""}`}
              onClick={() => toggleCategoryFilter(cat)}
            >
              {cat} <span className="pcp-cat-chip-count">{categoryCounts[cat] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="pcp-table-wrap">
        {loading ? (
          <div className="pcp-loading">กำลังโหลด...</div>
        ) : products.length === 0 ? (
          <div className="pcp-empty">
            <span className="pcp-empty-icon">◻</span>
            ไม่พบรายการสินค้า
          </div>
        ) : (
          <table className="pcp-table">
            <thead>
              <tr>
                {selectionMode && <th className="pcp-col-cb"></th>}
                <th className="pcp-col-no">No.</th>
                <th className="pcp-col-parts">Parts</th>
                <th className="pcp-col-desc">Description</th>
                <th className="pcp-col-cat">หมวดหมู่</th>
                <th className="pcp-col-carbrand">ยี่ห้อรถ</th>
                <th className="pcp-col-brand">Brand</th>
                <th className="pcp-col-price">ต้นทุน</th>
                <th className="pcp-col-action">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {pagedProducts.map((p, index) => (
                <tr key={p.id} className={selected.has(p.id) ? "row-selected" : ""}>
                  {selectionMode && (
                    <td className="pcp-col-cb">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        style={{ accentColor: "#111" }}
                      />
                    </td>
                  )}
                  <td className="pcp-col-no" data-label="No.">{(page - 1) * PAGE_SIZE + index + 1}</td>
                  <td className="pcp-col-parts" data-label="Parts">
                    <span className="pcp-parts-badge">{p.parts}</span>
                  </td>
                  <td className="pcp-col-desc" data-label="Description">{p.description}</td>
                  <td data-label="หมวดหมู่">
                    <span className="pcp-cat-chip">{detectCategory(p.description)}</span>
                  </td>
                  <td data-label="ยี่ห้อรถ">
                    <span className="pcp-car-chip">{detectBrand(p.description)}</span>
                  </td>
                  <td data-label="Brand">{p.brand || "-"}</td>
                  <td className="pcp-col-price" data-label="ต้นทุน">
                    {p.price != null
                      ? <span className="pcp-price-val">฿{fmt(p.price)}</span>
                      : <span className="pcp-price-na">-</span>}
                  </td>
                  <td className="pcp-col-action">
                    <button
                      className="pcp-btn-edit"
                      onClick={() => setModal({ type: "edit", data: p })}
                    >
                      แก้ไข
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {!loading && products.length > PAGE_SIZE && (
        <div className="pcp-pagination">
          <button
            className="pcp-btn-page"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ก่อนหน้า
          </button>
          <span className="pcp-page-info">
            หน้า {page} / {totalPages} &nbsp;({products.length} รายการ)
          </span>
          <button
            className="pcp-btn-page"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            ถัดไป
          </button>
        </div>
      )}

      {/* ── Modals ── */}
      {modal?.type === "add" && (
        <ProductModal
          mode="add"
          nextNo={totalCount + 1}
          onClose={() => setModal(null)}
          onSave={handleAdd}
        />
      )}
      {modal?.type === "edit" && (
        <ProductModal
          mode="edit"
          initial={modal.data}
          onClose={() => setModal(null)}
          onSave={handleEdit}
          onDelete={() => setModal({ type: "confirmDelete", data: modal.data })}
        />
      )}
      {modal?.type === "confirmDelete" && (
        <ConfirmModal
          message={`ต้องการลบ "${modal.data.parts}" ใช่หรือไม่?`}
          onConfirm={() => handleDelete(modal.data.id)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "confirmDeleteBulk" && (
        <ConfirmModal
          message={`ต้องการลบ ${selected.size} รายการที่เลือกใช่หรือไม่?`}
          onConfirm={handleDeleteSelected}
          onClose={() => setModal(null)}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`pcp-toast pcp-toast--${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}