import React, { useState, useEffect, useRef, useMemo } from "react";
import client from "../api/client";
import { FOUND_VIA_CHANNELS, foundViaLabel } from "../utils/foundViaChannels";

// บันทึกว่าลูกค้าที่มีอยู่แล้วในระบบเจอร้านจากช่องทางไหน (Google Map/Facebook/
// เพื่อนแนะนำ/อื่นๆ) เก็บไว้ประกอบการตัดสินใจยิงโฆษณา — ต้องเป็นลูกค้าที่มีอยู่แล้ว
// เท่านั้น (ค้นหาแบบเดียวกับตอนสร้างใบเสนอราคา ดู QuotationFormModal.jsx) ไม่สร้าง
// ลูกค้าใหม่จากหน้านี้ กราฟสรุปเป็น CSS bar chart มือทำเอง (mirror ของ
// DeclinedSummaryPage.jsx) ไม่เพิ่ม chart library ใหม่
export default function CustomerChannelPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [channel, setChannel] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

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
    if (value) searchCustomers(value);
  };

  const handleSelectCustomer = async (customer) => {
    setSelected(customer);
    setQuery(customer.customer_name);
    setResults([]);
    setChannel(customer.found_via || "");
    setNote(customer.found_via_note || "");
    setFormError("");

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
      setQuery("");
      setSelected(null);
      setVehicles([]);
      setChannel("");
      setNote("");
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
    return FOUND_VIA_CHANNELS.map((c) => ({ ...c, count: counts[c.value] }));
  }, [records]);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <h1>ช่องทางที่ลูกค้าเจอเรา</h1>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">บันทึกช่องทางของลูกค้า</div>
        <div className="form-group" style={{ position: 'relative' }}>
          <label>ค้นหาลูกค้า (ชื่อ/เบอร์โทร)</label>
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="พิมพ์ชื่อหรือเบอร์โทรลูกค้า..."
          />
          {results.length > 0 && (
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead>
                  <tr>
                    <th>รหัสลูกค้า</th>
                    <th>ชื่อลูกค้า</th>
                    <th>เบอร์โทร</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((cust) => (
                    <tr key={cust.id} className="clickable-row" onClick={() => handleSelectCustomer(cust)}>
                      <td data-label="รหัสลูกค้า">{cust.customer_code}</td>
                      <td className="col-customer-name" data-label="ชื่อลูกค้า">{cust.customer_name}</td>
                      <td data-label="เบอร์โทร">{cust.phone || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selected && (
          <>
            <p>
              <strong>{selected.customer_name}</strong> ({selected.customer_code}){' '}
              {vehicles.length > 0
                ? vehicles.map((v) => `${v.brand} ${v.model} (${v.license_plate})`).join(', ')
                : 'ยังไม่มีข้อมูลรถ'}
            </p>
            <div className="form-group">
              <label>เจอร้านจากช่องทางไหน</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">-- เลือกช่องทาง --</option>
                {FOUND_VIA_CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            {needsNote && (
              <div className="form-group">
                <label>ระบุรายละเอียด</label>
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ระบุช่องทาง..." />
              </div>
            )}
            {formError && <div className="error-message">{formError}</div>}
            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={saving || !canSubmit}>
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
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
            <div className="dash-panel-title">ตารางสรุปช่องทาง ({records.length} คน)</div>
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
                      <td data-label="ช่องทาง">{c.label}</td>
                      <td data-label="จำนวน">{c.count}</td>
                      <td data-label="สัดส่วน">{records.length > 0 ? `${Math.round((c.count / records.length) * 100)}%` : '-'}</td>
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
                    <th>รถ/ทะเบียน</th>
                    <th>ช่องทาง</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="col-customer-name" data-label="ชื่อลูกค้า">{r.customer_name}</td>
                      <td className="car-info" data-label="รถ/ทะเบียน">{r.vehicles_summary || '-'}</td>
                      <td data-label="ช่องทาง">
                        {foundViaLabel(r.found_via)}
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
