import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isQueueHost } from '../utils/isQueueHost';
import logo from '../image/champpower-logo.jpg';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const user = await login(username, password);
      // subdomain คิวรับรถ ไม่มีแดชบอร์ด/หน้าสแกนของระบบหลักให้ไปต่อ (เหมือน
      // Home() ใน App.jsx) พาไปหน้ารายการงานแทนเสมอไม่ว่า role ไหน
      if (isQueueHost()) {
        navigate('/jobs');
        return;
      }
      navigate(user.role === 'office' ? '/dashboard' : '/scan');
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
        <label>ชื่อผู้ใช้งาน</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <label>รหัสผ่าน</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error-text">{error}</p>}
        <button type="submit">เข้าสู่ระบบ</button>
      </form>
    </div>
  );
}