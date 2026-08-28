import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

// หน้า "ตั้งค่า" เฉพาะเจ้าของร้าน (username 'ice' — บังคับจริงฝั่ง backend ผ่าน
// requireOwner, หน้านี้แค่เป็นทางเข้า ป้องกันซ้ำอีกชั้นที่ ProtectedRoute ownerOnly)
// รวม 4 ส่วนที่กระจัดกระจาย/ไม่เคยมีมาก่อน: บัญชีผู้ใช้, ช่าง, บอทไลน์, ลิงก์ด่วนไปหน้า
// ตั้งค่าอื่นที่มีอยู่แล้ว
export default function SettingsPage() {
  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ตั้งค่าระบบ</h1>
          <p className="subtitle">จัดการบัญชีผู้ใช้ ช่าง และบอทไลน์ — เห็นเฉพาะบัญชีเจ้าของร้าน</p>
        </div>
      </div>
      <UsersSection />
      <TechniciansSection />
      <LineBotSection />
      <QuickLinksSection />
    </div>
  );
}

const ROLE_LABEL = { office: 'ออฟฟิศ', technician: 'ช่าง' };

function UsersSection() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', full_name: '', role: 'office' });

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await client.get('/users');
      setUsers(res.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ username: '', password: '', full_name: '', role: 'office' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({ username: u.username, password: '', full_name: u.full_name || '', role: u.role });
    setError('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setError('');
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        // แก้ไข: username เปลี่ยนไม่ได้ (ไม่มี endpoint รองรับ) ส่งแค่ full_name/role/password
        await client.put(`/users/${editing.id}`, {
          full_name: form.full_name,
          role: form.role,
          ...(form.password ? { password: form.password } : {}),
        });
      } else {
        if (!form.username.trim() || !form.password) {
          setError('กรุณากรอก username และ password');
          return;
        }
        await client.post('/users', form);
      }
      closeModal();
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`ลบบัญชี "${u.username}" หรือไม่?`)) return;
    try {
      await client.delete(`/users/${u.id}`);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'ลบไม่สำเร็จ');
    }
  };

  return (
    <div className="dash-panel">
      <div className="dash-panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        บัญชีผู้ใช้
        <button type="button" className="btn btn-primary" onClick={openAdd}>+ เพิ่มบัญชี</button>
      </div>
      {error && !showModal && <div className="error-message">{error}</div>}
      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>ชื่อ</th>
                <th>สิทธิ์</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td data-label="Username">{u.username}</td>
                  <td data-label="ชื่อ">{u.full_name || '-'}</td>
                  <td data-label="สิทธิ์">{ROLE_LABEL[u.role] || u.role}</td>
                  <td className="actions" data-label="จัดการ">
                    <button type="button" onClick={() => openEdit(u)}>แก้ไข</button>
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={me?.id === u.id}
                      title={me?.id === u.id ? 'ลบบัญชีตัวเองไม่ได้' : undefined}
                      onClick={() => remove(u)}
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-card medium" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editing ? `แก้ไขบัญชี "${editing.username}"` : 'เพิ่มบัญชีใหม่'}</h2>
              <button type="button" className="btn-close" onClick={closeModal}>✕</button>
            </div>
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={save} className="modal-form">
              {!editing && (
                <div className="form-group">
                  <label>Username</label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    required
                  />
                </div>
              )}
              <div className="form-group">
                <label>ชื่อ-นามสกุล</label>
                <input
                  type="text"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>สิทธิ์</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="office">ออฟฟิศ</option>
                  <option value="technician">ช่าง</option>
                </select>
              </div>
              <div className="form-group">
                <label>{editing ? 'ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)'}</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">บันทึก</button>
                <button type="button" className="btn btn-secondary" onClick={closeModal}>ยกเลิก</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TechniciansSection() {
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const fetchTechnicians = async () => {
    try {
      setLoading(true);
      const res = await client.get('/technicians');
      setTechnicians(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดรายชื่อช่างไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTechnicians(); }, []);

  const add = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setError('');
    try {
      await client.post('/technicians', { name: newName.trim() });
      setNewName('');
      fetchTechnicians();
    } catch (err) {
      setError(err.response?.data?.error || 'เพิ่มชื่อช่างไม่สำเร็จ');
    }
  };

  const startEdit = (t) => {
    setEditingId(t.id);
    setEditingName(t.name);
  };

  const saveEdit = async (id) => {
    if (!editingName.trim()) return;
    setError('');
    try {
      await client.put(`/technicians/${id}`, { name: editingName.trim() });
      setEditingId(null);
      fetchTechnicians();
    } catch (err) {
      setError(err.response?.data?.error || 'แก้ไขชื่อช่างไม่สำเร็จ');
    }
  };

  const remove = async (t) => {
    if (!window.confirm(`ลบช่าง "${t.name}" หรือไม่?`)) return;
    try {
      await client.delete(`/technicians/${t.id}`);
      fetchTechnicians();
    } catch (err) {
      alert(err.response?.data?.error || 'ลบไม่สำเร็จ');
    }
  };

  return (
    <div className="dash-panel">
      <div className="dash-panel-title">ช่าง</div>
      {error && <div className="error-message">{error}</div>}
      <form onSubmit={add} className="modal-actions" style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="ชื่อช่างใหม่"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">+ เพิ่มช่าง</button>
      </form>
      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : technicians.length === 0 ? (
        <div className="dash-empty">ยังไม่มีรายชื่อช่าง</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr><th>ชื่อช่าง</th><th>จัดการ</th></tr>
            </thead>
            <tbody>
              {technicians.map((t) => (
                <tr key={t.id}>
                  <td data-label="ชื่อช่าง">
                    {editingId === t.id ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        autoFocus
                      />
                    ) : (
                      t.name
                    )}
                  </td>
                  <td className="actions" data-label="จัดการ">
                    {editingId === t.id ? (
                      <>
                        <button type="button" onClick={() => saveEdit(t.id)}>บันทึก</button>
                        <button type="button" className="btn-secondary" onClick={() => setEditingId(null)}>ยกเลิก</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => startEdit(t)}>แก้ไข</button>
                        <button type="button" className="btn-danger" onClick={() => remove(t)}>ลบ</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const PLACEHOLDER_LEGEND_BLANK = '{{queue_no}}, {{date}}';
const PLACEHOLDER_LEGEND_FILLED = '{{queue_no}}, {{customer_name}}, {{phone}}, {{brand}}, {{model}}, {{license_plate}}, {{color}}, {{mileage}}, {{symptom}}, {{items}}, {{total_amount}}, {{deposit_amount}}, {{deposit_date}}, {{scheduled_date}}, {{remark}}';

function LineBotSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [groupIds, setGroupIds] = useState({ line_group_id: '', line_group_id_bot2: '', line_group_id_bot3: '' });
  const [templateBlank, setTemplateBlank] = useState('');
  const [templateFilled, setTemplateFilled] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await client.get('/settings/line');
      setData(res.data.data);
      setGroupIds(res.data.data.group_ids);
      setTemplateBlank(res.data.data.templates.blank);
      setTemplateFilled(res.data.data.templates.filled);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดการตั้งค่าบอทไลน์ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await client.put('/settings/line', {
        group_ids: groupIds,
        templates: { blank: templateBlank, filled: templateFilled },
      });
      setSuccess('บันทึกแล้ว');
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="dash-panel">
        <div className="dash-panel-title">บอทไลน์</div>
        <div className="loading">กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div className="dash-panel">
      <div className="dash-panel-title">บอทไลน์</div>
      {error && <div className="error-message">{error}</div>}
      {success && <p style={{ color: '#15803d', fontSize: 13 }}>{success}</p>}

      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
        Token ของแต่ละบอท (channel secret/access token) เก็บอยู่ในไฟล์ .env บนเซิร์ฟเวอร์ —
        แก้ไขผ่านหน้านี้ไม่ได้ ต้องแก้ที่ไฟล์แล้ว restart เซิร์ฟเวอร์เอง
      </p>
      <div className="modal-actions" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <span className={`status-badge ${data?.bots.bot1 ? 'status-badge-success' : 'status-badge-danger'}`}>
          บอท 1 (รับรถ): {data?.bots.bot1 ? 'ตั้งค่าแล้ว ✅' : 'ยังไม่ได้ตั้งค่า ❌'}
        </span>
        <span className={`status-badge ${data?.bots.bot2 ? 'status-badge-success' : 'status-badge-danger'}`}>
          บอท 2 (รับรายการ): {data?.bots.bot2 ? 'ตั้งค่าแล้ว ✅' : 'ยังไม่ได้ตั้งค่า ❌'}
        </span>
        <span className={`status-badge ${data?.bots.bot3 ? 'status-badge-success' : 'status-badge-danger'}`}>
          บอท 3 (ปิดบิล): {data?.bots.bot3 ? 'ตั้งค่าแล้ว ✅' : 'ยังไม่ได้ตั้งค่า ❌'}
        </span>
      </div>

      <div className="form-group">
        <label>Group ID บอท 1 (รับรถ) — จับอัตโนมัติจากข้อความแรกในกลุ่ม</label>
        <input type="text" value={groupIds.line_group_id} onChange={(e) => setGroupIds({ ...groupIds, line_group_id: e.target.value })} />
      </div>
      <div className="form-group">
        <label>Group ID บอท 2 (รับรายการ)</label>
        <input type="text" value={groupIds.line_group_id_bot2} onChange={(e) => setGroupIds({ ...groupIds, line_group_id_bot2: e.target.value })} />
      </div>
      <div className="form-group">
        <label>Group ID บอท 3 (ปิดบิล)</label>
        <input type="text" value={groupIds.line_group_id_bot3} onChange={(e) => setGroupIds({ ...groupIds, line_group_id_bot3: e.target.value })} />
      </div>

      <div className="form-group">
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>เทมเพลตว่าง (ตอนพนักงานพิมพ์ "คิว")</span>
          <button type="button" onClick={() => setTemplateBlank(data.defaults.blank)}>คืนค่าเริ่มต้น</button>
        </label>
        <textarea rows={12} value={templateBlank} onChange={(e) => setTemplateBlank(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 13 }} />
        <p style={{ fontSize: 12, color: '#6b7280' }}>ใส่ได้: {PLACEHOLDER_LEGEND_BLANK}</p>
      </div>

      <div className="form-group">
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>เทมเพลตกรอกข้อมูลแล้ว (ส่งกลับไลน์หลังแก้ไขจากเว็บ)</span>
          <button type="button" onClick={() => setTemplateFilled(data.defaults.filled)}>คืนค่าเริ่มต้น</button>
        </label>
        <textarea rows={14} value={templateFilled} onChange={(e) => setTemplateFilled(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 13 }} />
        <p style={{ fontSize: 12, color: '#6b7280' }}>ใส่ได้: {PLACEHOLDER_LEGEND_FILLED}</p>
      </div>

      <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
        {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
      </button>
    </div>
  );
}

function QuickLinksSection() {
  return (
    <div className="dash-panel">
      <div className="dash-panel-title">ลิงก์ด่วน</div>
      <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
        <Link to="/service-items" className="btn btn-secondary">รายการสินค้า/บริการ</Link>
        <Link to="/quote-parts" className="btn btn-secondary">ราคาอะไหล่ตามรุ่นรถ</Link>
        <Link to="/warranties" className="btn btn-secondary">การรับประกัน</Link>
      </div>
    </div>
  );
}
