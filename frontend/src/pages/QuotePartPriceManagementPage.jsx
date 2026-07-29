import React, { useEffect, useState } from 'react';
import client from '../api/client';
import { resizeImageToDataUrl } from '../utils/resizeImage';
import { formatMoney } from '../utils/format';

const emptyForm = { brand: '', model: '', part_name: '', description: '', price: '', image_data: '' };

export default function QuotePartPriceManagementPage() {
  const [parts, setParts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [imageBusy, setImageBusy] = useState(false);

  // ยี่ห้อ/รุ่นรถให้เลือกจากแคตตาล็อกอ้างอิง (ตาราง vehicle_models ที่นำเข้าจาก
  // Excel) แทนการพิมพ์เอง กันสะกดไม่ตรงกับที่หน้าคีออส (/catalog) ใช้ค้นหา ซึ่ง
  // จะทำให้ราคาที่กรอกไว้หาไม่เจอเงียบๆ
  const [brandOptions, setBrandOptions] = useState([]);
  const [formModelOptions, setFormModelOptions] = useState([]);

  // ตัวกรองยี่ห้อ/รุ่นสำหรับดูรายการ — แยกจาก form (ที่ใช้ตอนเพิ่ม/แก้ไข) เพราะ
  // ตอนนี้มีอะไหล่เตรียมไว้ให้ทุกรุ่นรถแล้ว (รุ่นละ ~134 รายการ x 534 รุ่น) ต้อง
  // เลือกรุ่นก่อนถึงจะโหลดรายการมาแสดง ไม่งั้นจะพยายามโหลดหลายหมื่นรายการทีเดียว
  const [filterBrand, setFilterBrand] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [filterModelOptions, setFilterModelOptions] = useState([]);

  useEffect(() => {
    client.get('/vehicle-models/brands')
      .then((res) => setBrandOptions(res.data.data || []))
      .catch((err) => console.error('Error loading vehicle brands:', err));
  }, []);

  useEffect(() => {
    if (!form.brand) {
      setFormModelOptions([]);
      return;
    }
    client.get('/vehicle-models/models', { params: { brand: form.brand } })
      .then((res) => setFormModelOptions(res.data.data || []))
      .catch((err) => console.error('Error loading vehicle models:', err));
  }, [form.brand]);

  useEffect(() => {
    if (!filterBrand) {
      setFilterModelOptions([]);
      setFilterModel('');
      return;
    }
    client.get('/vehicle-models/models', { params: { brand: filterBrand } })
      .then((res) => setFilterModelOptions(res.data.data || []))
      .catch((err) => console.error('Error loading vehicle models:', err));
  }, [filterBrand]);

  // ต้องเลือกยี่ห้อ+รุ่น หรือพิมพ์คำค้นหา อย่างใดอย่างหนึ่งก่อน ถึงจะโหลดรายการ —
  // ไม่โหลดทุกอย่างมาเปล่าๆ ตั้งแต่เข้าหน้า (ตอนนี้มีข้อมูลหลักหมื่นแถว)
  const fetchParts = async () => {
    if (!(filterBrand && filterModel) && !search.trim()) {
      setParts([]);
      return;
    }
    try {
      setLoading(true);
      setError('');
      const params = { search };
      if (filterBrand && filterModel) {
        params.brand = filterBrand;
        params.model = filterModel;
      }
      const res = await client.get('/quote-parts', { params });
      setParts(res.data.data || []);
    } catch (err) {
      console.error('Error loading quote part prices:', err);
      setError('โหลดรายการราคาอะไหล่ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(fetchParts, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterBrand, filterModel]);

  const needsPriceCount = parts.filter((p) => p.needs_price).length;

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm, brand: filterBrand, model: filterModel });
    setShowModal(true);
    setError('');
  };

  const openEdit = (part) => {
    setEditing(part);
    setForm({
      brand: part.brand || '',
      model: part.model || '',
      part_name: part.part_name || '',
      description: part.description || '',
      price: part.price != null ? String(part.price) : '',
      image_data: part.image_data || '',
    });
    setShowModal(true);
    setError('');
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm(emptyForm);
    setError('');
  };

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageBusy(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setForm((prev) => ({ ...prev, image_data: dataUrl }));
    } catch (err) {
      console.error('Error resizing image:', err);
      setError('ไม่สามารถอ่านไฟล์รูปนี้ได้');
    } finally {
      setImageBusy(false);
    }
  };

  const saveForm = async (e) => {
    e.preventDefault();
    if (!form.brand.trim() || !form.model.trim() || !form.part_name.trim()) {
      setError('กรุณากรอกยี่ห้อ รุ่นรถ และชื่ออะไหล่ให้ครบถ้วน');
      return;
    }
    try {
      const payload = {
        brand: form.brand.trim(),
        model: form.model.trim(),
        part_name: form.part_name.trim(),
        description: form.description.trim() || null,
        price: Number(form.price) || 0,
        image_data: form.image_data || null,
      };
      if (editing) {
        await client.put(`/quote-parts/${editing.id}`, { ...payload, is_active: 1 });
      } else {
        await client.post('/quote-parts', payload);
      }
      closeModal();
      fetchParts();
    } catch (err) {
      console.error('Save quote part price error:', err);
      setError(err.response?.data?.error || 'บันทึกรายการไม่สำเร็จ');
    }
  };

  const deletePart = async (id) => {
    if (!window.confirm('คุณแน่ใจว่าจะลบรายการนี้หรือไม่?')) return;
    try {
      await client.delete(`/quote-parts/${id}`);
      fetchParts();
    } catch (err) {
      console.error('Delete quote part price error:', err);
      alert(err.response?.data?.error || 'ลบรายการไม่สำเร็จ');
    }
  };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>จัดการราคาอะไหล่ตามรุ่นรถ</h1>
          <p className="subtitle">เลือกยี่ห้อ+รุ่นรถเพื่อดู/แก้ไขราคาอะไหล่ หรือค้นหาข้ามรุ่นได้เลย</p>
        </div>
        <div className="quotation-actions">
          <button className="btn btn-primary" onClick={openAdd}>
            + เพิ่มรายการ
          </button>
        </div>
      </div>

      <div className="qpp-filter-bar">
        <div className="form-group">
          <label>ยี่ห้อรถ</label>
          <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}>
            <option value="">-- ทุกยี่ห้อ --</option>
            {brandOptions.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>รุ่นรถ</label>
          <select value={filterModel} onChange={(e) => setFilterModel(e.target.value)} disabled={!filterBrand}>
            <option value="">-- เลือกรุ่น --</option>
            {filterModelOptions.map((m) => (
              <option key={m.label} value={m.label}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group qpp-filter-search">
          <label>หรือค้นหาข้ามรุ่น</label>
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหายี่ห้อ/รุ่น/ชื่ออะไหล่..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filterBrand && filterModel && parts.length > 0 && (
        <div className={`qpp-progress ${needsPriceCount > 0 ? 'qpp-progress-warning' : 'qpp-progress-done'}`}>
          {needsPriceCount > 0
            ? `⚠️ ยังไม่ตั้งราคา ${needsPriceCount} จาก ${parts.length} รายการของรุ่นนี้`
            : `✅ ตั้งราคาครบทั้ง ${parts.length} รายการของรุ่นนี้แล้ว`}
        </div>
      )}

      {error && !showModal && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : !(filterBrand && filterModel) && !search.trim() ? (
        <div className="empty-message">เลือกยี่ห้อ+รุ่นรถ หรือพิมพ์คำค้นหาด้านบน เพื่อดูรายการอะไหล่</div>
      ) : parts.length === 0 ? (
        <div className="empty-message">ไม่พบรายการ</div>
      ) : (
        <div className="qpp-grid">
          {parts.map((part) => (
            <div key={part.id} className={`qpp-card ${part.needs_price ? 'qpp-card-needs-price' : ''}`}>
              <div className="qpp-card-image">
                {part.image_data ? (
                  <img src={part.image_data} alt={part.part_name} />
                ) : (
                  <div className="qpp-card-noimage">ไม่มีรูป</div>
                )}
              </div>
              <div className="qpp-card-body">
                <div className="qpp-card-brand">{part.brand} · {part.model}</div>
                <div className="qpp-card-name">{part.part_name}</div>
                {part.description && <div className="qpp-card-desc">{part.description}</div>}
                {part.needs_price ? (
                  <div className="qpp-card-needs-price-badge">⚠️ ยังไม่ตั้งราคา</div>
                ) : (
                  <div className="qpp-card-price">฿{formatMoney(part.price)}</div>
                )}
              </div>
              <div className="qpp-card-actions">
                <button onClick={() => openEdit(part)}>แก้ไข</button>
                <button className="btn-danger" onClick={() => deletePart(part.id)}>ลบ</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-card medium" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editing ? 'แก้ไขรายการ' : 'เพิ่มรายการราคาอะไหล่'}</h2>
              <button className="btn-close" onClick={closeModal}>✕</button>
            </div>
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={saveForm} className="modal-form">
              <div className="form-group">
                <label>ยี่ห้อรถ</label>
                <select
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value, model: '' })}
                  required
                >
                  <option value="">-- เลือกยี่ห้อ --</option>
                  {/* ค่าเดิมของรายการที่กำลังแก้ไข อาจไม่อยู่ในแคตตาล็อก (เช่น
                      ยี่ห้อสะกดเองไว้ก่อนมีแคตตาล็อกนี้) — แทรกไว้กันหาย */}
                  {form.brand && !brandOptions.includes(form.brand) && (
                    <option value={form.brand}>{form.brand}</option>
                  )}
                  {brandOptions.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>รุ่นรถ</label>
                <select
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  disabled={!form.brand}
                  required
                >
                  <option value="">-- เลือกรุ่น --</option>
                  {form.model && !formModelOptions.some((m) => m.label === form.model) && (
                    <option value={form.model}>{form.model}</option>
                  )}
                  {formModelOptions.map((m) => (
                    <option key={m.label} value={m.label}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>ชื่ออะไหล่</label>
                <input
                  type="text"
                  value={form.part_name}
                  onChange={(e) => setForm({ ...form, part_name: e.target.value })}
                  placeholder="เช่น แร็คบิลด์รวมเทิร์น"
                  required
                />
              </div>
              <div className="form-group">
                <label>รายละเอียด (ถ้ามี)</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="เช่น แร็ค OEM แท้ / แร็คบิวใหม่"
                />
              </div>
              <div className="form-group">
                <label>ราคา (บาท)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>รูปสินค้า</label>
                <input type="file" accept="image/*" onChange={handleImageChange} />
                {imageBusy && <div className="loading">กำลังประมวลผลรูป...</div>}
                {form.image_data && (
                  <div className="qpp-image-preview">
                    <img src={form.image_data} alt="preview" />
                    <button type="button" className="btn btn-secondary" onClick={() => setForm({ ...form, image_data: '' })}>
                      ลบรูป
                    </button>
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">บันทึก</button>
                <button type="button" className="btn btn-secondary" onClick={closeModal}>ยกเลิก</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
