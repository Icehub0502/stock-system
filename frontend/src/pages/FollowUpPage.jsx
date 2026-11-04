import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { formatDateTh } from '../utils/dateGroups';
import { todayStr } from '../utils/format';
import { CASE_TYPE_LABEL, OUTCOME_LABEL, REPORT_RESULT_LABEL, addDays, addOneMonth } from '../utils/claimCases';

// "ติดตามผล": one page for calling customers after a fix. Staff see who to call today, phone the customer from the card
// and write the report right there; a manager closes the case on the same page once the calls are done.
// Data comes from GET /claims/follow-ups (backend/src/routes/claims.routes.js).

const NEXT_CHOICES = [
  { value: 'tomorrow', label: 'พรุ่งนี้' },
  { value: 'week', label: '1 สัปดาห์' },
  { value: 'month', label: '1 เดือน' },
  { value: 'custom', label: 'เลือกวันเอง' },
];

function nextDateOf(choice, customDate) {
  const today = todayStr();
  if (choice === 'tomorrow') return addDays(today, 1);
  if (choice === 'week') return addDays(today, 7);
  if (choice === 'month') return addOneMonth(today);
  if (choice === 'custom') return customDate;
  return null;
}

function CaseSummary({ row }) {
  // sent back by a call: the fix on the case is the one that did not work
  const lastReport = row.reports[row.reports.length - 1];
  const fixFailed = row.status === 'open' && lastReport?.result === 'still_problem';
  return (
    <>
      <div className="fu-car">
        <Link to={`/vehicle-history/${row.vehicle_id}`} className="fu-plate">
          {row.license_plate || 'ไม่มีทะเบียน'}{row.province ? ` ${row.province}` : ''}
        </Link>
        <span className="status-badge status-badge-neutral">{CASE_TYPE_LABEL[row.case_type] || 'เคส'}</span>
      </div>
      <div className="vh-muted">{row.brand} {row.model}{row.color ? ` · ${row.color}` : ''} · {row.claim_no} · {formatDateTh(row.claim_date)}</div>
      <div className="fu-customer">
        {row.customer_name}
        {row.phone && <a href={`tel:${row.phone}`} className="btn btn-secondary btn-sm fu-call">โทร {row.phone}</a>}
      </div>
      {row.symptom && <p className="fu-line"><strong>อาการ:</strong> {row.symptom}</p>}
      {row.finding && <p className="fu-line"><strong>ตรวจพบ:</strong> {row.finding}</p>}
      {row.resolution && <p className="fu-line"><strong>{fixFailed ? 'วิธีแก้ครั้งก่อน (ยังไม่หาย):' : 'วิธีแก้:'}</strong> {row.resolution}</p>}
      {row.items.length > 0 && (
        <p className="fu-line"><strong>อะไหล่:</strong> {row.items.map((i) => `${i.product_name}${i.quantity > 1 ? ` x${i.quantity}` : ''}`).join(', ')}</p>
      )}
      {row.reports.length > 0 && (
        <ul className="fu-reports">
          {row.reports.map((r) => (
            <li key={r.id}>
              <strong>{REPORT_RESULT_LABEL[r.result] || r.result}</strong>
              <span className="vh-muted"> · {formatDateTh(String(r.done_at).slice(0, 10))}{r.done_by ? ` · ${r.done_by}` : ''}</span>
              {r.note && <div>{r.note}</div>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// The call report, written on the card itself
function ReportForm({ row, onDone }) {
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [nextChoice, setNextChoice] = useState('');
  const [customDate, setCustomDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const chooseResult = (value) => {
    setResult(value);
    setError('');
    setNextChoice(value === 'no_answer' ? 'tomorrow' : '');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await client.post(`/claims/${row.id}/follow-ups/${row.pending.id}/report`, {
        result,
        note: note.trim() || null,
        next_date: nextDateOf(nextChoice, customDate) || undefined,
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกผลไม่สำเร็จ');
      setSaving(false);
    }
  };

  return (
    <div className="fu-form">
      <div className="fu-due">ครบกำหนดโทร {formatDateTh(row.pending.scheduled_date)}</div>
      <div className="fu-choices" role="group" aria-label="ผลการติดตาม">
        {Object.entries(REPORT_RESULT_LABEL).map(([value, label]) => (
          <button key={value} type="button" className={`btn btn-sm ${result === value ? 'btn-primary' : 'btn-secondary'}`} onClick={() => chooseResult(value)}>
            {label}
          </button>
        ))}
      </div>
      {result && (
        <>
          <label className="fu-label" htmlFor={`fu-note-${row.id}`}>
            รายงาน{result === 'no_answer' ? ' (ไม่บังคับ)' : ''}
          </label>
          <textarea
            id={`fu-note-${row.id}`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={result === 'no_answer' ? 'เช่น โทร 2 รอบ ไม่รับสาย' : 'ลูกค้าแจ้งว่าอย่างไร'}
          />
          {result !== 'still_problem' && (
            <>
              <label className="fu-label">{result === 'no_answer' ? 'โทรอีกครั้ง' : 'โทรติดตามอีกครั้งไหม (ไม่บังคับ)'}</label>
              <div className="fu-choices">
                {result !== 'no_answer' && (
                  <button type="button" className={`btn btn-sm ${nextChoice === '' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setNextChoice('')}>ไม่ต้อง</button>
                )}
                {NEXT_CHOICES.map((c) => (
                  <button key={c.value} type="button" className={`btn btn-sm ${nextChoice === c.value ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setNextChoice(c.value)}>
                    {c.label}
                  </button>
                ))}
              </div>
              {nextChoice === 'custom' && (
                <input type="date" min={todayStr()} value={customDate} onChange={(e) => setCustomDate(e.target.value)} aria-label="วันที่จะโทรอีกครั้ง" />
              )}
            </>
          )}
          {result === 'still_problem' && <p className="vh-muted">เคสจะกลับไปที่ "กำลังแก้" เมื่อแก้เสร็จแล้วค่อยตั้งวันติดตามใหม่</p>}
          {error && <div className="error-message">{error}</div>}
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'กำลังบันทึก...' : 'บันทึกรายงาน'}
          </button>
        </>
      )}
    </div>
  );
}

// Manager only: close the case. The lesson is what makes the case useful the next time the same problem comes in.
function CloseForm({ row, onDone }) {
  const [outcome, setOutcome] = useState('');
  const [lesson, setLesson] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await client.post(`/claims/${row.id}/close`, { outcome, lesson: lesson.trim() || null });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'ปิดเคสไม่สำเร็จ');
      setSaving(false);
    }
  };

  return (
    <div className="fu-form">
      <label className="fu-label">ผลสรุป</label>
      <div className="fu-choices" role="group" aria-label="ผลสรุปของเคส">
        {Object.entries(OUTCOME_LABEL).map(([value, label]) => (
          <button key={value} type="button" className={`btn btn-sm ${outcome === value ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOutcome(value)}>
            {label}
          </button>
        ))}
      </div>
      <label className="fu-label" htmlFor={`fu-lesson-${row.id}`}>แนวทางสำหรับเคสแบบนี้ครั้งหน้า (ไม่บังคับ)</label>
      <textarea id={`fu-lesson-${row.id}`} rows={2} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="เช่น ตรวจค่าทอร์คทุกครั้งก่อนส่งรถ" />
      {error && <div className="error-message">{error}</div>}
      <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !outcome}>
        {saving ? 'กำลังปิดเคส...' : 'ปิดเคส'}
      </button>
    </div>
  );
}

function Section({ title, hint, rows, emptyText, children }) {
  return (
    <div className="dash-panel">
      <div className="dash-panel-title">{title} ({rows.length})</div>
      {hint && <p className="vh-muted">{hint}</p>}
      {rows.length === 0 ? <p className="vh-muted">{emptyText}</p> : rows.map((row) => (
        <div key={row.id} className="visit-card vh-card">
          <CaseSummary row={row} />
          {children && children(row)}
        </div>
      ))}
    </div>
  );
}

export default function FollowUpPage() {
  const { user } = useAuth();
  const canClose = hasRole(user, 'manager');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    client.get('/claims/follow-ups')
      .then((res) => { setData(res.data.data); setError(''); })
      .catch((err) => setError(err.response?.data?.error || 'โหลดรายการไม่สำเร็จ'));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ติดตามผล</h1>
          <p className="subtitle">โทรถามลูกค้าหลังแก้งาน แล้วเขียนรายงานในหน้านี้ได้เลย</p>
        </div>
        <div className="quotation-actions">
          <Link to="/claims" className="btn btn-secondary">เคสทั้งหมด / เปิดเคสใหม่</Link>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      {!data && !error && <div className="loading">กำลังโหลด...</div>}
      {data && (
        <>
          <Section title="ต้องโทรวันนี้" rows={data.due} emptyText="วันนี้ไม่มีลูกค้าที่ต้องโทร">
            {/* keyed by the planned call: the next call of the same case starts with an empty form */}
            {(row) => <ReportForm key={row.pending.id} row={row} onDone={load} />}
          </Section>
          <Section
            title="รอผู้จัดการปิดเคส"
            hint={canClose ? null : 'โทรติดตามครบแล้ว ผู้จัดการจะเป็นคนปิดเคส'}
            rows={data.ready}
            emptyText="ไม่มีเคสที่รอปิด"
          >
            {canClose ? (row) => <CloseForm row={row} onDone={load} /> : null}
          </Section>
          <Section title="กำลังแก้" hint="เคสที่ยังแก้ไม่เสร็จ แก้เสร็จแล้วกดแก้ไขเคสเพื่อบันทึกวิธีแก้และตั้งวันติดตาม" rows={data.open} emptyText="ไม่มีเคสค้าง">
            {(row) => <Link to={`/claims?open=${row.id}`} className="btn btn-secondary btn-sm fu-call fu-edit">แก้ไขเคส</Link>}
          </Section>
          <Section title="นัดโทรวันถัดไป" rows={data.upcoming} emptyText="ยังไม่มีนัดโทรล่วงหน้า">
            {(row) => <div className="fu-due">นัดโทร {formatDateTh(row.pending.scheduled_date)}</div>}
          </Section>
        </>
      )}
    </div>
  );
}
