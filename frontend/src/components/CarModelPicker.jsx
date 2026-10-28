import React, { useEffect, useState } from 'react';
import client from '../api/client';
import ComboInput from './ComboInput';

/**
 * Pick the generation of a customer's car (brand → "Vios ปี '13-22'") so its standard prices can be looked up.
 * Shown when the car's saved model text does not say which generation it is. With `choices` (the typed name fits
 * several generations) only those are offered; otherwise the brand and its generations are searched.
 * onPick({ id, brand, display_name }) is called once a generation is chosen.
 */
export default function CarModelPicker({ brandHint, choices, onPick }) {
  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState(brandHint || '');
  const [models, setModels] = useState([]);
  const [text, setText] = useState('');

  useEffect(() => {
    client.get('/vehicle-models/brands').then((res) => setBrands(res.data.data || [])).catch(() => setBrands([]));
  }, []);

  useEffect(() => { setBrand(brandHint || ''); }, [brandHint]);

  useEffect(() => {
    if (choices.length > 0) {
      setModels(choices.map((m) => ({ id: m.id, brand: m.brand, display_name: m.display_name })));
      return;
    }
    const known = brands.find((b) => b.toLowerCase() === brand.trim().toLowerCase());
    if (!known) { setModels([]); return; }
    client.get('/vehicle-models/models', { params: { brand: known } })
      .then((res) => setModels((res.data.data || []).filter((m) => !m.pending).map((m) => ({ id: m.id, brand: known, display_name: m.display_name }))))
      .catch(() => setModels([]));
  }, [brand, brands, choices]);

  const handleModelText = (value) => {
    setText(value);
    const hit = models.find((m) => m.display_name === value);
    if (hit) onPick(hit);
  };

  return (
    <div className="car-model-picker">
      <p className="receipt-subtle">
        {choices.length > 0
          ? 'ชื่อรุ่นของรถคันนี้ตรงกับหลายเจเนอเรชัน ถามลูกค้าว่ารถปีไหนแล้วเลือก'
          : 'ยังไม่รู้ว่ารถคันนี้เป็นรุ่นไหนในสมุด เลือกเพื่อให้ราคามาตรฐานขึ้นให้อัตโนมัติ (ไม่เลือกก็ทำใบเสนอราคาได้ตามปกติ)'}
      </p>
      <div className="car-model-picker-row">
        {choices.length === 0 && (
          <div className="form-group">
            <label>ยี่ห้อ</label>
            <ComboInput
              value={brand}
              options={brands.map((b) => ({ value: b }))}
              allowCustom={false}
              placeholder="พิมพ์ค้นหายี่ห้อ"
              onChange={setBrand}
            />
          </div>
        )}
        <div className="form-group">
          <label>รุ่น (ปี)</label>
          <ComboInput
            value={text}
            options={models.map((m) => ({ value: m.display_name }))}
            disabled={models.length === 0}
            allowCustom={false}
            placeholder={models.length === 0 ? 'เลือกยี่ห้อก่อน' : "พิมพ์ค้นหา เช่น vios 07"}
            onChange={handleModelText}
          />
        </div>
      </div>
    </div>
  );
}
