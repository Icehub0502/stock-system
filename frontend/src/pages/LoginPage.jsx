import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isQueueHost } from '../utils/isQueueHost';
import { hasRole } from '../utils/roles';
import logo from '../image/champpower-logo.jpg';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // shop code: remembered from the last login, or given in the link (?shop=code)
  const [shopCode, setShopCode] = useState(() => {
    const fromLink = new URLSearchParams(window.location.search).get('shop');
    if (fromLink) return fromLink;
    try { return localStorage.getItem('shopCode') || ''; } catch (err) { return ''; }
  });
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const user = await login(username, password, shopCode);
      try { localStorage.setItem('shopCode', shopCode.trim()); } catch (err) { /* private mode: fine */ }
      // subdomain คิวรับรถ ไม่มีแดชบอร์ด/หน้าสแกนของระบบหลักให้ไปต่อ (เหมือน
      // Home() ใน App.jsx) พาไปหน้ารายการงานแทนเสมอไม่ว่า role ไหน
      if (isQueueHost()) {
        navigate('/jobs');
        return;
      }
      navigate(hasRole(user, 'office') ? '/dashboard' : '/scan');
    } catch (err) {
      setError(err.response?.data?.error || 'เข้าสู่ระบบไม่สำเร็จ');
    }
  };

  return (
    <div className="login-card">
      <div className="login-logo">
        <img src={logo} alt="Champ Power" />
      </div>
      <h2>เข้าสู่ระบบ</h2>
      <form onSubmit={handleSubmit}>
        <label>รหัสร้าน (ถ้าเป็นร้านหลักเว้นว่างได้)</label>
        <input value={shopCode} onChange={(e) => setShopCode(e.target.value)} autoCapitalize="none" autoComplete="organization" />
        <label>ชื่อผู้ใช้งาน</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!shopCode} />
        <label>รหัสผ่าน</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error-text">{error}</p>}
        <button type="submit">เข้าสู่ระบบ</button>
      </form>
    </div>
  );
}