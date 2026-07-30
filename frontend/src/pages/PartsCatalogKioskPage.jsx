import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import champpowerLogo from '../image/champpower-logo.jpg';
import { formatMoney, todayStr } from '../utils/format';
import { brandLogoSlug } from '../utils/carBrands';
import QuotationFormModal from '../components/QuotationFormModal';

// ลองโหลดไฟล์โลโก้จริงจาก /brand-logos/<slug>.png ก่อน — ถ้าไม่มีไฟล์ (404/error)
// ไม่แสดงอะไรเลย ปล่อยให้ชื่อยี่ห้อ (kiosk-tile-label) เป็นตัวเด่นแทน (ดีไซน์แบบ
// เรียบหรู เน้นตัวอักษรล้วน แทนไอคอนวงกลมสีสันฉูดฉาด — วางไฟล์โลโก้จริงเพิ่มได้
// ทีหลังโดยไม่ต้องแก้โค้ด)
function BrandLogo({ brand }) {
  const [failed, setFailed] = useState(false);
  const slug = brandLogoSlug(brand);

  if (failed || !slug) return null;

  return (
    <span className="kiosk-brand-badge-logo">
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

let discountIdSeq = 0;
function nextDiscountId() {
  discountIdSeq += 1;
  return `d${discountIdSeq}`;
}

// คีย์ตะกร้าต้องแยก "อะไหล่เดี่ยว" (quote_part_prices.id) กับ "ชุดโปร"
// (service_items.id) ออกจากกัน เพราะทั้งสองตารางมี id เป็นตัวเลขที่ชนกันได้เอง
function itemKey(item) {
  return `${item.kind}-${item.id}`;
}

export default function PartsCatalogKioskPage() {
  // หน้านี้ซ่อน NavBar/BottomNav ทั้งคู่ (เต็มจอแบบแอป — ดู App.jsx isKiosk) จึง
  // ต้องมีปุ่มกลับหน้าหลักในตัวเอง ไม่งั้นออกจากหน้านี้ไม่ได้เลยถ้าไม่กดปุ่ม back
  // ของเบราว์เซอร์ (ซึ่งบนแท็บเล็ตคีออสมักไม่มีให้กดด้วย)
  const navigate = useNavigate();

  // ── ขั้นที่ 0: เลือกคิว/ลูกค้าของวันนี้ ── ใบเสนอราคาถูกสร้างไว้ล่วงหน้าแล้ว
  // (ลูกค้าเข้าคิวผ่านไลน์/หน้างาน มีชื่อลูกค้า+รถอยู่แล้ว แต่ยังไม่มีรายการอะไหล่)
  // เซลมาเลือกคิวของลูกค้าที่จะเสนอราคาให้ แทนที่จะกรอกข้อมูลลูกค้าเองใหม่
  const [todaysQuotations, setTodaysQuotations] = useState([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [selectedQuotation, setSelectedQuotation] = useState(null);

  // step ปัจจุบันอนุมานจากค่าที่เลือกไว้ ไม่เก็บเป็น state แยก กันสองค่าหลุดจากกัน
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [parts, setParts] = useState([]);
  const [sets, setSets] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // ตะกร้าที่เซลติ๊กเลือกไว้ — เก็บตาม itemKey() กันเลือกซ้ำเพิ่มเป็นบรรทัดใหม่
  // (ติ๊กซ้ำ = ปรับจำนวนแทน) unitPrice เป็นราคาที่พนักงานพิมพ์เอง (ไม่ใช่ราคาตั้งต้น
  // จากแคตตาล็อกโดยตรง แม้จะเติมราคาแคตตาล็อกมาให้เป็นค่าเริ่มต้นถ้ามีก็ตาม)
  const [selectedParts, setSelectedParts] = useState({});
  const [discounts, setDiscounts] = useState([]);
  const [showCart, setShowCart] = useState(false);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [justCreated, setJustCreated] = useState(false);

  const fetchTodaysQuotations = () => {
    setQueueLoading(true);
    setQueueError('');
    client.get('/quotations')
      .then((res) => {
        const today = todayStr();
        const rows = (res.data.data || []).filter((q) => {
          if (q.quotation_date !== today) return false;
          // ตัดใบที่จบงานไปแล้ว (อนุมัติ+แปลงเป็นใบเสร็จ หรือปิดบิลแล้ว) ออก —
          // เหลือไว้แต่คิวที่ยังรอเสนอราคาให้ลูกค้าอยู่
          if (q.status === 'approved' && q.converted_receipt_id) return false;
          if (q.closed_at) return false;
          return true;
        });
        rows.sort((a, b) => {
          const qa = Number(a.queue_no) || 0;
          const qb = Number(b.queue_no) || 0;
          if (qa !== qb) return qa - qb;
          return new Date(a.created_at) - new Date(b.created_at);
        });
        setTodaysQuotations(rows);
      })
      .catch((err) => {
        console.error('Error loading today\'s quotations:', err);
        setQueueError('โหลดรายการคิววันนี้ไม่สำเร็จ');
      })
      .finally(() => setQueueLoading(false));
  };

  useEffect(() => {
    fetchTodaysQuotations();
  }, []);

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
      });
  }, []);

  // ชุดโปร (เช่น "ชุดโปรช่วงล่างเก๋ง") — เพิ่มเป็นการ์ดเลือกได้เหมือนอะไหล่เดี่ยว
  // ในหน้าเลือกอะไหล่ ไม่ผูกกับยี่ห้อ/รุ่นรถ (โหลดครั้งเดียวพอ)
  useEffect(() => {
    client.get('/service-items')
      .then((res) => setSets((res.data.data || []).filter((item) => item.is_set)))
      .catch((err) => console.error('Error loading service item sets:', err));
  }, []);

  const selectQueueEntry = (q) => {
    setSelectedQuotation(q);
  };

  // ── ขั้นตอนเลือกยี่ห้อ → รุ่น → อะไหล่ (แคตตาล็อกอ้างอิง ไม่ใช่รถลูกค้าโดยตรง) ──
  const selectBrand = async (selected) => {
    setBrand(selected);
    setModel('');
    setParts([]);
    setModels([]);
    setCategoryFilter('');
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
    setCategoryFilter('');
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
      setParts([]);
      setCategoryFilter('');
    } else if (brand) {
      setBrand('');
      setModels([]);
    } else if (selectedQuotation) {
      setSelectedQuotation(null);
      fetchTodaysQuotations();
    }
  };

  // การ์ดที่แสดงในขั้นเลือกอะไหล่ — รวมอะไหล่เดี่ยวของรุ่นรถที่เลือก กับชุดโปร
  // (ไม่ผูกกับรุ่นรถ) ไว้ในกริดเดียวกัน ให้ตัวกรองหมวดหมู่ทำงานร่วมกันได้
  const displayItems = useMemo(() => {
    const setCards = sets.map((s) => ({
      id: s.id,
      kind: 'set',
      part_name: s.product_name,
      description: 'ชุดโปร — รวมอะไหล่หลายรายการ',
      price: 0,
      image_data: null,
      category: 'ชุดโปร',
    }));
    const partCards = parts.map((p) => ({ ...p, kind: 'part' }));
    return [...setCards, ...partCards];
  }, [sets, parts]);

  const categories = useMemo(() => {
    const seen = new Set();
    const list = [];
    displayItems.forEach((item) => {
      if (item.category && !seen.has(item.category)) {
        seen.add(item.category);
        list.push(item.category);
      }
    });
    return list;
  }, [displayItems]);

  const filteredItems = categoryFilter
    ? displayItems.filter((item) => item.category === categoryFilter)
    : displayItems;

  // จิ้มเลือก/ถอนอะไหล่ได้เสมอ ไม่ว่าจะมีราคาแนะนำจากแคตตาล็อกหรือยัง — ราคาที่ใช้
  // คิดยอดจริงคือ unitPrice ที่พนักงานพิมพ์เอง (เติมราคาแคตตาล็อกมาให้เป็นจุดเริ่มต้น
  // ถ้ามี ไม่งั้นเว้นว่างให้พิมพ์เอง) แก้ไขได้ในตะกร้าตลอดก่อนสร้างใบเสนอราคาจริง
  const togglePart = (part) => {
    setSelectedParts((prev) => {
      const key = itemKey(part);
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return {
        ...prev,
        [key]: {
          ...part,
          quantity: 1,
          unitPrice: Number(part.price) > 0 ? String(part.price) : '',
        },
      };
    });
  };

  const changeQty = (part, delta) => {
    setSelectedParts((prev) => {
      const key = itemKey(part);
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

  const updateItemPrice = (key, value) => {
    setSelectedParts((prev) => {
      if (!prev[key]) return prev;
      return { ...prev, [key]: { ...prev[key], unitPrice: value } };
    });
  };

  const removeItem = (key) => {
    setSelectedParts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const addDiscount = () => {
    setDiscounts((prev) => [...prev, { id: nextDiscountId(), label: 'ส่วนลด', amount: '' }]);
  };

  const updateDiscount = (id, field, value) => {
    setDiscounts((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  };

  const removeDiscount = (id) => {
    setDiscounts((prev) => prev.filter((d) => d.id !== id));
  };

  const cartItems = useMemo(() => Object.entries(selectedParts).map(([key, it]) => ({ key, ...it })), [selectedParts]);
  const cartCount = cartItems.reduce((sum, it) => sum + it.quantity, 0);
  const cartSubtotal = cartItems.reduce((sum, it) => sum + it.quantity * Number(it.unitPrice || 0), 0);
  const discountTotal = discounts.reduce((sum, d) => sum + Number(d.amount || 0), 0);
  const cartTotal = Math.max(0, cartSubtotal - discountTotal);

  const openQuoteForm = () => {
    if (cartItems.length === 0) return;
    setJustCreated(false);
    setShowCart(false);
    setShowQuoteForm(true);
  };

  const resetToQueue = () => {
    setSelectedParts({});
    setDiscounts([]);
    setBrand('');
    setModel('');
    setModels([]);
    setParts([]);
    setCategoryFilter('');
    setSelectedQuotation(null);
    fetchTodaysQuotations();
  };

  const handleQuoteSuccess = () => {
    setShowQuoteForm(false);
    resetToQueue();
    setJustCreated(true);
  };

  useEffect(() => {
    if (!justCreated) return undefined;
    const timer = setTimeout(() => setJustCreated(false), 4000);
    return () => clearTimeout(timer);
  }, [justCreated]);

  const step = !selectedQuotation ? 0 : model ? 3 : brand ? 2 : 1;

  // รายการที่ส่งต่อไปสร้างใบเสนอราคาจริง — ส่วนลดแต่ละรายการแปลงเป็นบรรทัดราคา
  // ติดลบ (ใช้กลไกคำนวณยอดรวมเดิมของใบเสนอราคา ไม่ต้องเพิ่มคอลัมน์ discount ใหม่)
  const initialItems = [
    ...cartItems.map((it) => ({
      product_name: it.part_name,
      quantity: it.quantity,
      unit_price: Number(it.unitPrice) || 0,
    })),
    ...discounts
      .filter((d) => Number(d.amount) > 0)
      .map((d) => ({
        product_name: d.label?.trim() || 'ส่วนลด',
        quantity: 1,
        unit_price: -Math.abs(Number(d.amount)),
      })),
  ];

  return (
    <div className="kiosk">
      <header className="kiosk-header">
        <div className="kiosk-header-left">
          <button type="button" className="kiosk-home" onClick={() => navigate('/')} aria-label="กลับหน้าหลัก">
            🏠
          </button>
          {step > 0 && (
            <button type="button" className="kiosk-back" onClick={goBack} aria-label="ย้อนกลับ">
              ‹
            </button>
          )}
          <img className="kiosk-logo" src={champpowerLogo} alt="Champ Power" />
          <div>
            <div className="kiosk-title">เสนอราคาอะไหล่</div>
            <div className="kiosk-crumb">
              {step === 0 && 'เลือกคิว/ลูกค้าวันนี้'}
              {step > 0 && selectedQuotation && (
                <>
                  {selectedQuotation.queue_no ? `คิว ${selectedQuotation.queue_no} · ` : ''}
                  {selectedQuotation.customer_name}
                  {step === 1 && ' · เลือกยี่ห้อรถ'}
                  {step === 2 && ` · ${brand} · เลือกรุ่นรถ`}
                  {step === 3 && ` · ${brand} · ${model}`}
                </>
              )}
            </div>
          </div>
        </div>
        <ol className="kiosk-steps">
          <li className={step >= 0 ? 'active' : ''}>คิว</li>
          <li className={step >= 1 ? 'active' : ''}>ยี่ห้อ</li>
          <li className={step >= 2 ? 'active' : ''}>รุ่น</li>
          <li className={step >= 3 ? 'active' : ''}>เลือกอะไหล่</li>
        </ol>
      </header>

      {justCreated && (
        <div className="kiosk-success-banner">✅ สร้างใบเสนอราคาสำเร็จ — เริ่มใบใหม่ได้เลย</div>
      )}

      {step === 0 ? (
        <main className="kiosk-body">
          {queueError && <div className="kiosk-message kiosk-message-error">{queueError}</div>}
          {queueLoading ? (
            <div className="kiosk-message">กำลังโหลด...</div>
          ) : todaysQuotations.length === 0 ? (
            <div className="kiosk-message">
              วันนี้ยังไม่มีคิวที่รอเสนอราคา
              <div className="kiosk-queue-refresh-wrap">
                <button type="button" className="btn btn-secondary" onClick={fetchTodaysQuotations}>
                  ⟳ โหลดใหม่
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="kiosk-queue-toolbar">
                <button type="button" className="btn btn-secondary" onClick={fetchTodaysQuotations}>
                  ⟳ โหลดใหม่
                </button>
              </div>
              <div className="kiosk-grid kiosk-grid-queue">
                {todaysQuotations.map((q) => (
                  <button
                    type="button"
                    key={q.id}
                    className="kiosk-queue-card"
                    onClick={() => selectQueueEntry(q)}
                  >
                    <span className="kiosk-queue-badge">
                      {q.queue_no ? `คิว ${q.queue_no}` : q.quotation_no}
                    </span>
                    <span className="kiosk-queue-name">{q.customer_name || 'ไม่ระบุชื่อ'}</span>
                    <span className="kiosk-queue-vehicle">
                      {[q.brand, q.model].filter(Boolean).join(' ') || 'ยังไม่ระบุรถ'}
                    </span>
                    {q.license_plate && <span className="kiosk-queue-plate">{q.license_plate}</span>}
                    <span className={`kiosk-queue-status ${q.product_summary ? '' : 'kiosk-queue-status-empty'}`}>
                      {q.product_summary ? 'มีรายการแล้ว — แตะเพื่อเพิ่ม' : 'ยังไม่มีรายการอะไหล่'}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </main>
      ) : (
        <main className={`kiosk-body ${cartItems.length > 0 && step === 3 ? 'kiosk-body-with-cart' : ''}`}>
          {error && <div className="kiosk-message kiosk-message-error">{error}</div>}

          {loading ? (
            <div className="kiosk-message">กำลังโหลด...</div>
          ) : step === 1 ? (
            <div className="kiosk-grid kiosk-grid-brand">
              {brands.map((b) => (
                <button
                  type="button"
                  key={b}
                  className="kiosk-tile kiosk-tile-brand"
                  onClick={() => selectBrand(b)}
                >
                  <BrandLogo brand={b} />
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
          ) : displayItems.length === 0 ? (
            <div className="kiosk-message">ยังไม่มีรายการอะไหล่ของ {brand} {model}</div>
          ) : (
            <>
              {categories.length > 0 && (
                <div className="kiosk-category-bar">
                  <button
                    type="button"
                    className={`kiosk-category-chip ${!categoryFilter ? 'active' : ''}`}
                    onClick={() => setCategoryFilter('')}
                  >
                    ทั้งหมด
                  </button>
                  {categories.map((cat) => (
                    <button
                      type="button"
                      key={cat}
                      className={`kiosk-category-chip ${categoryFilter === cat ? 'active' : ''}`}
                      onClick={() => setCategoryFilter(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
              <div className="kiosk-grid kiosk-grid-part">
                {filteredItems.map((part) => {
                  const key = itemKey(part);
                  const selected = selectedParts[key];
                  return (
                    <article
                      key={key}
                      className={`kiosk-part ${selected ? 'kiosk-part-selected' : ''} ${part.kind === 'set' ? 'kiosk-part-set' : ''}`}
                      onClick={() => togglePart(part)}
                      role="button"
                      tabIndex={0}
                    >
                      {selected && <span className="kiosk-part-check">✓</span>}
                      {part.kind === 'set' && <span className="kiosk-part-set-badge">ชุดโปร</span>}
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
                      {Number(part.price) > 0 && (
                        <div className="kiosk-part-price">฿{formatMoney(part.price)}</div>
                      )}

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
            </>
          )}
        </main>
      )}

      {cartItems.length > 0 && step === 3 && (
        <div className="kiosk-cart-bar">
          <button type="button" className="kiosk-cart-summary" onClick={() => setShowCart(true)}>
            <span className="kiosk-cart-count">เลือกแล้ว {cartCount} ชิ้น</span>
            <span className="kiosk-cart-total">฿{formatMoney(cartTotal)}</span>
          </button>
          <button type="button" className="kiosk-cart-cta" onClick={() => setShowCart(true)}>
            ตรวจสอบรายการ →
          </button>
        </div>
      )}

      {showCart && (
        <div className="modal-backdrop" onClick={() => setShowCart(false)}>
          <div className="modal-card medium kiosk-cart-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>รายการที่เลือก</h2>
              <button className="btn-close" onClick={() => setShowCart(false)}>✕</button>
            </div>

            <div className="kiosk-cart-list">
              {cartItems.map((it) => (
                <div key={it.key} className="kiosk-cart-line">
                  <div className="kiosk-cart-line-thumb">
                    {it.image_data ? <img src={it.image_data} alt={it.part_name} /> : <span>ไม่มีรูป</span>}
                  </div>
                  <div className="kiosk-cart-line-info">
                    <div className="kiosk-cart-line-name">{it.part_name}</div>
                    <div className="kiosk-cart-line-controls">
                      <div className="kiosk-cart-line-qty">
                        <button type="button" onClick={() => changeQty(it, -1)} aria-label="ลดจำนวน">−</button>
                        <span>{it.quantity}</span>
                        <button type="button" onClick={() => changeQty(it, 1)} aria-label="เพิ่มจำนวน">+</button>
                      </div>
                      <div className="kiosk-cart-line-price">
                        <span>฿</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="ราคา/ชิ้น"
                          value={it.unitPrice}
                          onChange={(e) => updateItemPrice(it.key, e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="kiosk-cart-line-total">
                    ฿{formatMoney(it.quantity * Number(it.unitPrice || 0))}
                  </div>
                  <button type="button" className="kiosk-cart-line-remove" onClick={() => removeItem(it.key)} aria-label="ลบรายการ">
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="kiosk-discount-section">
              <div className="kiosk-discount-header">
                <span>ส่วนลด</span>
                <button type="button" className="btn btn-secondary" onClick={addDiscount}>+ เพิ่มส่วนลด</button>
              </div>
              {discounts.map((d) => (
                <div key={d.id} className="kiosk-discount-row">
                  <input
                    type="text"
                    className="kiosk-discount-label"
                    placeholder="เช่น ส่วนลดลูกค้าประจำ"
                    value={d.label}
                    onChange={(e) => updateDiscount(d.id, 'label', e.target.value)}
                  />
                  <div className="kiosk-discount-amount">
                    <span>฿</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={d.amount}
                      onChange={(e) => updateDiscount(d.id, 'amount', e.target.value)}
                    />
                  </div>
                  <button type="button" className="kiosk-cart-line-remove" onClick={() => removeDiscount(d.id)} aria-label="ลบส่วนลด">
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="kiosk-cart-totals">
              <div>
                <span>ยอดรวม</span>
                <span>฿{formatMoney(cartSubtotal)}</span>
              </div>
              {discountTotal > 0 && (
                <div className="kiosk-cart-totals-discount">
                  <span>ส่วนลดรวม</span>
                  <span>-฿{formatMoney(discountTotal)}</span>
                </div>
              )}
              <div className="kiosk-cart-totals-grand">
                <span>ยอดสุทธิ</span>
                <span>฿{formatMoney(cartTotal)}</span>
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={openQuoteForm}>
                สร้างใบเสนอราคา →
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowCart(false)}>
                เลือกอะไหล่เพิ่ม
              </button>
            </div>
          </div>
        </div>
      )}

      {showQuoteForm && selectedQuotation && (
        <QuotationFormModal
          quotation={{ id: selectedQuotation.id }}
          initialItems={initialItems}
          onClose={() => setShowQuoteForm(false)}
          onSuccess={handleQuoteSuccess}
        />
      )}
    </div>
  );
}
