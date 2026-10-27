import React, { useCallback, useEffect, useState } from 'react';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABEL } from '../../utils/roles';
import { formatDateTime } from './DevOverview';

const EMPTY_FORM = {
  code: '', name: '', group_id: '', new_group_name: '',
  owner_username: '', owner_full_name: '', owner_password: '',
};

export default function DevShops() {
  const { user, switchShop } = useAuth();
  const [shops, setShops] = useState([]);
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const load = useCallback(() => {
    Promise.all([client.get('/dev/shops'), client.get('/dev/groups')])
      .then(([s, g]) => {
        setShops(s.data.data);
        setGroups(g.data.data);
      })
      .catch((err) => setError(err.response?.data?.error || 'โหลดไม่สำเร็จ'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    setModalError('');
    try {
      await client.post('/dev/shops', {
        code: form.code,
        name: form.name,
        group_id: form.group_id ? Number(form.group_id) : undefined,
        new_group_name: form.group_id ? undefined : form.new_group_name,
        owner: { username: form.owner_username, full_name: form.owner_full_name, password: form.owner_password },
      });
      setShowModal(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setModalError(err.response?.data?.error || 'สร้างร้านไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (shop) => {
    const next = shop.status === 'active' ? 'suspended' : 'active';
    const text = next === 'suspended'
      ? `ระงับร้าน "${shop.name}"? พนักงานของร้านจะใช้งานไม่ได้ทันที (ข้อมูลไม่หาย)`
      : `เปิดใช้งานร้าน "${shop.name}" อีกครั้ง?`;
    if (!window.confirm(text)) return;
    try {
      await client.patch(`/dev/shops/${shop.id}`, { status: next });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'ทำรายการไม่สำเร็จ');
    }
  };

  const rename = async (shop) => {
    const name = window.prompt('ชื่อร้านใหม่', shop.name);
    if (!name || name.trim() === shop.name) return;
    try {
      await client.patch(`/dev/shops/${shop.id}`, { name });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'แก้ชื่อไม่สำเร็จ');
    }
  };

  const changeCode = async (shop) => {
    const input = window.prompt(`รหัสร้านใหม่ของ "${shop.name}" (a-z 0-9 และ - ยาว 2-30 ตัว)\nพนักงานของร้านต้องใช้รหัสใหม่ตอนล็อกอิน`, shop.code);
    if (!input) return;
    const code = input.trim().toLowerCase();
    if (code === shop.code) return;
    if (!window.confirm(`เปลี่ยนรหัสร้านจาก "${shop.code}" เป็น "${code}"? ลิงก์หรือบุ๊กมาร์กที่ใช้รหัสเดิมจะใช้ไม่ได้`)) return;
    try {
      await client.patch(`/dev/shops/${shop.id}`, { code });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'เปลี่ยนรหัสร้านไม่สำเร็จ');
    }
  };

  const enter = async (shop) => {
    try {
      await switchShop(shop.id);
    } catch (err) {
      alert(err.response?.data?.error || 'เข้าร้านไม่สำเร็จ');
    }
  };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ร้าน / สาขา</h1>
          <p className="subtitle">สร้างร้านใหม่ ระงับ/เปิดร้าน และเข้าไปดูแลแทนเจ้าของร้าน (มีบันทึกทุกครั้ง)</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setShowModal(true); setModalError(''); }}>+ สร้างร้านใหม่</button>
      </div>
      {error && <div className="error-message">{error}</div>}

      <div className="quotation-table-wrap">
        <table className="quotation-table">
          <thead>
            <tr><th>ร้าน</th><th>รหัสร้าน</th><th>กลุ่ม</th><th>สถานะ</th><th>ผู้ใช้</th><th>สร้างเมื่อ</th><th>จัดการ</th></tr>
          </thead>
          <tbody>
            {shops.map((s) => (
              <tr key={s.id}>
                <td data-label="ร้าน">{s.name}</td>
                <td data-label="รหัสร้าน"><code>{s.code}</code></td>
                <td data-label="กลุ่ม">{s.group_name}</td>
                <td data-label="สถานะ">{s.status === 'active' ? 'ใช้งาน' : 'ระงับ'}</td>
                <td data-label="ผู้ใช้">{s.user_count}</td>
                <td data-label="สร้างเมื่อ">{formatDateTime(s.created_at)}</td>
                <td className="actions" data-label="จัดการ">
                  {s.id !== user.shop_id && <button type="button" onClick={() => enter(s)}>เข้าดูร้านนี้</button>}
                  <button type="button" onClick={() => rename(s)}>แก้ชื่อ</button>
                  <button type="button" onClick={() => changeCode(s)}>แก้รหัสร้าน</button>
                  <button
                    type="button"
                    className={s.status === 'active' ? 'btn-danger' : ''}
                    disabled={s.id === Number(user.home_shop_id || user.shop_id) && s.status === 'active'}
                    title={s.id === Number(user.home_shop_id || user.shop_id) ? 'ระงับร้านที่บัญชีของคุณสังกัดอยู่ไม่ได้' : undefined}
                    onClick={() => toggleStatus(s)}
                  >
                    {s.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={() => !saving && setShowModal(false)}>
          <div className="modal-card medium" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>สร้างร้านใหม่</h2>
              <button type="button" className="btn-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            {modalError && <div className="error-message">{modalError}</div>}
            <form onSubmit={create} className="modal-form">
              <div className="form-group">
                <label>รหัสร้าน (ใช้ตอนล็อกอิน: a-z 0-9 และ -)</label>
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })} required pattern="[a-z0-9][a-z0-9\-]{1,29}" autoCapitalize="none" />
              </div>
              <div className="form-group">
                <label>ชื่อร้าน</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>กลุ่มสาขา (เจ้าของเดียวกันเห็นสาขาในกลุ่มเดียวกัน)</label>
                <select value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}>
                  <option value="">+ สร้างกลุ่มใหม่ (เจ้าของใหม่)</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.shop_count} สาขา)</option>)}
                </select>
              </div>
              {!form.group_id && (
                <div className="form-group">
                  <label>ชื่อกลุ่มใหม่</label>
                  <input value={form.new_group_name} onChange={(e) => setForm({ ...form, new_group_name: e.target.value })} required />
                </div>
              )}
              <h3>บัญชีเจ้าของร้าน</h3>
              <div className="form-group">
                <label>Username</label>
                <input value={form.owner_username} onChange={(e) => setForm({ ...form, owner_username: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>ชื่อ-นามสกุล</label>
                <input value={form.owner_full_name} onChange={(e) => setForm({ ...form, owner_full_name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัวอักษร — แจ้งเจ้าของให้เปลี่ยนเอง)</label>
                <input type="text" value={form.owner_password} onChange={(e) => setForm({ ...form, owner_password: e.target.value })} required minLength={8} autoComplete="off" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>ยกเลิก</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'กำลังสร้าง...' : 'สร้างร้าน'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function DevUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [shops, setShops] = useState([]);
  const [shopId, setShopId] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    client.get('/dev/users', { params: { shop_id: shopId || undefined, q: q || undefined } })
      .then((res) => setUsers(res.data.data))
      .catch((err) => setError(err.response?.data?.error || 'โหลดไม่สำเร็จ'));
  }, [shopId, q]);

  useEffect(() => { client.get('/dev/shops').then((res) => setShops(res.data.data)).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const resetPassword = async (u) => {
    const password = window.prompt(`ตั้งรหัสผ่านใหม่ให้ "${u.username}" (ร้าน ${u.shop_name}) อย่างน้อย 8 ตัวอักษร`);
    if (!password) return;
    try {
      await client.post(`/dev/users/${u.id}/reset-password`, { new_password: password });
      alert('รีเซ็ตรหัสผ่านแล้ว');
    } catch (err) {
      alert(err.response?.data?.error || 'รีเซ็ตไม่สำเร็จ');
    }
  };

  const changeRole = async (u, role) => {
    if (role === u.role) return;
    if (!window.confirm(`เปลี่ยนสิทธิ์ของ "${u.username}" จาก ${ROLE_LABEL[u.role] || u.role} เป็น ${ROLE_LABEL[role]}?\n(มีผลเมื่อเขาล็อกอินใหม่ ไม่เกิน 12 ชม.)`)) return;
    try {
      await client.patch(`/dev/users/${u.id}`, { role });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'เปลี่ยนสิทธิ์ไม่สำเร็จ');
    }
  };

  const toggleActive = async (u) => {
    const next = !u.is_active;
    if (!window.confirm(next ? `เปิดบัญชี "${u.username}" อีกครั้ง?` : `ปิดบัญชี "${u.username}"? ล็อกอินใหม่ไม่ได้ (คนที่ล็อกอินค้างอยู่ใช้ได้จนหมดอายุ ไม่เกิน 12 ชม.)`)) return;
    try {
      await client.patch(`/dev/users/${u.id}`, { is_active: next });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'ทำรายการไม่สำเร็จ');
    }
  };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ผู้ใช้ทุกร้าน</h1>
          <p className="subtitle">ค้นหาผู้ใช้ข้ามร้าน รีเซ็ตรหัสผ่าน หรือปิดบัญชี</p>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      <div className="owner-range">
        <select value={shopId} onChange={(e) => setShopId(e.target.value)}>
          <option value="">ทุกร้าน</option>
          {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input placeholder="ค้นหา username / ชื่อ" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="quotation-table-wrap">
        <table className="quotation-table">
          <thead><tr><th>ร้าน</th><th>Username</th><th>ชื่อ</th><th>สิทธิ์</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td data-label="ร้าน">{u.shop_name}</td>
                <td data-label="Username">{u.username}</td>
                <td data-label="ชื่อ">{u.full_name || '-'}</td>
                <td data-label="สิทธิ์">
                  <select value={u.role} disabled={u.id === me.id} onChange={(e) => changeRole(u, e.target.value)}>
                    {Object.keys(ROLE_LABEL).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
                <td data-label="สถานะ">{u.is_active ? 'ใช้งาน' : 'ปิดอยู่'}</td>
                <td className="actions" data-label="จัดการ">
                  <button type="button" onClick={() => resetPassword(u)}>รีเซ็ตรหัสผ่าน</button>
                  <button type="button" className={u.is_active ? 'btn-danger' : ''} disabled={u.id === me.id} onClick={() => toggleActive(u)}>
                    {u.is_active ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={6}>ไม่พบผู้ใช้</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
