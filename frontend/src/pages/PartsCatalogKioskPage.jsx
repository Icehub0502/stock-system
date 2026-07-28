import React, { useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import champpowerLogo from '../image/champpower-logo.jpg';
import { formatMoney } from '../utils/format';
import { CAR_BRANDS, brandLogoSlug } from '../utils/carBrands';
import QuotationFormModal from '../components/QuotationFormModal';

// สีประจำแท็บยี่ห้อ — ใช้เป็น fallback เมื่อยังไม่มีไฟล์โลโก้จริงของยี่ห้อนั้น
// (วางไฟล์โลโก้ไว้ที่ frontend/public/brand-logos/<slug>.png แล้วจะขึ้นแทนอัตโนมัติ
// ไม่ต้องแก้โค้ด — ดู BrandLogo ด้านล่าง)
const BRAND_COLORS = [
  '#e11d48', '#2563eb', '#059669', '#d97706', '#7c3aed',
  '#0891b2', '#be123c', '#4338ca', '#65a30d', '#c2410c',
];

function brandInitials(brand) {
  const trimmed = (brand || '').trim();
  if (!trimmed) return '?';
  const words = trimmed.split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

// ลองโหลดไฟล์โลโก้จริงจาก /brand-logos/<slug>.png ก่อน — ถ้าไม่มีไฟล์ (404/error)
// ค่อย fallback เป็นตัวอักษรย่อบนพื้นสี กันหน้าโล่งเปล่าระหว่างรอใส่โลโก้จริง
function BrandLogo({ brand, colorIndex }) {
  const [failed, setFailed] = useState(false);
  const slug = brandLogoSlug(brand);

  if (failed || !slug) {
    return (
      <span className="kiosk-brand-badge" style={{ background: BRAND_COLORS[colorIndex % BRAND_COLORS.length] }}>
        {brandInitials(brand)}
      </span>
    );
  }

  return (
    <span className="kiosk-brand-badge kiosk-brand-badge-logo">
      <img src={`/brand-logos/${slug}.png`} alt={brand} onError={() => setFailed(true)} />
    </span>
  );
}

function CarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M5 16h14M4 16v2M20 16v2" strokeLinecap="round" />
      <path d="M3.5 16l1.2-4.6A2 2 0 016.6 10h10.8a2 2 0 011.9 1.4l1.2 4.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7.5" cy="16" r="1.6" />
      <circle cx="16.5" cy="16" r="1.6" />
    </svg>
  );
}

export default function PartsCatalogKioskPage() {
  // step ปัจจุบันอนุมานจากค่าที่เลือกไว้ ไม่เก็บเป็น state แยก กันสองค่าหลุดจากกัน
  const [models, setModels] = useState([]);
  const [parts, setParts] = useState([]);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // ตะกร้าที่เซลติ๊กเลือกไว้ — เก็บตาม part.id กันเลือกซ้ำเพิ่มเป็นบรรทัดใหม่
  // (ติ๊กซ้ำ = ปรับจำนวนแทน) คีย์ด้วย string เพราะมาจาก part.id ตัวเลขจาก DB
  const [selectedParts, setSelectedParts] = useState({});
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [justCreated, setJustCreated] = useState(false);

  // หน้านี้แสดงยี่ห้อรถทั้งหมดทันทีเสมอ (รายการมาตรฐานเดียวกับที่ใช้กรอกยี่ห้อ
  // รถลูกค้าทั้งระบบ — ดู utils/carBrands.js) ไม่ต้องรอ /quote-parts/brands
  // ตอบกลับก่อนถึงจะขึ้น — ถ้ายี่ห้อไหนยังไม่มีรุ่น/ราคาเลย ขั้นถัดไปจะขึ้นข้อความ
  // แจ้งเฉยๆ ไม่ error
  const brands = CAR_BRANDS;

  const selectBrand = async (selected) => {
    setBrand(selected);
    setModel('');
    setParts([]);
    setModels([]);
    setLoading(true);
    setError('');
    try {
      const res = await client.get('/quote-parts/models', { params: { brand: selected } });
      setModels(res.data.data || []);
    } catch (err) {
      console.error('Error loading models:', err);
      setError('โหลดรายการรุ่นรถไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const selectModel = async (selected) => {
    setModel(selected);
    setLoading(true);
    setError('');
    try {
      const res = await client.get('/quote-parts/parts', { params: { brand, model: selected } });
      setParts(res.data.data || []);
    } catch (err) {
      console.error('Error loading parts:', err);
      setError('โหลดรายการอะไหล่ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (model) {
      setModel('');
      setParts([]);
    } else if (brand) {
      setBrand('');
      setModels([]);
    }
  };

  const togglePart = (part) => {
    setSelectedParts((prev) => {
      const key = String(part.id);
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { ...part, quantity: 1 } };
    });
  };

  const changeQty = (part, delta) => {
    setSelectedParts((prev) => {
      const key = String(part.id);
      const current = prev[key];
      if (!current) return prev;
      const nextQty = current.quantity + delta;
      if (nextQty <= 0) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { ...current, quantity: nextQty } };
    });
  };

  const cartItems = useMemo(() => Object.values(selectedParts), [selectedParts]);
  const cartCount = cartItems.reduce((sum, it) => sum + it.quantity, 0);
  const cartTotal = cartItems.reduce((sum, it) => sum + it.quantity * Number(it.price || 0), 0);

  const openQuoteForm = () => {
    if (cartItems.length === 0) return;
    setJustCreated(false);
    setShowQuoteForm(true);
  };

  const handleQuoteSuccess = () => {
    setShowQuoteForm(false);
    setSelectedParts({});
    setBrand('');
    setModel('');
    setModels([]);
    setParts([]);
    setJustCreated(true);
  };

  useEffect(() => {
    if (!justCreated) return undefined;
    const timer = setTimeout(() => setJustCreated(false), 4000);
    return () => clearTimeout(timer);
  }, [justCreated]);

  const step = model ? 3 : brand ? 2 : 1;

  return (
    <div className="kiosk">
      <header className="kiosk-header">
        <div className="kiosk-header-left">
          {step > 1 && (
            <button type="button" className="kiosk-back" onClick={goBack} aria-label="ย้อนกลับ">
              ‹
            </button>
          )}
          <img className="kiosk-logo" src={champpowerLogo} alt="Champ Power" />
          <div>
            <div className="kiosk-title">เสนอราคาอะไหล่</div>
            <div className="kiosk-crumb">
              {step === 1 && 'เลือกยี่ห้อรถ'}
              {step === 2 && `${brand} · เลือกรุ่นรถ`}
              {step === 3 && `${brand} · ${model}`}
            </div>
          </div>
        </div>
        <ol className="kiosk-steps">
          <li className={step >= 1 ? 'active' : ''}>ยี่ห้อ</li>
          <li className={step >= 2 ? 'active' : ''}>รุ่น</li>
          <li className={step >= 3 ? 'active' : ''}>เลือกอะไหล่</li>
        </ol>
      </header>

      {justCreated && (
        <div className="kiosk-success-banner">✅ สร้างใบเสนอราคาสำเร็จ — เริ่มใบใหม่ได้เลย</div>
      )}

      <main className={`kiosk-body ${cartItems.length > 0 && step === 3 ? 'kiosk-body-with-cart' : ''}`}>
        {error && <div className="kiosk-message kiosk-message-error">{error}</div>}

        {loading ? (
          <div className="kiosk-message">กำลังโหลด...</div>
        ) : step === 1 ? (
          <div className="kiosk-grid kiosk-grid-brand">
            {brands.map((b, idx) => (
              <button
                type="button"
                key={b}
                className="kiosk-tile kiosk-tile-brand"
                onClick={() => selectBrand(b)}
              >
                <BrandLogo brand={b} colorIndex={idx} />
                <span className="kiosk-tile-label">{b}</span>
              </button>
            ))}
          </div>
        ) : step === 2 ? (
          models.length === 0 ? (
            <div className="kiosk-message">
              ยังไม่มีรุ่นรถของยี่ห้อ {brand} — เพิ่มได้ที่เมนู "ราคาอะไหล่ตามรุ่นรถ"
            </div>
          ) : (
            <div className="kiosk-grid kiosk-grid-model">
              {models.map((m) => (
                <button
                  type="button"
                  key={m}
                  className="kiosk-tile kiosk-tile-model"
                  onClick={() => selectModel(m)}
                >
                  <span className="kiosk-model-icon"><CarIcon /></span>
                  <span className="kiosk-tile-label">{m}</span>
                </button>
              ))}
            </div>
          )
        ) : parts.length === 0 ? (
          <div className="kiosk-message">ยังไม่มีรายการอะไหล่ของ {brand} {model}</div>
        ) : (
          <div className="kiosk-grid kiosk-grid-part">
            {parts.map((part) => {
              const selected = selectedParts[String(part.id)];
              return (
                <article
                  key={part.id}
                  className={`kiosk-part ${selected ? 'kiosk-part-selected' : ''}`}
                  onClick={() => togglePart(part)}
                  role="button"
                  tabIndex={0}
                >
                  {selected && <span className="kiosk-part-check">✓</span>}
                  <div className="kiosk-part-image">
                    {part.image_data ? (
                      <img src={part.image_data} alt={part.part_name} />
                    ) : (
                      <span className="kiosk-part-noimage">ไม่มีรูป</span>
                    )}
                  </div>
                  <div className="kiosk-part-body">
                    <div className="kiosk-part-name">{part.part_name}</div>
                    {part.description && <div className="kiosk-part-desc">{part.description}</div>}
                  </div>
                  <div className="kiosk-part-price">฿{formatMoney(part.price)}</div>

                  {selected && (
                    <div className="kiosk-part-qty" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => changeQty(part, -1)} aria-label="ลดจำนวน">−</button>
                      <span>{selected.quantity}</span>
                      <button type="button" onClick={() => changeQty(part, 1)} aria-label="เพิ่มจำนวน">+</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>

      {cartItems.length > 0 && step === 3 && (
        <div className="kiosk-cart-bar">
          <div className="kiosk-cart-summary">
            <span className="kiosk-cart-count">เลือกแล้ว {cartCount} ชิ้น</span>
            <span className="kiosk-cart-total">฿{formatMoney(cartTotal)}</span>
          </div>
          <button type="button" className="kiosk-cart-cta" onClick={openQuoteForm}>
            สร้างใบเสนอราคา →
          </button>
        </div>
      )}

      {showQuoteForm && (
        <QuotationFormModal
          quotation={null}
          initialItems={cartItems.map((it) => ({
            product_name: it.part_name,
            quantity: it.quantity,
            unit_price: it.price,
          }))}
          initialVehicle={{ brand, model }}
          onClose={() => setShowQuoteForm(false)}
          onSuccess={handleQuoteSuccess}
        />
      )}
    </div>
  );
}
