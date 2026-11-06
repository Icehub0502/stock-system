import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { canChange } from '../utils/roles';
import { formatMoney } from '../utils/format';

const SHOWN_ON_SCREEN = 200;

const money = (value) => {
  if (value === null || value === undefined) return '-';
  return `${value < 0 ? '-' : ''}฿${formatMoney(Math.abs(value))}`;
};
// items on the list with no price yet: only wanted when tidying the list, so they stay out of the way until asked for
const hasNoPrice = (r) => r.source === 'catalog' && r.total_price === null;
const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function StockCell({ row }) {
  if (row.source === 'catalog') return <span className="pl-muted">-</span>;
  if (row.is_set) return <span className="pl-muted">ชุดโปร ดูแยกรายการ</span>;
  if (row.stock.matched === 0) return <span className="pl-muted">ไม่พบในสต๊อก</span>;
  return (
    <>
      <b className={row.stock.qty > 0 ? 'pl-in-stock' : 'pl-out-of-stock'}>{row.stock.qty > 0 ? `มี ${row.stock.qty} ชิ้น` : 'หมด'}</b>
      <small className="pl-codes">
        {row.stock.items.map((item) => `${item.code} (${item.qty})`).join(', ')}
        {row.stock.matched > row.stock.items.length ? ` และอีก ${row.stock.matched - row.stock.items.length} รหัส` : ''}
      </small>
    </>
  );
}

// ราคาขาย: for looking a price up while a customer waits. It changes nothing; standard prices are set on /model-prices.
// Printing and Excel never carry the cost, because a printed list may be handed to a customer.
export default function PriceListPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [seesCost, setSeesCost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('');
  const [modelId, setModelId] = useState('');
  const [category, setCategory] = useState('');
  const [standardOnly, setStandardOnly] = useState(false);
  const [belowCostOnly, setBelowCostOnly] = useState(false);
  const [noPriceOnly, setNoPriceOnly] = useState(false);
  const [mayEditList, setMayEditList] = useState(false);
  const [hidden, setHidden] = useState([]);
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await client.get('/price-list');
      setRows(res.data.data.rows);
      setSeesCost(res.data.data.sees_cost);
      setMayEditList(res.data.data.may_edit_list);
      setHidden(res.data.data.hidden);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดราคาขายไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const takeOff = async (row) => {
    const sameItem = rows.filter((r) => r.item_key === row.item_key).length;
    const where = sameItem > 1 ? ` (ทุกรุ่นรถ ${sameItem} แถว)` : '';
    if (!window.confirm(`ลบ "${row.item_name}"${where} ออกจากรายการราคาขายของสาขานี้? สาขาอื่น ราคา และใบเสนอราคาไม่กระทบ และเอากลับได้`)) return;
    setBusy(true);
    try {
      await client.post('/price-list/hidden', { item_name: row.item_name });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'ลบรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const putBack = async (item) => {
    setBusy(true);
    try {
      await client.delete('/price-list/hidden', { data: { item_name: item.item_name } });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'เอารายการกลับไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const brands = useMemo(() => [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort(), [rows]);
  const models = useMemo(() => {
    const seen = new Map();
    rows.filter((r) => r.brand === brand).forEach((r) => seen.set(r.vehicle_model_id, r.model_name));
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, brand]);
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th')), [rows]);
  const belowCostCount = useMemo(() => rows.filter((r) => r.below_cost).length, [rows]);
  const noPriceCount = useMemo(() => rows.filter(hasNoPrice).length, [rows]);

  const filtered = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      if (brand && r.brand !== brand) return false;
      if (modelId && String(r.vehicle_model_id) !== modelId) return false;
      if (category && r.category !== category) return false;
      if (standardOnly && r.source !== 'standard') return false;
      if (belowCostOnly && !r.below_cost) return false;
      if (hasNoPrice(r) !== noPriceOnly) return false;
      const text = `${r.brand} ${r.model_name} ${r.item_name} ${r.stock.items.map((i) => i.code).join(' ')}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [rows, search, brand, modelId, category, standardOnly, belowCostOnly, noPriceOnly]);
  const withPricedRows = rows.length - noPriceCount;
  // a printed list or a file only carries what has a price
  const withPrice = useMemo(() => filtered.filter((r) => r.total_price !== null), [filtered]);

  const printList = () => {
    const win = window.open('', '_blank');
    if (!win) {
      setError('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาตป๊อปอัปของเว็บนี้');
      return;
    }
    const body = withPrice.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.brand)} ${escapeHtml(r.model_name)}</td><td>${escapeHtml(r.item_name)}</td>`
      + `<td class="n">${formatMoney(r.part_price)}</td><td class="n">${r.labor_price === null ? '-' : formatMoney(r.labor_price)}</td><td class="n">${formatMoney(r.total_price)}</td></tr>`).join('');
    win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ราคาขาย</title><style>
      body{font-family:Tahoma,sans-serif;font-size:12px;margin:12mm}h1{font-size:16px;margin:0 0 8px}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}
      .n{text-align:right;white-space:nowrap}thead{display:table-header-group}tr{break-inside:avoid}
      </style></head><body><h1>ราคาขาย</h1><table><thead><tr><th>#</th><th>รุ่นรถ</th><th>รายการ</th><th class="n">ราคาอะไหล่</th><th class="n">ค่าแรง</th><th class="n">รวม</th></tr></thead><tbody>${body}</tbody></table></body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 300);
  };

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const sheet = XLSX.utils.json_to_sheet(withPrice.map((r) => ({
        'ยี่ห้อ': r.brand,
        'รุ่นรถ': r.model_name,
        'รายการ': r.item_name,
        'หมวด': r.category || '',
        'ราคาอะไหล่': r.part_price,
        'ค่าแรง': r.labor_price ?? '',
        'รวม': r.total_price,
        'ที่มา': { standard: 'ราคามาตรฐาน', typed: 'ราคาที่กรอกล่าสุด', catalog: 'ราคาชุด' }[r.source],
      })));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'ราคาขาย');
      XLSX.writeFile(book, 'ราคาขาย.xlsx');
    } catch {
      setError('ส่งออก Excel ไม่สำเร็จ');
    }
  };

  return (
    <div className="quotation-page pl-page">
      <div className="quotation-header">
        <div>
          <h1>ราคาขาย</h1>
          <p className="subtitle">ค้นราคาตามรุ่นรถ ชื่อรายการ หรือรหัสอะไหล่ เวลาลูกค้าถาม</p>
        </div>
        <div className="quotation-actions">
          {canChange(user, 'manager') && <Link to="/model-prices" className="btn btn-secondary">แก้ราคามาตรฐาน</Link>}
          <button type="button" onClick={printList} disabled={withPrice.length === 0}>🖨️ พิมพ์</button>
          <button type="button" onClick={exportExcel} disabled={withPrice.length === 0}>ส่งออก Excel</button>
        </div>
      </div>

      <div className="pl-filters">
        <input
          type="text"
          className="search-input pl-search"
          placeholder="พิมพ์ค้นหา เช่น vigo แร็ค"
          aria-label="ค้นหาราคา"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="ยี่ห้อรถ" value={brand} onChange={(e) => { setBrand(e.target.value); setModelId(''); }}>
          <option value="">ทุกยี่ห้อ</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select aria-label="รุ่นรถ" value={modelId} disabled={!brand} onChange={(e) => setModelId(e.target.value)}>
          <option value="">{brand ? 'ทุกรุ่น' : 'เลือกยี่ห้อก่อน'}</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select aria-label="หมวด" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">ทุกหมวด</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="pl-check">
          <input type="checkbox" checked={standardOnly} onChange={(e) => setStandardOnly(e.target.checked)} /> เฉพาะราคามาตรฐาน
        </label>
        {noPriceCount > 0 && (
          <label className="pl-check">
            <input type="checkbox" checked={noPriceOnly} onChange={(e) => setNoPriceOnly(e.target.checked)} /> ดูรายการที่ยังไม่ตั้งราคา ({noPriceCount})
          </label>
        )}
        {mayEditList && hidden.length > 0 && (
          <label className="pl-check">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> รายการที่ลบแล้ว ({hidden.length})
          </label>
        )}
        {seesCost && belowCostCount > 0 && (
          <label className="pl-check pl-check--warn">
            <input type="checkbox" checked={belowCostOnly} onChange={(e) => setBelowCostOnly(e.target.checked)} /> ราคาต่ำกว่าทุน ({belowCostCount})
          </label>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}
      {showHidden && hidden.length > 0 && (
        <div className="pl-hidden">
          {hidden.map((item) => (
            <div className="pl-hidden-row" key={item.item_key}>
              <span>{item.item_name}</span>
              <button type="button" onClick={() => putBack(item)} disabled={busy}>เอากลับ</button>
            </div>
          ))}
        </div>
      )}
      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : rows.length === 0 ? (
        <div className="empty-message">ยังไม่มีราคา ผู้จัดการตั้งราคาได้ที่ "ราคามาตรฐานตามรุ่นรถ" หรือราคาจะขึ้นเองเมื่อพนักงานทำใบเสนอราคาของรถที่เลือกรุ่นไว้</div>
      ) : filtered.length === 0 ? (
        <div className="empty-message">
          {noPriceCount > 0 && !noPriceOnly && withPricedRows === 0
            ? 'ยังไม่มีรายการที่ตั้งราคา ติ๊ก "ดูรายการที่ยังไม่ตั้งราคา" เพื่อดูรายการทั้งหมด'
            : 'ไม่พบราคาที่ค้นหา'}
        </div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>รุ่นรถ</th>
                <th>รายการ</th>
                <th className="col-amount">ราคาอะไหล่</th>
                <th className="col-amount">ค่าแรง</th>
                <th className="col-amount">รวม</th>
                <th>ของในสต๊อก</th>
                {seesCost && <th className="col-amount">ต้นทุน</th>}
                {seesCost && <th className="col-amount">กำไรประมาณ</th>}
                {mayEditList && <th aria-label="จัดการ" />}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, SHOWN_ON_SCREEN).map((r) => (
                <tr key={r.key}>
                  <td data-label="รุ่นรถ">{r.brand ? `${r.brand} ${r.model_name}` : <span className="pl-muted">ทุกรุ่น / ยังไม่ระบุ</span>}</td>
                  <td data-label="รายการ">
                    {r.item_name}
                    {r.is_set && <span className="pl-chip">ชุดโปร</span>}
                    {r.source === 'typed' && <span className="pl-chip pl-chip--typed">ราคาที่กรอกล่าสุด · {r.times} ครั้ง</span>}
                    {r.source === 'catalog' && r.total_price === null && <span className="pl-chip pl-chip--typed">ยังไม่ตั้งราคา</span>}
                    {r.category && <small className="pl-codes">{r.category}</small>}
                  </td>
                  <td className="col-amount" data-label="ราคาอะไหล่">{money(r.part_price)}</td>
                  <td className="col-amount" data-label="ค่าแรง">{money(r.labor_price)}</td>
                  <td className="col-amount pl-total" data-label="รวม"><b>{money(r.total_price)}</b></td>
                  <td data-label="ของในสต๊อก"><StockCell row={r} /></td>
                  {seesCost && (
                    <td className="col-amount" data-label="ต้นทุน">
                      {r.cost_min === undefined ? '-' : r.cost_min === r.cost_max ? money(r.cost_min) : `${money(r.cost_min)} - ${money(r.cost_max)}`}
                    </td>
                  )}
                  {seesCost && (
                    <td className="col-amount" data-label="กำไรประมาณ">
                      {r.cost_min === undefined ? '-' : (
                        <span className={r.below_cost ? 'pl-out-of-stock' : ''}>
                          {money(r.total_price - r.cost_max)}{r.below_cost ? ' ต่ำกว่าทุน' : ''}
                        </span>
                      )}
                    </td>
                  )}
                  {mayEditList && (
                    <td className="actions" data-label="จัดการ">
                      <button type="button" className="btn-icon-small" onClick={() => takeOff(r)} disabled={busy}>ลบ</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > SHOWN_ON_SCREEN && (
            <p className="pl-note pl-more">แสดง {SHOWN_ON_SCREEN} จาก {filtered.length.toLocaleString()} รายการ ค้นหาเพื่อแคบลง · พิมพ์และ Excel ได้ครบทุกรายการ</p>
          )}
        </div>
      )}

      <p className="pl-note pl-foot">
        ของในสต๊อกจับคู่จากรุ่นรถและประเภทอะไหล่ ไม่ได้ผูกกับรหัสโดยตรง ดูรหัสก่อนยืนยันกับลูกค้า
        {seesCost ? ' · ต้นทุนและกำไรเป็นค่าประมาณตามรหัสที่จับคู่ได้ ใบที่พิมพ์และไฟล์ Excel ไม่มีต้นทุน' : ''}
      </p>
    </div>
  );
}
