import React, { useCallback, useEffect, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { canChange, canMoveStock } from '../utils/roles';
import { formatMoney } from '../utils/format';
import usePaymentMethods from '../hooks/usePaymentMethods';
import { ScanPositionChip as PositionChip } from './PositionChip';
import ReceiptPrintModal from './ReceiptPrintModal';

// The parts and money of a claim case: take what was used out of stock (many parts on a case were never in stock, so
// each is picked by hand), and turn what the customer pays into an ordinary receipt, which puts it in the daily sales.
export default function ClaimPartsModal({ claimId, onClose, onChanged }) {
  const { user } = useAuth();
  const mayCharge = canChange(user, 'office');
  const mayMoveStock = canMoveStock(user);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);
  const [qty, setQty] = useState('1');
  const [method, setMethod] = useState('');
  const [printId, setPrintId] = useState(null);
  const paymentMethods = usePaymentMethods();

  const load = useCallback(async () => {
    try {
      const res = await client.get(`/claims/${claimId}/parts`);
      setData(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดข้อมูลอะไหล่ของเคสไม่สำเร็จ');
    }
  }, [claimId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setMatches([]); return undefined; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      client.get('/stock-receive/search', { params: { q: term } })
        .then((res) => { if (!cancelled) setMatches(res.data.matches || []); })
        .catch(() => { if (!cancelled) setMatches([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const changed = async () => {
    await load();
    if (onChanged) onChanged();
  };

  const deduct = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await client.post(`/claims/${claimId}/parts/deduct`, { item_id: picked.item_id, position: picked.position, qty: Number(qty) });
      setPicked(null);
      setQuery('');
      setQty('1');
      await changed();
    } catch (err) {
      setError(err.response?.data?.error || 'ตัดสต๊อกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const undoMove = async (move) => {
    if (!window.confirm(`คืน "${move.description || move.code}" ${move.qty} ชิ้น กลับเข้าสต๊อก?`)) return;
    setBusy(true);
    setError('');
    try {
      await client.delete(`/stock-deductions/movements/${move.id}`);
      await changed();
    } catch (err) {
      setError(err.response?.data?.error || 'คืนสต๊อกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const issueReceipt = async () => {
    if (!window.confirm(`ออกใบเสร็จค่าอะไหล่ ฿${formatMoney(data.charge_total)} ช่องทาง ${method}? ยอดนี้จะเข้ายอดขายวันนี้`)) return;
    setBusy(true);
    setError('');
    try {
      await client.post(`/claims/${claimId}/charge-receipt`, { payment_method: method });
      await changed();
    } catch (err) {
      setError(err.response?.data?.error || 'ออกใบเสร็จไม่สำเร็จ');
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card medium" role="dialog" aria-modal="true" aria-label="อะไหล่และค่าใช้จ่ายของเคส" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">อะไหล่และค่าใช้จ่าย {data ? `· ${data.claim_no}` : ''}</h3>
        {!data ? (
          error ? <p className="error-text">{error}</p> : <div className="loading">กำลังโหลด...</div>
        ) : (
          <>
            <section className="cp-section">
              <h4>อะไหล่ในเคส</h4>
              {data.items.length === 0 ? <p className="cp-note">เคสนี้ยังไม่มีรายการอะไหล่</p> : data.items.map((it) => (
                <div className="cp-row" key={it.id}>
                  <span>{it.product_name} × {it.quantity}</span>
                  <b>{Number(it.unit_price) > 0 ? `฿${formatMoney(it.quantity * it.unit_price)}` : 'ไม่คิดเงิน'}</b>
                </div>
              ))}
            </section>

            <section className="cp-section">
              <h4>ตัดสต๊อก</h4>
              {data.moves.length === 0 && <p className="cp-note">ยังไม่ได้ตัดสต๊อก ถ้าอะไหล่ไม่ได้มาจากสต๊อกของร้าน (เช่น ร้านอะไหล่เปลี่ยนให้) ไม่ต้องตัด</p>}
              {data.moves.map((move) => (
                <div className="cp-row" key={move.id}>
                  <span><PositionChip position={move.position} /> <span className="scan-code">{move.code}</span> {move.description} × {move.qty}</span>
                  {mayMoveStock && <button type="button" className="cp-undo" onClick={() => undoMove(move)} disabled={busy}>คืนสต๊อก</button>}
                </div>
              ))}

              {!mayMoveStock ? null : picked ? (
                <form className="cp-pick" onSubmit={deduct}>
                  <p><PositionChip position={picked.position} /> <span className="scan-code">{picked.code}</span> {picked.description} (คงเหลือ {picked.qty})</p>
                  <label htmlFor="cp-qty">จำนวนที่ตัด</label>
                  <input id="cp-qty" type="number" inputMode="numeric" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
                  <button type="submit" className="btn-primary" disabled={busy || !(Number(qty) >= 1)}>ตัดสต๊อก</button>
                  <button type="button" onClick={() => setPicked(null)}>ยกเลิก</button>
                </form>
              ) : (
                <>
                  <input
                    type="text"
                    className="search-input cp-search"
                    placeholder="ค้นหาอะไหล่ในสต๊อก: รหัส ชื่อ รุ่นรถ"
                    aria-label="ค้นหาอะไหล่ในสต๊อก"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query.trim().length >= 2 && !searching && matches.length === 0 && <p className="cp-note">ไม่พบในสต๊อก</p>}
                  {matches.map((m) => (
                    <button type="button" className="cp-match" key={`${m.item_id}-${m.position || 'one'}`} onClick={() => { setPicked(m); setQty('1'); }}>
                      <span><PositionChip position={m.position} /> <span className="scan-code">{m.code || '-'}</span> {m.category_name} · {m.description || '-'}</span>
                      <small>คงเหลือ {m.qty}</small>
                    </button>
                  ))}
                </>
              )}
            </section>

            <section className="cp-section">
              <h4>เก็บเงินค่าอะไหล่</h4>
              {data.receipt ? (
                <>
                  <div className="cp-row">
                    <span>ใบเสร็จ <b>{data.receipt.receipt_no}</b> · {data.receipt.payment_method || 'ไม่ระบุช่องทาง'}</span>
                    <b>฿{formatMoney(data.receipt.total_amount)}</b>
                  </div>
                  {Number(data.receipt.total_amount) !== Number(data.charge_total) && (
                    <p className="cp-warn">รายการในเคสถูกแก้หลังออกใบเสร็จ ตอนนี้เคสคิด ฿{formatMoney(data.charge_total)} ถ้าจะให้ตรงกัน แก้ที่ใบเสร็จ</p>
                  )}
                  <button type="button" onClick={() => setPrintId(data.receipt.id)}>ดู / พิมพ์ใบเสร็จ</button>
                </>
              ) : Number(data.charge_total) > 0 && !mayCharge ? (
                <p className="cp-note">ยอดที่เก็บจากลูกค้า ฿{formatMoney(data.charge_total)} ยังไม่ได้ออกใบเสร็จ</p>
              ) : Number(data.charge_total) > 0 ? (
                <div className="cp-charge">
                  <p>ยอดที่เก็บจากลูกค้า <b>฿{formatMoney(data.charge_total)}</b> ยังไม่เข้ายอดขาย</p>
                  <label htmlFor="cp-method">ช่องทางชำระ</label>
                  <select id="cp-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="">-- เลือกช่องทาง --</option>
                    {paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <button type="button" className="btn-primary" onClick={issueReceipt} disabled={busy || !method}>ออกใบเสร็จ เข้ายอดขายวันนี้</button>
                  {!method && <p className="cp-note">เลือกช่องทางชำระก่อน จึงจะออกใบเสร็จได้</p>}
                </div>
              ) : (
                <p className="cp-note">เคสนี้ไม่คิดเงิน จึงไม่มียอดเข้ายอดขาย</p>
              )}
            </section>

            {error && <p className="error-text">{error}</p>}
            <div className="modal-actions"><button type="button" onClick={onClose}>ปิด</button></div>
          </>
        )}
      </div>
      {printId && (
        <div onClick={(e) => e.stopPropagation()}>
          <ReceiptPrintModal receiptId={printId} onClose={() => setPrintId(null)} onPrinted={() => setPrintId(null)} />
        </div>
      )}
    </div>
  );
}
