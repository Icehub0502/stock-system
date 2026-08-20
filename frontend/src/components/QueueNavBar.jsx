import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * แถบเมนูของ queue.champ-powerspk.com — ตั้งใจให้ "ดูเหมือนเป็นระบบแยกต่างหาก"
 * จากแอปสต๊อกหลักตามที่เจ้าของร้านต้องการ (ไม่มีเมนูสต๊อก/ใบเสนอราคา/รายงานให้
 * เห็นเลย) แม้ backend/login/session จะเป็นตัวเดียวกันทั้งหมดก็ตาม — ดู
 * utils/isQueueHost.js สำหรับตรรกะแยก host, และ App.jsx ที่สลับมาใช้ตัวนี้แทน
 * NavBar ปกติเมื่อเข้าทาง subdomain นี้
 *
 * ใช้คลาส CSS ของตัวเอง (queue-navbar-*) ทั้งหมด — ไม่แตะ .navbar-links/
 * .navbar-brand ของ NavBar ปกติเลย เพราะคลาสพวกนั้นถูกออกแบบมาคู่กับ
 * hamburger + slide-in drawer + BottomNav ของแอปหลัก (ดู @media (max-width:
 * 1024px) ใน app.css) ลองใช้ร่วมกันตอนแรกแล้วบั๊ก: .navbar-links กลายเป็น
 * แผงเลื่อนออกด้านข้าง position:fixed ที่ถูกบังคับ "เปิดค้าง" ตลอด (เพราะที่นี่
 * ไม่มี hamburger/BottomNav มาปิดให้) ทับเนื้อหาเกือบทั้งจอเป็นสีดำ — เมนูนี้
 * มีลิงก์แค่ 2-3 อันจึงไม่จำเป็นต้องมี drawer เลย ทำเป็นแถบเรียงแนวนอนธรรมดา
 * ที่ wrap ได้เองบนจอแคบ ง่ายและชัวร์กว่า
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
    <nav className="queue-navbar">
      <div className="navbar-brand-text queue-navbar-title">
        <span className="brand-champ">Champ</span><span className="brand-power">power</span>
        <span className="queue-navbar-tag">คิวรับรถ</span>
      </div>

      {user && (
        <div className="queue-navbar-links">
          <Link to="/jobs" className={location.pathname === '/jobs' ? 'active' : ''}>
            รายการงานวันนี้
          </Link>
          <a href="/board" target="_blank" rel="noreferrer">จอบอร์ด ↗</a>
          <span className="navbar-user">{user.full_name}</span>
          <button type="button" className="btn-logout" onClick={handleLogout}>ออกจากระบบ</button>
        </div>
      )}
    </nav>
  );
}
