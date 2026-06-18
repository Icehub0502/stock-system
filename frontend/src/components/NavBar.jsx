import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!user) return null;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <div className="navbar-title">ระบบจัดการสต๊อกแร็ค OEM</div>
        {/* Hamburger — แสดงเฉพาะมือถือ */}
        <button
          className="navbar-hamburger"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="เมนู"
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>

      <div className={`navbar-links ${menuOpen ? 'open' : ''}`}>
        {user.role === 'office' && (
          <Link to="/office" onClick={() => setMenuOpen(false)}>รายการแร็ค</Link>
        )}
        {user.role === 'office' && (
          <Link to="/history" onClick={() => setMenuOpen(false)}>ประวัติรายการ</Link>
        )}
        <Link to="/scan" onClick={() => setMenuOpen(false)}>สแกน QR</Link>

        <div className="navbar-user-row">
          <span className="navbar-user">
            {user.full_name}
            <span className="navbar-role">
              ({user.role === 'office' ? 'ออฟฟิส' : 'ช่าง'})
            </span>
          </span>
          <button className="btn-logout" onClick={handleLogout}>ออกจากระบบ</button>
        </div>
      </div>
    </nav>
  );
}