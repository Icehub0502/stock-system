import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * แถบเมนูของ queue.champ-powerspk.com — ตั้งใจให้ "ดูเหมือนเป็นระบบแยกต่างหาก"
 * จากแอปสต๊อกหลักตามที่เจ้าของร้านต้องการ (ไม่มีเมนูสต๊อก/ใบเสนอราคา/รายงานให้
 * เห็นเลย) แม้ backend/login/session จะเป็นตัวเดียวกันทั้งหมดก็ตาม — ดู
 * utils/isQueueHost.js สำหรับตรรกะแยก host, และ App.jsx ที่สลับมาใช้ตัวนี้แทน
 * NavBar ปกติเมื่อเข้าทาง subdomain นี้
 */
export default function QueueNavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="navbar queue-navbar">
      <div className="navbar-brand">
        <div className="navbar-title navbar-brand-text">
          <span className="brand-champ">Champ</span><span className="brand-power">power</span>
          <span className="queue-navbar-tag">คิวรับรถ</span>
        </div>
      </div>

      <div className="navbar-links open">
        {user && (
          <>
            <Link to="/checkin" className={`navbar-standalone-link ${location.pathname === '/checkin' ? 'active' : ''}`}>
              รับรถเข้าคิว
            </Link>
            <Link to="/jobs" className={`navbar-standalone-link ${location.pathname === '/jobs' ? 'active' : ''}`}>
              รายการงานวันนี้
            </Link>
            <a href="/board" target="_blank" rel="noreferrer" className="navbar-standalone-link">
              จอบอร์ด ↗
            </a>
            <div className="navbar-user-row">
              <span className="navbar-user">{user.full_name}</span>
              <button className="btn-logout" onClick={handleLogout}>ออกจากระบบ</button>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
