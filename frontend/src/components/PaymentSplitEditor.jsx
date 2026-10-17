import React from 'react';
import { PAYMENT_METHODS, PAYMENT_METHOD_CLASS } from '../utils/paymentMethods';

// เลือกช่องทางชำระได้มากกว่า 1 ช่องทาง (เช่น เงินสดครึ่งหนึ่ง + บัตรเครดิตอีกครึ่ง)
// selection = { [method]: amountString } — เลือกช่องเดียวไม่ต้องกรอกยอด (ใช้ยอดเต็มของบิล)
// เลือก ≥ 2 ช่องต้องกรอกยอดแต่ละช่อง และยอดรวมต้องเท่ายอดบิล

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function formatMoney(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ค่าเริ่มต้นจากข้อมูลบิล: บิลที่แบ่งไว้ใช้ payments, บิลช่องทางเดียวใช้ payment_method (รวมค่าเก่าเช่น "โอน")
export function initialSelection(payments, paymentMethod) {
  if (Array.isArray(payments) && payments.length > 0) {
    return Object.fromEntries(payments.map((p) => [p.method, String(p.amount)]));
  }
  return paymentMethod ? { [paymentMethod]: '' } : {};
}

// → { payment_method, payment_splits } พร้อมส่ง API หรือ { error } ถ้ายังไม่ถูกต้อง
export function selectionToPayload(selection, total) {
  const methods = Object.keys(selection);
  if (methods.length === 0) return { payment_method: '', payment_splits: [] };
  if (methods.length === 1) return { payment_method: methods[0], payment_splits: [] };
  const splits = [];
  for (const method of methods) {
    const amount = round2(selection[method]);
    if (!(amount > 0)) return { error: `กรอกยอดของ ${method} (ต้องมากกว่า 0)` };
    splits.push({ method, amount });
  }
  const sum = round2(splits.reduce((a, s) => a + s.amount, 0));
  const t = round2(total);
  if (Math.abs(sum - t) > 0.01) {
    return { error: `ยอดรวมช่องทางชำระ ${formatMoney(sum)} ไม่เท่ายอดบิล ${formatMoney(t)}` };
  }
  return { payment_method: '', payment_splits: splits };
}

export default function PaymentSplitEditor({ selection, onChange, total }) {
  const extras = Object.keys(selection).filter((m) => !PAYMENT_METHODS.includes(m));
  const methods = [...PAYMENT_METHODS, ...extras];
  const selected = Object.keys(selection);
  const multi = selected.length > 1;

  const toggle = (method) => {
    const next = { ...selection };
    if (method in next) {
      delete next[method];
    } else {
      next[method] = '';
    }
    // เหลือ/มี 2 ช่องพอดี → เติมยอดที่เหลือให้ช่องหลังอัตโนมัติ เริ่มจากแบ่งครึ่ง
    const keys = Object.keys(next);
    if (keys.length === 2) {
      const half = round2(Number(total) / 2);
      next[keys[0]] = String(half);
      next[keys[1]] = String(round2(Number(total) - half));
    }
    onChange(next);
  };

  const setAmount = (method, value) => {
    const next = { ...selection, [method]: value };
    const keys = Object.keys(next);
    if (keys.length === 2) {
      // สองช่องทาง: แก้ช่องหนึ่ง อีกช่องคำนวณส่วนที่เหลือให้
      const other = keys.find((k) => k !== method);
      const rest = round2(Number(total) - Number(value || 0));
      next[other] = rest > 0 ? String(rest) : '';
    }
    onChange(next);
  };

  const sum = round2(selected.reduce((a, m) => a + Number(selection[m] || 0), 0));
  const diff = round2(Number(total) - sum);

  return (
    <div className="pay-split">
      <div className="pay-split-chips">
        {methods.map((m) => {
          const on = m in selection;
          return (
            <button
              type="button"
              key={m}
              className={`pay-split-chip ${PAYMENT_METHOD_CLASS[m] || 'pay-chip-other'}${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => toggle(m)}
            >
              <span className="pay-split-check">{on ? '✓' : ''}</span>
              {m}
            </button>
          );
        })}
      </div>
      {multi ? (
        <div className="pay-split-amounts">
          {selected.map((m) => (
            <label key={m} className="pay-split-amount-row">
              <span>{m}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={selection[m]}
                onChange={(e) => setAmount(m, e.target.value)}
              />
              <span className="pay-split-unit">บาท</span>
            </label>
          ))}
          <div className={`pay-split-status${Math.abs(diff) > 0.01 ? ' is-bad' : ' is-ok'}`}>
            {Math.abs(diff) > 0.01
              ? `${diff > 0 ? 'ยังขาดอีก' : 'เกินมา'} ฿${formatMoney(Math.abs(diff))} (ยอดบิล ฿${formatMoney(total)})`
              : `ครบยอดบิล ฿${formatMoney(total)}`}
          </div>
        </div>
      ) : (
        <div className="pay-split-hint">
          {selected.length === 1
            ? `รับเต็มยอด ฿${formatMoney(total)} ทางช่องทางเดียว — เลือกเพิ่มอีกช่องทางเพื่อแบ่งจ่าย`
            : 'เลือกช่องทางที่ลูกค้าชำระ (เลือกได้มากกว่า 1 ช่องทาง)'}
        </div>
      )}
    </div>
  );
}
