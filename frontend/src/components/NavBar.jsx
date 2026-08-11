// components/NavBar.jsx
import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ChangePasswordModal from "./ChangePasswordModal";

const NAV_CATEGORIES = [
  {
    key: "stock",
    label: "สต๊อกสินค้า",
    items: [
      { to: "/stock-rack", label: "StockRack" },
      { to: "/wing-arms", label: "ปีกนก" },
      { to: "/stock-deduction", label: "ตัดสต๊อก" },
      { to: "/service-items", label: "รายการสินค้า/บริการ" },
      { to: "/receipts", label: "บิลรับเข้า" },
      { to: "/product-costs", label: "ต้นทุนสินค้า" },
    ],
  },
  {
    key: "customers",
    label: "ลูกค้า",
    items: [
      { to: "/customers", label: "ลูกค้า" },
      { to: "/vehicles", label: "รถลูกค้า" },
      { to: "/warranties", label: "การรับประกัน" },
      { to: "/customers/found-via", label: "ช่องทางที่ลูกค้าเจอเรา" },
    ],
  },
  {
    key: "sales",
    label: "งานขาย",
    items: [
      { to: "/receipt-list", label: "ใบเสร็จรับเงิน" },
      { to: "/quotations", label: "ใบเสนอราคา" },
      { to: "/appointments", label: "ลูกค้าที่นัดหมาย" },
      { to: "/quotations/declined-summary", label: "สรุปลูกค้าไม่ได้ทำ" },
      { to: "/quote-parts", label: "ราคาอะไหล่ตามรุ่นรถ" },
      { to: "/catalog", label: "แคตตาล็อกอะไหล่ (แท็บเล็ต)" },
      { to: "/daily-summary", label: "สรุปยอดขายรายวัน" },
    ],
  },
  {
    key: "reports",
    label: "รายงาน",
    items: [
      { to: "/history", label: "ประวัติรายการ" },
      { to: "/stock-usage-report", label: "อะไหล่ตามรุ่นรถ" },
    ],
  },
];

export default function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openCategory, setOpenCategory] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const navRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (navRef.current && !navRef.current.contains(e.target)) {
        setOpenCategory(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setOpenCategory(null);
  }, [location.pathname]);

  // Lets BottomNav's "เมนู" tab (a sibling component with no shared state)
  // open this same drawer instead of duplicating the nav-links markup/data.
  useEffect(() => {
    const openDrawer = () => setMenuOpen(true);
    window.addEventListener('open-nav-drawer', openDrawer);
    return () => window.removeEventListener('open-nav-drawer', openDrawer);
  }, []);

  if (!user) return null;

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const close = () => {
    setMenuOpen(false);
    setOpenCategory(null);
  };

  const toggleCategory = (key) => {
    setOpenCategory((cur) => (cur === key ? null : key));
  };

  const isCategoryActive = (items) => items.some((it) => location.pathname === it.to);

  return (
    <nav className="navbar" ref={navRef}>
      <div className="navbar-brand">
        <div className="navbar-title navbar-brand-text">
          <span className="brand-champ">Champ</span><span className="brand-power">power</span><span className="brand-spk">SPK</span>
        </div>
        <button
          className="navbar-hamburger"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="เมนู"
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>

      {menuOpen && <div className="navbar-drawer-backdrop" onClick={close} />}

      <div className={`navbar-links ${menuOpen ? "open" : ""}`}>
        {user.role === "office" && (
          <Link
            to="/dashboard"
            className={`navbar-standalone-link ${location.pathname === "/dashboard" ? "active" : ""}`}
            onClick={close}
          >
            แดชบอร์ด
          </Link>
        )}
        {user.role === "office" &&
          NAV_CATEGORIES.map((cat) => (
            <div
              className={`navbar-category ${openCategory === cat.key ? "open" : ""} ${isCategoryActive(cat.items) ? "active" : ""}`}
              key={cat.key}
            >
              <button
                type="button"
                className="navbar-category-trigger"
                onClick={() => toggleCategory(cat.key)}
              >
                {cat.label}
                <span className="navbar-category-caret">▾</span>
              </button>
              <div className="navbar-category-menu">
                {cat.items.map((it) => (
                  <Link
                    key={it.to}
                    to={it.to}
                    className={location.pathname === it.to ? "active" : ""}
                    onClick={close}
                  >
                    {it.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}

        <Link to="/repair-notices" className="navbar-standalone-link" onClick={close}>ใบแจ้งซ่อม</Link>
        <Link to="/scan" className="navbar-standalone-link" onClick={close}>สแกน QR</Link>

        <div className="navbar-user-row">
          <span className="navbar-user">
            {user.full_name}
            <span className="navbar-role">
              ({user.role === "office" ? "ออฟฟิส" : "ช่าง"})
            </span>
          </span>
          <button className="btn-change-password" onClick={() => setShowChangePassword(true)}>
            เปลี่ยนรหัสผ่าน
          </button>
          <button className="btn-logout" onClick={handleLogout}>
            ออกจากระบบ
          </button>
        </div>
      </div>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </nav>
  );
}
