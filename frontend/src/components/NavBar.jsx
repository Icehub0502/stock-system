// components/NavBar.jsx
import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ChangePasswordModal from "./ChangePasswordModal";
import { hasRole, isOwnerView, ROLE_LABEL } from "../utils/roles";
import { BranchSwitcher } from "./BranchSwitcher";

const NAV_CATEGORIES = [
  {
    key: "stock",
    label: "สต๊อกสินค้า",
    items: [
      { to: "/stock-all", label: "สต๊อกรวม" },
      { to: "/stock-deduction", label: "ตัดสต๊อก" },
      { to: "/receipts", label: "บิลรับของเข้า" },
      { to: "/product-costs", label: "ต้นทุนสินค้า", min: "manager" },
      { to: "/stock-costs", label: "กรอกต้นทุนที่ยังขาด" },
      { to: "/suppliers", label: "ร้านอะไหล่", min: "manager" },
    ],
  },
  {
    key: "customers",
    label: "ลูกค้า",
    items: [
      { to: "/customers", label: "ลูกค้า" },
      { to: "/vehicles", label: "รถลูกค้า" },
      { to: "/warranties", label: "การรับประกัน" },
      { to: "/claims", label: "เคลม" },
      { to: "/customers/found-via", label: "ช่องทางที่ลูกค้าเจอเรา" },
    ],
  },
  {
    key: "queue",
    label: "คิวรับรถ",
    items: [
      { to: "/jobs", label: "คิวรถวันนี้ / เพิ่มคิว" },
      { to: "/board", label: "จอแสดงคิวหน้าร้าน" },
      { to: "/jobs/pending-delivery", label: "รถที่รอส่งมอบ" },
    ],
  },
  {
    key: "sales",
    label: "งานขาย",
    items: [
      { to: "/receipt-list", label: "ใบเสร็จรับเงิน" },
      { to: "/quotations", label: "ใบเสนอราคา" },
      { to: "/vehicle-history", label: "ประวัติรถ" },
      { to: "/appointments", label: "ลูกค้าที่นัดหมาย" },
      { to: "/quotations/declined-summary", label: "ลูกค้าที่ไม่ได้ทำ (สรุปเหตุผล)" },
      { to: "/service-items", label: "รายการขาย/บริการ (ใช้ทำใบเสนอราคา)" },
      { to: "/model-prices", label: "ราคามาตรฐานตามรุ่นรถ", min: "manager" },
    ],
  },
  {
    key: "reports",
    label: "รายงาน",
    items: [
      { to: "/history", label: "ประวัติรับ-จ่ายสต๊อกทั้งหมด" },
      { to: "/stock-usage-report", label: "ประวัติการตัดสต๊อก" },
      { to: "/daily-summary", label: "สรุปยอดขายรายวัน", min: "manager" },
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
        {isOwnerView(user) && (
          <Link to="/owner" className={`navbar-standalone-link ${location.pathname === "/owner" ? "active" : ""}`} onClick={close}>ภาพรวม</Link>
        )}
        {hasRole(user, "office") && !isOwnerView(user) && (
          <Link
            to="/dashboard"
            className={`navbar-standalone-link ${location.pathname === "/dashboard" ? "active" : ""}`}
            onClick={close}
          >
            แดชบอร์ด
          </Link>
        )}
        {hasRole(user, "office") && !isOwnerView(user) &&
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
                {cat.items.filter((it) => !it.min || hasRole(user, it.min)).map((it) => (
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

        {!isOwnerView(user) && <Link to="/scan" className="navbar-standalone-link" onClick={close}>สแกน QR</Link>}
        {hasRole(user, "manager") && !isOwnerView(user) && (
          <Link to="/manager" className={`navbar-standalone-link ${location.pathname === "/manager" ? "active" : ""}`} onClick={close}>หน้าผู้จัดการ</Link>
        )}
        {hasRole(user, "owner") && (
          <Link to="/owner/overview" className={`navbar-standalone-link ${location.pathname === "/owner/overview" ? "active" : ""}`} onClick={close}>{isOwnerView(user) ? "เทียบสาขา" : "ภาพรวมทุกสาขา"}</Link>
        )}
        {hasRole(user, "dev") && (
          <Link to="/dev" className={`navbar-standalone-link ${location.pathname.startsWith("/dev") ? "active" : ""}`} onClick={close}>🛠️ จัดการระบบ</Link>
        )}
        {/* ผู้จัดการขึ้นไป — backend บังคับสิทธิ์จริงอีกชั้น (requireManager) ปุ่มนี้แค่ซ่อนไม่ให้คนอื่นเห็น */}
        {hasRole(user, "manager") && (
          <Link to="/settings" className="navbar-standalone-link" onClick={close}>⚙️ ตั้งค่า</Link>
        )}

        <BranchSwitcher />

        <div className="navbar-user-row">
          <span className="navbar-user">
            {user.full_name}
            <span className="navbar-role">
              ({ROLE_LABEL[user.role] || user.role})
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
