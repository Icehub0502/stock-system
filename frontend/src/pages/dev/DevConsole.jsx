import React from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import DevOverview, { DevAudit } from './DevOverview';
import DevShops, { DevUsers } from './DevShops';
import DevTrash from './DevTrash';

const SECTIONS = [
  { to: '/dev', label: 'ภาพรวมระบบ', end: true },
  { to: '/dev/shops', label: 'ร้าน / สาขา' },
  { to: '/dev/users', label: 'ผู้ใช้ทุกร้าน' },
  { to: '/dev/trash', label: 'รายการที่ถูกลบ' },
  { to: '/dev/audit', label: 'บันทึกการทำงาน' },
];

// Platform console: a page of its own (side menu) so it is not mixed with the daily shop menus.
export default function DevConsole() {
  return (
    <div className="dev-console">
      <aside className="dev-side">
        <div className="dev-side-title">จัดการระบบ</div>
        {SECTIONS.map((s) => (
          <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => `dev-side-link ${isActive ? 'active' : ''}`}>
            {s.label}
          </NavLink>
        ))}
      </aside>
      <main className="dev-main">
        <Routes>
          <Route index element={<DevOverview />} />
          <Route path="shops" element={<DevShops />} />
          <Route path="users" element={<DevUsers />} />
          <Route path="trash" element={<DevTrash />} />
          <Route path="audit" element={<DevAudit />} />
        </Routes>
      </main>
    </div>
  );
}
