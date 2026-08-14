import React, { useState, useEffect, useRef, useMemo } from "react";
import client from "../api/client";
import { FOUND_VIA_CHANNELS, foundViaLabel, foundViaIcon } from "../utils/foundViaChannels";

// บันทึกว่าลูกค้าที่มีอยู่แล้วในระบบเจอร้านจากช่องทางไหน เก็บไว้ประกอบการตัดสินใจยิง
// โฆษณา — ต้องเป็นลูกค้าที่มีอยู่แล้วเท่านั้น (ค้นหาแบบเดียวกับตอนสร้างใบเสนอราคา ดู
// QuotationFormModal.jsx) ไม่สร้างลูกค้าใหม่จากหน้านี้
//
// เลือกช่องทางด้วยปุ่มกดแทน dropdown — พนักงานถามลูกค้าปากเปล่าแล้วกดทันทีหน้าเคาน์เตอร์
// เห็นตัวเลือกทั้งหมดพร้อมกันโดยไม่ต้องกางเมนู กดครั้งเดียวจบ (เร็วกว่าและพลาดยากกว่า)
// พร้อมโชว์ข้อมูลลูกค้า/รถ/ทะเบียนให้ยืนยันว่าเลือกถูกคนก่อนบันทึก
export default function CustomerChannelPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [channel, setChannel] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const [records, setRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [listError, setListError] = useState("");

  const searchAbortRef = useRef(null);
  const vehicleAbortRef = useRef(null);

  const fetchRecords = async () => {
    try {
      setLoadingRecords(true);
      const response = await client.get('/customers', { params: { found_via: 1 } });
      setRecords(response.data.data || []);
    } catch (err) {
      setListError(err.response?.data?.error || "เกิดข้อผิดพลาด");
    } finally {
      setLoadingRecords(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  const searchCustomers = async (value) => {
    if (!value) {
      setResults([]);
      return;
    }
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    try {
      const response = await client.get('/receipts/customers', { params: { search: value }, signal: controller.signal });
      setResults(response.data.data || []);
    } catch (err) {
      if (err.code === 'ERR_CANCELED') return;
      console.error('Error searching customers:', err);
    }
  };

  const handleQueryChange = (value) => {
    setQuery(value);
    setSelected(null);
    setVehicles([]);
    setResults([]);
    setSavedMsg("");
    if (value) searchCustomers(value);
  };

  const handleSelectCustomer = async (customer) => {
    setSelected(customer);
    setQuery(customer.customer_name);
    setResults([]);
    setChannel(customer.found_via || "");
    setNote(customer.found_via_note || "");
    setFormError("");
    setSavedMsg("");

    vehicleAbortRef.current?.abort();
    const controller = new AbortController();
    vehicleAbortRef.current = controller;
    try {
      const response = await client.get(`/receipts/customers/${customer.id}/vehicles`, { signal: controller.signal });
      setVehicles(response.data.data || []);
    } catch (err) {
      if (err.code === 'ERR_CANCELED') return;
      console.error('Error loading vehicles:', err);
      setVehicles([]);
    }
  };

  const clearSelection = () => {
    setSelected(null);
    setQuery("");
    setVehicles([]);
    setChannel("");
    setNote("");
    setFormError("");
  };

  const needsNote = channel === 'other';
  const canSubmit = selected && channel && (!needsNote || note.trim());

  const handleSubmit = async () => {
    if (!selected || !canSubmit) return;
    setSaving(true);
    setFormError("");
    try {
      await client.patch(`/customers/${selected.id}/found-via`, {
        channel,
        note: needsNote ? note.trim() : '',
      });
      setSavedMsg(`บันทึกแล้ว — ${selected.customer_name} เจอร้านจาก ${foundViaLabel(channel)}`);
      clearSelection();
      fetchRecords();
    } catch (err) {
      setFormError(err.response?.data?.error || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const channelCounts = useMemo(() => {
    const counts = Object.fromEntries(FOUND_VIA_CHANNELS.map((c) => [c.value, 0]));
    for (const r of records) {
      const key = counts.hasOwnProperty(r.found_via) ? r.found_via : 'other';
      counts[key] += 1;
    }
    return FOUND_VIA_CHANNELS
      .map((c) => ({ ...c, count: counts[c.value] }))
      .sort((a, b) => b.count - a.count);
  }, [records]);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ช่องทางที่ลูกค้าเจอเรา</h1>
          <p className="subtitle">ถามลูกค้าแล้วกดบันทึก — เก็บไว้ดูว่าควรลงโฆษณาช่องทางไหน</p>
        </div>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">บันทึกช่องทางของลูกค้า</div>

        {savedMsg && <div className="fv-saved">✅ {savedMsg}</div>}

        {!selected ? (
          <div className="form-group" style={{ position: 'relative', marginBottom: 0 }}>
            <label>ค้นหาลูกค้า (ชื่อ / เบอร์โทร)</label>
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="พิมพ์ชื่อหรือเบอร์โทรลูกค้า..."
            />
            {results.length > 0 && (
              <div className="fv-results">
                {results.map((cust) => (
                  <button
                    key={cust.id}
                    type="button"
                    className="fv-result-row"
                    onClick={() => handleSelectCustomer(cust)}
                  >
                    <div>
                      <div className="fv-result-name">{cust.customer_name}</div>
                      <div className="fv-result-meta">{cust.customer_code} · {cust.phone || 'ไม่มีเบอร์'}</div>
                    </div>
                    {cust.found_via && (
                      <span className="fv-chip">{foundViaIcon(cust.found_via)} {foundViaLabel(cust.found_via)}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* ── การ์ดข้อมูลลูกค้าที่เลือก — ยืนยันว่าถูกคนก่อนบันทึก ── */}
            <div className="fv-customer">
              <div className="fv-customer-head">
                <div>
                  <div className="fv-customer-name">{selected.customer_name}</div>
                  <div className="fv-customer-code">{selected.customer_code}</div>
                </div>
                <button type="button" className="fv-change-btn" onClick={clearSelection}>
                  เปลี่ยนลูกค้า
                </button>
              </div>

              <dl className="fv-facts">
                <div>
                  <dt>เบอร์โทร</dt>
                  <dd>{selected.phone || '—'}</dd>
                </div>
                <div>
                  <dt>รถ</dt>
                  <dd>
                    {vehicles.length === 0
                      ? 'ยังไม่มีข้อมูลรถ'
                      : vehicles.map((v) => `${v.brand} ${v.model}`).join(', ')}
                  </dd>
                </div>
                <div>
                  <dt>ทะเบียน</dt>
                  <dd className="fv-plate">
                    {vehicles.length === 0
                      ? '—'
                      : vehicles.map((v) => v.license_plate || '—').join(', ')}
                  </dd>
                </div>
              </dl>

              {selected.found_via && (
                <p className="fv-existing">
                  เคยบันทึกไว้แล้วว่า: <strong>{foundViaLabel(selected.found_via)}</strong> — เลือกใหม่เพื่อแก้ไข
                </p>
              )}
            </div>

            {/* ── ปุ่มเลือกช่องทาง ── */}
            <label className="fv-label">ลูกค้าเจอร้านจากช่องทางไหน</label>
            <div className="fv-choices">
              {FOUND_VIA_CHANNELS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`fv-choice ${channel === c.value ? 'active' : ''}`}
                  onClick={() => setChannel(c.value)}
                >
                  <span className="fv-choice-icon">{c.icon}</span>
                  <span>{c.label}</span>
                </button>
              ))}
            </div>

            {needsNote && (
              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label>ระบุรายละเอียด</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="เจอร้านจากช่องทางไหน..."
                  autoFocus
                />
              </div>
            )}

            {formError && <div className="error-message">{formError}</div>}

            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '0.9rem' }}
              onClick={handleSubmit}
              disabled={saving || !canSubmit}
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึกช่องทาง'}
            </button>
          </>
        )}
      </div>

      {listError && <div className="error-message">{listError}</div>}

      {loadingRecords ? (
        <div className="loading">กำลังโหลด...</div>
      ) : records.length === 0 ? (
        <div className="empty-message">ยังไม่มีข้อมูลช่องทางที่ลูกค้าเจอร้าน</div>
      ) : (
        <>
          <div className="dash-panel">
            <div className="dash-panel-title">สรุปช่องทาง ({records.length} คน)</div>
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead>
                  <tr>
                    <th>ช่องทาง</th>
                    <th>จำนวน</th>
                    <th>สัดส่วน</th>
                  </tr>
                </thead>
                <tbody>
                  {channelCounts.map((c) => (
                    <tr key={c.value}>
                      <td data-label="ช่องทาง">{c.icon} {c.label}</td>
                      <td data-label="จำนวน">{c.count}</td>
                      <td data-label="สัดส่วน">
                        {records.length > 0 ? `${Math.round((c.count / records.length) * 100)}%` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="dash-panel">
            <div className="dash-panel-title">รายชื่อลูกค้า</div>
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead>
                  <tr>
                    <th>ชื่อลูกค้า</th>
                    <th>เบอร์โทร</th>
                    <th>รถ / ทะเบียน</th>
                    <th>ช่องทาง</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="col-customer-name" data-label="ชื่อลูกค้า">{r.customer_name}</td>
                      <td data-label="เบอร์โทร">{r.phone || '—'}</td>
                      <td className="car-info" data-label="รถ / ทะเบียน">{r.vehicles_summary || '—'}</td>
                      <td data-label="ช่องทาง">
                        {foundViaIcon(r.found_via)} {foundViaLabel(r.found_via)}
                        {r.found_via === 'other' && r.found_via_note ? ` — ${r.found_via_note}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
