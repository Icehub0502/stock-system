// components/BottomNav.jsx
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Icons kept as inline SVG (no new asset/dependency) — small, single-color,
// inherit currentColor so active/inactive states are pure CSS.
const ICONS = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 11l9-8 9 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  stock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7l9-4 9 4-9 4-9-4z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 7v10l9 4 9-4V7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  receipt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6" strokeLinecap="round" />
    </svg>
  ),
  scan: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12h16" strokeLinecap="round" />
    </svg>
  ),
  repair: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a4 4 0 00-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 005.4-5.4l-2.4 2.4-2-2 2.4-2.4z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  ),
};

const OFFICE_ITEMS = [
  { to: '/dashboard', label: 'หน้าหลัก', icon: 'home' },
  { to: '/stock-rack', label: 'สต๊อก', icon: 'stock' },
  { to: '/receipt-list', label: 'ใบเสร็จ', icon: 'receipt' },
  { to: '/scan', label: 'สแกน', icon: 'scan' },
];

const TECHNICIAN_ITEMS = [
  { to: '/scan', label: 'สแกน QR', icon: 'scan' },
  { to: '/repair-notices', label: 'ใบแจ้งซ่อม', icon: 'repair' },
];

// Pages that already own a fixed bottom bar of their own (repair notice
// checklist's save bar) — stacking two fixed footers would overlap and
// cover each other's tap targets.
const HIDDEN_ON = ['/repair-notices/new'];

export default function BottomNav() {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) return null;
  if (HIDDEN_ON.some((p) => location.pathname.startsWith(p))) return null;

  const items = user.role === 'office' ? OFFICE_ITEMS : TECHNICIAN_ITEMS;

  const openDrawer = () => {
    window.dispatchEvent(new CustomEvent('open-nav-drawer'));
  };

  return (
    <nav className="bottom-nav" aria-label="เมนูด่วน">
      {items.map((it) => (
        <Link
          key={it.to}
          to={it.to}
          className={`bottom-nav-item ${location.pathname === it.to ? 'active' : ''}`}
        >
          <span className="bottom-nav-icon">{ICONS[it.icon]}</span>
          <span className="bottom-nav-label">{it.label}</span>
        </Link>
      ))}
      <button type="button" className="bottom-nav-item" onClick={openDrawer}>
        <span className="bottom-nav-icon">{ICONS.menu}</span>
        <span className="bottom-nav-label">เมนู</span>
      </button>
    </nav>
  );
}
