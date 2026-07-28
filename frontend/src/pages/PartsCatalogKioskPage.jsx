import React, { useEffect, useState } from 'react';
import client from '../api/client';
import champpowerLogo from '../image/champpower-logo.jpg';
import { formatMoney } from '../utils/format';

// สีประจำแท็บยี่ห้อ — วนใช้ตามลำดับยี่ห้อที่โหลดมา ให้แต่ละไทล์แยกจากกันด้วยสายตา
// ได้เร็วบนแท็บเล็ต (ยังไม่มีไฟล์โลโก้ยี่ห้อในระบบ จึงใช้อักษรย่อบนพื้นสีแทนไปก่อน)
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/quote-parts/brands')
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
            <div className="kiosk-title">รายการอะไหล่และราคา</div>
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
          <li className={step >= 3 ? 'active' : ''}>อะไหล่</li>
        </ol>
      </header>

      <main className="kiosk-body">
        {error && <div className="kiosk-message kiosk-message-error">{error}</div>}

        {loading ? (
          <div className="kiosk-message">กำลังโหลด...</div>
        ) : step === 1 ? (
          brands.length === 0 ? (
            <div className="kiosk-message">
              ยังไม่มีข้อมูลราคาอะไหล่ — เพิ่มได้ที่เมนู “ราคาอะไหล่ตามรุ่นรถ”
            </div>
          ) : (
            <div className="kiosk-grid kiosk-grid-brand">
              {brands.map((b, idx) => (
                <button
                  type="button"
                  key={b}
                  className="kiosk-tile kiosk-tile-brand"
                  onClick={() => selectBrand(b)}
                >
                  <span
                    className="kiosk-brand-badge"
                    style={{ background: BRAND_COLORS[idx % BRAND_COLORS.length] }}
                  >
                    {brandInitials(b)}
                  </span>
                  <span className="kiosk-tile-label">{b}</span>
                </button>
              ))}
            </div>
          )
        ) : step === 2 ? (
          models.length === 0 ? (
            <div className="kiosk-message">ยังไม่มีรุ่นรถของยี่ห้อ {brand}</div>
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
            {parts.map((part) => (
              <article key={part.id} className="kiosk-part">
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
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
