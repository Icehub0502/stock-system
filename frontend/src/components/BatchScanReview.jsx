import React, { useCallback, useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { ScanPositionChip as PositionChip } from './PositionChip';
import { applyReviewDecisions, basketQty, sideBalanceNote } from '../utils/scanBatch';

const SIDE_LABEL = { left: 'ซ้าย', right: 'ขวา' };

function QtyStepper({ code, qty, onChange }) {
  return (
    <div className="scan-batch-stepper scan-batch-stepper--light">
      <button type="button" disabled={qty <= 1} onClick={() => onChange(code, qty - 1)} aria-label={`ลดจำนวน ${code}`}>−</button>
      <b aria-label={`จำนวน ${code}`}>{qty}</b>
      <button type="button" onClick={() => onChange(code, qty + 1)} aria-label={`เพิ่มจำนวน ${code}`}>+</button>
    </div>
  );
}

function RemoveButton({ code, onRemove }) {
  return (
    <button type="button" className="scan-review-remove" onClick={() => onRemove(code)} aria-label={`เอา ${code} ออก`}>✕</button>
  );
}

// the fields a new item needs, once per item (a confirmed pair shares them)
function NewItemFields({ id, detail, categories, onChange, children }) {
  const missing = !detail.category_id;
  return (
    <div className="scan-review-fields">
      <div>
        <label className="scan-label" htmlFor={`${id}-cat`}>หมวดหมู่ <span className="scan-review-required">จำเป็น</span></label>
        <select id={`${id}-cat`} className={`scan-input${missing ? ' has-error' : ''}`} value={detail.category_id || ''}
          onChange={(e) => onChange({ category_id: e.target.value })}>
          <option value="">-- เลือกหมวดหมู่ --</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="scan-label" htmlFor={`${id}-desc`}>รายละเอียดสินค้า</label>
        <input id={`${id}-desc`} className="scan-input" maxLength={500} value={detail.description || ''}
          placeholder="เช่น โช้คหน้า TOYOTA VIGO" onChange={(e) => onChange({ description: e.target.value })} />
      </div>
      <div>
        <label className="scan-label" htmlFor={`${id}-cost`}>ต้นทุนต่อชิ้น (บาท)</label>
        <input id={`${id}-cost`} className="scan-input" type="number" inputMode="decimal" min="0" step="0.01"
          value={detail.unit_cost ?? ''} placeholder="ใส่ทีหลังได้" onChange={(e) => onChange({ unit_cost: e.target.value })} />
      </div>
      {children}
    </div>
  );
}

// The check between scanning and the bill. The server sorts the codes; everything it is unsure about waits for a
// person: nothing here touches stock, and a pair is only a suggestion until "ยืนยันคู่" is pressed.
export default function BatchScanReview({ sessionId, basket, details, onDetailsChange, decisions, onDecisionsChange, onBack, onApplied }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canRecheck, setCanRecheck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [newCategory, setNewCategory] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [resolved, setResolved] = useState({ known: [], choose: [], attach: [], pairs: [], singles: [], invalid: [] });
  const { invalid } = resolved;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setCanRecheck(false);
    try {
      const res = await client.post('/stock-receive/batch/resolve', { codes: basket.items.map((row) => row.code) });
      setResolved(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'ตรวจรายการที่สแกนไม่สำเร็จ');
      setCanRecheck(true);
    } finally {
      setLoading(false);
    }
    // the check runs on opening and on request, not on every change of a quantity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    client.get('/stock-items/categories').then((res) => setCategories(res.data)).catch(() => setError('โหลดหมวดหมู่ไม่สำเร็จ'));
  }, []);

  const qtyOf = (code) => basketQty(basket.items, code);
  const { known, choose, attach, pairs, singles } = useMemo(
    () => applyReviewDecisions(resolved, decisions, (code) => basketQty(basket.items, code) > 0),
    [resolved, decisions, basket.items]
  );

  // a category chosen in the bulk box stands for every item without its own, including pairs confirmed later
  const bulkCategory = details.__bulk || '';
  const setBulkCategory = (categoryId) => onDetailsChange((prev) => ({ ...prev, __bulk: categoryId }));
  const detailOf = (key) => {
    const detail = details[key] || {};
    return detail.category_id ? detail : { ...detail, category_id: bulkCategory };
  };
  const setDetail = (key, change) => onDetailsChange((prev) => ({ ...prev, [key]: { ...prev[key], ...change } }));

  const removeCode = (code) => basket.setQty(code, 0);

  // every choice below goes into the decisions; the lists on screen are worked out from them
  const up = (code) => code.toUpperCase();
  const withoutKey = (map, key) => {
    const { [key]: dropped, ...rest } = map;
    return rest;
  };
  const pickMatch = (entry, match) => onDecisionsChange((d) => ({
    ...d, chosen: { ...d.chosen, [up(entry.code)]: { item_id: match.item_id, position: match.position } },
  }));
  const treatAsNew = (code) => onDecisionsChange((d) => ({ ...d, asNew: { ...d.asNew, [up(code)]: true } }));
  const undoNew = (code) => onDecisionsChange((d) => ({ ...d, asNew: withoutKey(d.asNew, up(code)) }));
  const setAttached = (code, yes) => onDecisionsChange((d) => ({
    ...d, attached: yes ? { ...d.attached, [up(code)]: true } : withoutKey(d.attached, up(code)),
  }));
  const savePairs = (list) => onDecisionsChange((d) => {
    const codes = new Set(list.flatMap((p) => [up(p.left), up(p.right)]));
    const others = d.pairs.filter((p) => !codes.has(up(p.left)) && !codes.has(up(p.right)));
    return { ...d, pairs: [...others, ...list] };
  });
  const confirmPairs = (list) => savePairs(list.map((p) => ({ left: p.left, right: p.right, confirmed: true })));
  const swapPair = (pair) => {
    // what was typed for the pair stays with it, it is filed under the left code
    onDetailsChange((prev) => (prev[pair.left] ? { ...prev, [pair.right]: prev[pair.left] } : prev));
    savePairs([{ left: pair.right, right: pair.left, confirmed: pair.confirmed }]);
  };
  const splitPair = (pair) => onDecisionsChange((d) => ({
    ...d,
    pairs: d.pairs.filter((p) => up(p.left) !== up(pair.left) || up(p.right) !== up(pair.right)),
    asNew: { ...d.asNew, [up(pair.left)]: true, [up(pair.right)]: true },
  }));
  const pairByHand = (left, right) => savePairs([{ left, right, confirmed: true }]);

  const addCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    setAddingCategory(true);
    try {
      const res = await client.post('/stock-items/categories', { name });
      setCategories((list) => [...list, res.data]);
      setBulkCategory(String(res.data.id));
      setNewCategory('');
    } catch (err) {
      setError(err?.response?.data?.error || 'เพิ่มหมวดหมู่ไม่สำเร็จ');
    } finally {
      setAddingCategory(false);
    }
  };

  // rows of the same item sit together, so left and right read as one part
  const knownGroups = useMemo(() => {
    const groups = new Map();
    for (const row of known) {
      if (!groups.has(row.match.item_id)) groups.set(row.match.item_id, []);
      groups.get(row.match.item_id).push(row);
    }
    return [...groups.values()];
  }, [known]);

  const newKeys = [...pairs.filter((p) => p.confirmed).map((p) => p.left), ...singles.map((s) => s.code)];
  const undecided = choose.length + attach.filter((row) => !row.accepted).length + pairs.filter((p) => !p.confirmed).length;
  const noCategory = newKeys.filter((key) => !detailOf(key).category_id).length;
  const codeCount = known.length + attach.length + pairs.length * 2 + singles.length + choose.length;
  const canApply = !loading && !saving && codeCount > 0 && undecided === 0 && noCategory === 0;

  const apply = async () => {
    const costOf = (detail) => (detail.unit_cost === '' || detail.unit_cost === undefined ? undefined : detail.unit_cost);
    const body = {
      receipt_session_id: sessionId,
      known: known.map((row) => ({ item_id: row.match.item_id, position: row.match.position, qty: qtyOf(row.code) })),
      attach: attach.map((row) => ({ item_id: row.item_id, position: row.position, code: row.code, qty: qtyOf(row.code) })),
      new_items: [
        ...pairs.map((pair) => {
          const detail = detailOf(pair.left);
          return {
            category_id: Number(detail.category_id),
            description: (detail.description || '').trim(),
            unit_cost: costOf(detail),
            has_sides: true,
            codes: { left: pair.left, right: pair.right },
            qtys: { left: qtyOf(pair.left), right: qtyOf(pair.right) },
          };
        }),
        ...singles.map((single) => {
          const detail = detailOf(single.code);
          const shared = {
            category_id: Number(detail.category_id),
            description: (detail.description || '').trim(),
            unit_cost: costOf(detail),
          };
          return detail.split && single.side
            ? { ...shared, has_sides: true, codes: { [single.side]: single.code }, qtys: { [single.side]: qtyOf(single.code) } }
            : { ...shared, oem_code: single.code, qty: qtyOf(single.code) };
        }),
      ],
    };
    setSaving(true);
    setError('');
    try {
      const res = await client.post('/stock-receive/batch/apply', body);
      onApplied(res.data.lines);
    } catch (err) {
      setError(err?.response?.data?.error || 'เพิ่มรายการเข้าบิลไม่สำเร็จ');
      setCanRecheck(err?.response?.status === 409);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="scan-shell scan-shell--wide scan-review">
      <header className="scan-head">
        <button type="button" className="scan-icon-btn" onClick={onBack} aria-label="กลับไปสแกนเพิ่ม">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="20" height="20">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div>
          <h1 className="scan-title">ตรวจรายการที่สแกน</h1>
          <p className="scan-subtitle">{basket.items.length} รหัส · {basket.totalQty} ชิ้น · ยังไม่เข้าบิลจนกว่าจะกดด้านล่าง</p>
        </div>
      </header>

      {loading && <p className="scan-sheet-empty">กำลังตรวจรายการ...</p>}

      {!loading && invalid.length > 0 && (
        <p className="scan-review-note">อ่านไม่ได้ {invalid.length} รายการ จะไม่ถูกเพิ่มเข้าบิล</p>
      )}

      {!loading && knownGroups.length > 0 && (
        <section className="scan-review-section" aria-label="มีในสต๊อกแล้ว">
          <h2>มีในสต๊อกแล้ว <small>{known.length} รหัส</small></h2>
          {knownGroups.map((rows) => {
            const note = sideBalanceNote(rows.map((row) => ({ position: row.match.position, qty: qtyOf(row.code) })));
            return (
              <div className="scan-review-card" key={rows[0].match.item_id}>
                <p className="scan-review-name">{rows[0].match.category_name} · {rows[0].match.description || rows[0].match.code}</p>
                {rows.map((row) => (
                  <div className="scan-review-row" key={row.code}>
                    <div className="scan-row-code">
                      <PositionChip position={row.match.position} />
                      <span className="scan-code">{row.code}</span>
                      <small className="scan-review-stock">คงเหลือ {row.match.qty}</small>
                    </div>
                    <QtyStepper code={row.code} qty={qtyOf(row.code)} onChange={basket.setQty} />
                    <RemoveButton code={row.code} onRemove={removeCode} />
                  </div>
                ))}
                {note && <p className="scan-review-warn">{note}</p>}
              </div>
            );
          })}
        </section>
      )}

      {!loading && (choose.length > 0 || attach.length > 0) && (
        <section className="scan-review-section" aria-label="ต้องเลือก">
          <h2>ต้องเลือก <small>{choose.length + attach.filter((row) => !row.accepted).length} รหัส</small></h2>
          {choose.map((entry) => (
            <div className="scan-review-card" key={entry.code}>
              <div className="scan-review-row">
                <div className="scan-row-code"><span className="scan-code">{entry.code}</span></div>
                <QtyStepper code={entry.code} qty={qtyOf(entry.code)} onChange={basket.setQty} />
                <RemoveButton code={entry.code} onRemove={removeCode} />
              </div>
              <p className="scan-review-note">
                {entry.loose ? 'ไม่ตรงทุกตัว แต่คล้ายรหัสในสต๊อก ใช่รายการไหน?' : 'รหัสนี้ตรงกับหลายรายการ เลือกรายการที่รับเข้า'}
              </p>
              {entry.matches.map((match) => (
                <button type="button" className="scan-review-choice" key={`${match.item_id}-${match.position || 'one'}`} onClick={() => pickMatch(entry, match)}>
                  <PositionChip position={match.position} />
                  <span className="scan-code">{match.code}</span>
                  <span className="scan-review-choice-name">{match.category_name} · {match.description || '—'}</span>
                </button>
              ))}
              {entry.loose && (
                <button type="button" className="scan-btn scan-btn--ghost scan-btn--sm" onClick={() => treatAsNew(entry.code)}>ไม่ใช่ เป็นรายการใหม่</button>
              )}
            </div>
          ))}
          {attach.map((row) => (
            <div className="scan-review-card" key={row.code}>
              <div className="scan-review-row">
                <div className="scan-row-code">
                  {row.accepted && <PositionChip position={row.position} />}
                  <span className="scan-code">{row.code}</span>
                </div>
                <QtyStepper code={row.code} qty={qtyOf(row.code)} onChange={basket.setQty} />
                <RemoveButton code={row.code} onRemove={removeCode} />
              </div>
              <p className="scan-review-note">
                น่าจะเป็นข้าง{row.position_label}ของ <b>{row.description || row.partner_code}</b> ({row.partner_label} {row.partner_code}) ที่ยังไม่มีรหัสข้างนี้
              </p>
              {row.accepted ? (
                <div className="scan-review-actions">
                  <p className="scan-review-ok">ยืนยันแล้ว ใส่เป็นรหัสข้าง{row.position_label}ของรายการนี้</p>
                  <button type="button" className="scan-btn scan-btn--ghost scan-btn--sm" onClick={() => setAttached(row.code, false)}>ยกเลิก</button>
                </div>
              ) : (
                <div className="scan-review-actions">
                  <button type="button" className="scan-btn scan-btn--dark scan-btn--sm" onClick={() => setAttached(row.code, true)}>ใช่ ใส่รหัสนี้</button>
                  <button type="button" className="scan-btn scan-btn--ghost scan-btn--sm" onClick={() => treatAsNew(row.code)}>ไม่ใช่ เป็นรายการใหม่</button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {!loading && (pairs.length > 0 || singles.length > 0) && (
        <section className="scan-review-section" aria-label="รหัสใหม่">
          <h2>รหัสใหม่ <small>{pairs.length > 0 ? `น่าจะเป็นคู่ ${pairs.length} คู่ · ` : ''}เดี่ยว {singles.length} รหัส</small></h2>

          <div className="scan-review-card scan-review-bulk">
            <label className="scan-label" htmlFor="scan-review-bulk-cat">ใส่หมวดให้ทุกรายการที่ยังไม่เลือก</label>
            <select id="scan-review-bulk-cat" className="scan-input" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}>
              <option value="">-- เลือกหมวดหมู่ --</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="scan-review-newcat">
              <input className="scan-input" maxLength={100} placeholder="ชื่อหมวดใหม่ ถ้ายังไม่มี" aria-label="ชื่อหมวดใหม่"
                value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
              <button type="button" className="scan-btn scan-btn--ghost" onClick={addCategory} disabled={addingCategory || !newCategory.trim()}>เพิ่มหมวด</button>
            </div>
          </div>

          {pairs.filter((p) => !p.confirmed).length > 1 && (
            <button
              type="button"
              className="scan-btn scan-btn--dark scan-btn--block scan-review-confirm-all"
              onClick={() => confirmPairs(pairs)}
            >
              ยืนยันทุกคู่ ({pairs.filter((p) => !p.confirmed).length} คู่)
            </button>
          )}

          {pairs.map((pair) => {
            const note = sideBalanceNote([{ position: 'left', qty: qtyOf(pair.left) }, { position: 'right', qty: qtyOf(pair.right) }]);
            return (
              <div className="scan-review-card scan-review-pair" key={`${pair.left}|${pair.right}`}>
                {[['left', pair.left], ['right', pair.right]].map(([position, code]) => (
                  <div className="scan-review-row" key={position}>
                    <div className="scan-row-code">
                      <PositionChip position={position} />
                      <span className="scan-code">{code}</span>
                    </div>
                    <QtyStepper code={code} qty={qtyOf(code)} onChange={basket.setQty} />
                    <RemoveButton code={code} onRemove={removeCode} />
                  </div>
                ))}
                {note && <p className="scan-review-warn">{note}</p>}
                <div className="scan-review-actions">
                  {!pair.confirmed && <button type="button" className="scan-btn scan-btn--dark scan-btn--sm" onClick={() => confirmPairs([pair])}>ยืนยันคู่</button>}
                  <button type="button" className="scan-btn scan-btn--ghost scan-btn--sm" onClick={() => splitPair(pair)}>{pair.confirmed ? 'แยกคู่' : 'ไม่ใช่คู่'}</button>
                  <button type="button" className="scan-btn scan-btn--ghost scan-btn--sm" onClick={() => swapPair(pair)}>สลับซ้าย/ขวา</button>
                </div>
                {pair.confirmed && (
                  <NewItemFields id={`pair-${pair.left}`} detail={detailOf(pair.left)} categories={categories} onChange={(change) => setDetail(pair.left, change)} />
                )}
              </div>
            );
          })}

          {singles.map((single) => {
            const detail = detailOf(single.code);
            const others = singles.filter((other) => other.code !== single.code);
            return (
              <div className="scan-review-card" key={single.code}>
                <div className="scan-review-row">
                  <div className="scan-row-code"><span className="scan-code">{single.code}</span></div>
                  <QtyStepper code={single.code} qty={qtyOf(single.code)} onChange={basket.setQty} />
                  <RemoveButton code={single.code} onRemove={removeCode} />
                </div>
                {single.origin && (
                  <div className="scan-review-actions">
                    <p className="scan-review-note">เลือกไว้ว่าเป็นรายการใหม่ ไม่ใช่ {single.origin.like}</p>
                    <button type="button" className="scan-btn scan-btn--ghost scan-btn--sm" onClick={() => undoNew(single.code)}>ย้อนกลับ</button>
                  </div>
                )}
                {single.partner && (
                  <p className="scan-review-note">รหัสอีกข้าง {single.partner.code} ({single.partner.description || 'ไม่มีชื่อ'}) เป็นรายการแยกอยู่แล้ว ระบบจะไม่รวมให้</p>
                )}
                {others.length > 0 && (
                  <div className="scan-review-manual">
                    <label className="scan-label" htmlFor={`pair-with-${single.code}`}>จับคู่เอง (รหัสซ้ายขวาคนละเลข)</label>
                    <select id={`pair-with-${single.code}`} className="scan-input" value="" onChange={(e) => e.target.value && pairByHand(single.code, e.target.value)}>
                      <option value="">-- เลือกรหัสอีกข้าง --</option>
                      {others.map((other) => <option key={other.code} value={other.code}>{other.code}</option>)}
                    </select>
                  </div>
                )}
                <NewItemFields id={`single-${single.code}`} detail={detail} categories={categories} onChange={(change) => setDetail(single.code, change)}>
                  {single.side && !single.partner && (
                    <label className="scan-review-split">
                      <input type="checkbox" checked={Boolean(detail.split)} onChange={(e) => setDetail(single.code, { split: e.target.checked })} />
                      รหัสนี้ดูเป็นข้าง{SIDE_LABEL[single.side]} สร้างเป็นรายการแยกซ้าย/ขวา เผื่ออีกข้างมาทีหลัง (เปลี่ยนภายหลังไม่ได้)
                    </label>
                  )}
                </NewItemFields>
              </div>
            );
          })}
        </section>
      )}

      {!loading && codeCount === 0 && !error && <p className="scan-sheet-empty">ไม่มีรายการเหลือแล้ว</p>}

      {error && (
        <div className="scan-review-error" role="alert">
          <p className="scan-error">{error}</p>
          {canRecheck && <button type="button" className="scan-btn scan-btn--ghost scan-btn--sm" onClick={load}>ตรวจรายการอีกครั้ง</button>}
        </div>
      )}

      {!loading && (
        <div className="scan-review-footer">
          {undecided > 0 && <p className="scan-review-warn">ยังมี {undecided} รายการที่ต้องตัดสินใจ</p>}
          {undecided === 0 && noCategory > 0 && <p className="scan-review-warn">ยังไม่ได้เลือกหมวดหมู่ {noCategory} รายการ</p>}
          <div className="scan-actions">
            <button type="button" className="scan-btn scan-btn--ghost scan-btn--lg" onClick={onBack}>สแกนเพิ่ม</button>
            <button type="button" className="scan-btn scan-btn--in scan-btn--lg" onClick={apply} disabled={!canApply}>
              {saving ? 'กำลังเพิ่ม...' : 'เพิ่มเข้าบิล'}
            </button>
          </div>
          <p className="scan-hint">ยังไม่บวกสต๊อก เข้าบิลเป็น “รอยืนยัน” ก่อน ต้นทุนใส่ทีหลังได้ที่แถวในบิล</p>
        </div>
      )}
    </div>
  );
}
