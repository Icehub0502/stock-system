import React, { useState, useEffect, useMemo, useRef } from "react";
import client from "../api/client";
import { FOUND_VIA_CHANNELS, foundViaLabel, foundViaIcon } from "../utils/foundViaChannels";

// บันทึกว่าลูกค้าเจอร้านจากช่องทางไหน — แสดงลูกค้าทุกคนเป็นตารางเดียว (เหมือนหน้า
// ใบเสนอราคา) แถวไหนยังไม่เคยเลือกช่องทางจะเห็นปุ่มเลือกทันที กดปุ่มแล้วบันทึกเลย
// ไม่ต้องกดยืนยันซ้ำ — พอบันทึกแล้วปุ่มจะหายไปเปลี่ยนเป็นข้อความสรุป กดข้อความซ้ำ
// เพื่อแก้ไขใหม่ได้ (เผื่อกดผิด) ยกเว้นช่องทาง "อื่นๆ" ที่ต้องพิมพ์รายละเอียดก่อน
// ถึงจะกดยืนยันบันทึกได้จริง
export default function CustomerChannelPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [search, setSearch] = useState("");

  const [editingId, setEditingId] = useState(null); // แถวที่กำลังเปิดปุ่มเลือกอยู่
  const [otherNote, setOtherNote] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [rowError, setRowError] = useState("");

  const searchAbortRef = useRef(null);

  const fetchRecords = async (term) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    try {
      setLoading(true);
      const response = await client.get('/customers', {
        params: { channel_table: 1, search: term || undefined },
        signal: controller.signal,
      });
      setRecords(response.data.data || []);
      setListError("");
    } catch (err) {
      if (err.code === 'ERR_CANCELED') return;
      setListError(err.response?.data?.error || "โหลดข้อมูลลูกค้าไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRecords(""); }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchRecords(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const startEdit = (record) => {
    setEditingId(record.id);
    setOtherNote(record.found_via === 'other' ? (record.found_via_note || '') : '');
    setRowError("");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setOtherNote("");
    setRowError("");
  };

  const saveChannel = async (customerId, channel, note = '') => {
    if (channel === 'other' && !note.trim()) {
      setRowError('กรุณาระบุรายละเอียดช่องทาง');
      return;
    }
    setSavingId(customerId);
    setRowError("");
    try {
      await client.patch(`/customers/${customerId}/found-via`, { channel, note });
      setRecords((prev) => prev.map((r) => (
        r.id === customerId ? { ...r, found_via: channel, found_via_note: channel === 'other' ? note.trim() : null } : r
      )));
      setEditingId(null);
      setOtherNote("");
    } catch (err) {
      setRowError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingId(null);
    }
  };

  const channelCounts = useMemo(() => {
    const withChannel = records.filter((r) => r.found_via);
    const counts = Object.fromEntries(FOUND_VIA_CHANNELS.map((c) => [c.value, 0]));
    for (const r of withChannel) {
      const key = counts.hasOwnProperty(r.found_via) ? r.found_via : 'other';
      counts[key] += 1;
    }
    return FOUND_VIA_CHANNELS
      .map((c) => ({ ...c, count: counts[c.value] }))
      .sort((a, b) => b.count - a.count);
  }, [records]);

  const totalWithChannel = channelCounts.reduce((s, c) => s + c.count, 0);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ช่องทางที่ลูกค้าเจอเรา</h1>
          <p className="subtitle">กดเลือกช่องทางที่ลูกค้าบอกได้จากตารางเลย ไม่ต้องค้นหาก่อน</p>
        </div>
        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหาชื่อ เบอร์โทร หรือทะเบียนรถ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {totalWithChannel > 0 && (
        <div className="dash-panel">
          <div className="dash-panel-title">สรุปช่องทาง ({totalWithChannel} คน)</div>
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
                {channelCounts.filter((c) => c.count > 0).map((c) => (
                  <tr key={c.value}>
                    <td data-label="ช่องทาง">{c.icon} {c.label}</td>
                    <td data-label="จำนวน">{c.count}</td>
                    <td data-label="สัดส่วน">{Math.round((c.count / totalWithChannel) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {listError && <div className="error-message">{listError}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : records.length === 0 ? (
        <div className="empty-message">
          {search ? `ไม่พบลูกค้าที่ตรงกับ "${search}"` : 'ยังไม่มีข้อมูลลูกค้า'}
        </div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>ชื่อลูกค้า</th>
                <th>เบอร์โทร</th>
                <th>รถ</th>
                <th>ทะเบียน</th>
                <th>ช่องทางที่เจอ</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const isEditing = editingId === r.id;
                const isSaving = savingId === r.id;
                return (
                  <tr key={r.id}>
                    <td className="col-customer-name" data-label="ชื่อลูกค้า">
                      <strong>{r.customer_name}</strong>
                      <div className="fv-result-meta">{r.customer_code}</div>
                    </td>
                    <td data-label="เบอร์โทร">{r.phone || '—'}</td>
                    <td className="car-info" data-label="รถ">{r.vehicles_summary || '—'}</td>
                    <td data-label="ทะเบียน">{r.plates_summary || '—'}</td>
                    <td data-label="ช่องทางที่เจอ" style={{ minWidth: 220 }}>
                      {isEditing ? (
                        <div className="fv-choices">
                          {FOUND_VIA_CHANNELS.map((c) => (
                            c.value === 'other' ? (
                              <div key="other" className="fv-other-inline">
                                <input
                                  type="text"
                                  placeholder="ระบุช่องทาง..."
                                  value={otherNote}
                                  onChange={(e) => setOtherNote(e.target.value)}
                                  disabled={isSaving}
                                />
                                <button
                                  type="button"
                                  className="fv-choice"
                                  disabled={isSaving}
                                  onClick={() => saveChannel(r.id, 'other', otherNote)}
                                >
                                  <span className="fv-choice-icon">{c.icon}</span>
                                  <span>บันทึก "อื่นๆ"</span>
                                </button>
                              </div>
                            ) : (
                              <button
                                key={c.value}
                                type="button"
                                className="fv-choice"
                                disabled={isSaving}
                                onClick={() => saveChannel(r.id, c.value)}
                              >
                                <span className="fv-choice-icon">{c.icon}</span>
                                <span>{c.label}</span>
                              </button>
                            )
                          ))}
                          <button type="button" className="fv-cancel-link" onClick={cancelEdit} disabled={isSaving}>
                            ยกเลิก
                          </button>
                          {rowError && <p className="error-text" style={{ margin: '4px 0 0', flexBasis: '100%' }}>{rowError}</p>}
                        </div>
                      ) : r.found_via ? (
                        <button type="button" className="fv-found-text" onClick={() => startEdit(r)}>
                          {foundViaIcon(r.found_via)} เจอจากทาง {foundViaLabel(r.found_via)}
                          {r.found_via === 'other' && r.found_via_note ? ` (${r.found_via_note})` : ''}
                          <span className="fv-edit-hint">แก้ไข</span>
                        </button>
                      ) : (
                        <button type="button" className="fv-pick-btn" onClick={() => startEdit(r)}>
                          + เลือกช่องทาง
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
