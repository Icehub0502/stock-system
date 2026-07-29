import React, { useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import champpowerLogo from '../image/champpower-logo.jpg';
import { formatMoney } from '../utils/format';
import { brandLogoSlug } from '../utils/carBrands';
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
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [parts, setParts] = useState([]);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  // ชื่อรุ่นล้วนๆ ไม่มีช่วงปีต่อท้าย — เก็บแยกจาก `model` (ซึ่งเป็น label รวมปี
  // ใช้ค้นราคาอะไหล่) เพราะตอนส่งต่อไปตั้งค่ารถของลูกค้าในใบเสนอราคา ควรได้แค่
  // ชื่อรุ่นเฉยๆ (เช่น "BRIO") ไม่ใช่ทั้งก้อน "BRIO (2011-2018)"
  const [modelPlain, setModelPlain] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // ตะกร้าที่เซลติ๊กเลือกไว้ — เก็บตาม part.id กันเลือกซ้ำเพิ่มเป็นบรรทัดใหม่
  // (ติ๊กซ้ำ = ปรับจำนวนแทน) คีย์ด้วย string เพราะมาจาก part.id ตัวเลขจาก DB
  const [selectedParts, setSelectedParts] = useState({});
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [justCreated, setJustCreated] = useState(false);

  // รายชื่อยี่ห้อรถทั้งหมด — มาจากแคตตาล็อกอ้างอิงยี่ห้อ+รุ่นรถที่นำเข้าไว้
  // (backend/scripts/import_vehicle_models.js, ตาราง vehicle_models) แทนการพึ่ง
  // /quote-parts/brands ซึ่งจะโชว์เฉพาะยี่ห้อที่มีคนกรอกราคาอะไหล่ไปแล้วเท่านั้น —
  // ต้องเลือกยี่ห้อ/รุ่นได้ล่วงหน้าไม่ว่าจะมีราคาแล้วหรือยัง
  useEffect(() => {
    client.get('/vehicle-models/brands')
      .then((res) => setBrands(res.data.data || []))
      .catch((err) => {
        console.error('Error loading brands:', err);
        setError('โหลดรายการยี่ห้อไม่สำเร็จ');
      })
      .finally(() => setLoading(false));
  }, []);

  const selectBrand = async (selected) => {
    setBrand(selected);
    setModel('');
    setParts([]);
    setModels([]);
    setLoading(true);
    setError('');
    try {
      const res = await client.get('/vehicle-models/models', { params: { brand: selected } });
      setModels(res.data.data || []);
    } catch (err) {
      console.error('Error loading models:', err);
      setError('โหลดรายการรุ่นรถไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  // modelOption.label รวมช่วงปีไว้แล้ว (เช่น "Vios / Yaris Ativ (2002-ปัจจุบัน)")
  // — ใช้ label นี้เป็นค่า "รุ่นรถ" ตอนค้นราคาอะไหล่ด้วย ให้ตรงกับที่หน้าจัดการ
  // ราคาอะไหล่บันทึกไว้ (เลือกจากแคตตาล็อกเดียวกัน ไม่พิมพ์เอง)
  const selectModel = async (modelOption) => {
    setModel(modelOption.label);
    setModelPlain(modelOption.model);
    setLoading(true);
    setError('');
    try {
      const res = await client.get('/quote-parts/parts', { params: { brand, model: modelOption.label } });
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
      setModelPlain('');
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
    setModelPlain('');
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
            <div className="kiosk-message">ไม่พบรุ่นรถของยี่ห้อ {brand} ในแคตตาล็อก</div>
          ) : (
            <div className="kiosk-grid kiosk-grid-model">
              {models.map((m) => (
                <button
                  type="button"
                  key={m.label}
                  className="kiosk-tile kiosk-tile-model"
                  onClick={() => selectModel(m)}
                >
                  <span className="kiosk-model-icon"><CarIcon /></span>
                  <span className="kiosk-tile-label">{m.label}</span>
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
          initialVehicle={{ brand, model: modelPlain }}
          onClose={() => setShowQuoteForm(false)}
          onSuccess={handleQuoteSuccess}
        />
      )}
    </div>
  );
}
