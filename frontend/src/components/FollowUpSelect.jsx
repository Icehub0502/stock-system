import React from 'react';
import { todayStr } from '../utils/format';
import { formatDateTh } from '../utils/dateGroups';
import { FOLLOW_UP_CHOICES } from '../utils/claimCases';

// When to call the customer after a fix: used by the case form and by the question asked when a repair ends.
// pendingDate is a call already planned; picking nothing keeps it.
export default function FollowUpSelect({ choice, onChoice, customDate, onCustomDate, pendingDate }) {
  return (
    <div className="form-group">
      <label>
        ติดตามผล
        {pendingDate ? ` (นัดโทร ${formatDateTh(pendingDate)})` : ''}
      </label>
      <select value={choice} onChange={(e) => onChoice(e.target.value)}>
        <option value="">{pendingDate ? 'คงวันเดิม' : 'ยังไม่ตั้ง (ยังแก้ไม่เสร็จ)'}</option>
        {FOLLOW_UP_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {choice === 'custom' && (
        <input type="date" min={todayStr()} value={customDate} onChange={(e) => onCustomDate(e.target.value)} aria-label="วันที่ติดตามผล" />
      )}
    </div>
  );
}
