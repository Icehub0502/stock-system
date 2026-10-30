import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import client from '../api/client';
import QuotationPrintTemplate from '../components/QuotationPrintTemplate';
import ReceiptPrintTemplate from '../components/ReceiptPrintTemplate';
import { logoSrc } from '../components/DocBrand';
import { useRefreshDocHeaders } from '../hooks/useDocHeader';
import { isHexColor } from '../utils/docTheme';

// Print header of the quotation and the receipt, set separately for the signed-in branch:
// company details, title, logo and one accent colour. Saved with PUT /api/doc-settings/:docType.

const DOC_TABS = [
  { key: 'quotation', label: 'ใบเสนอราคา', defaultTitle: 'ใบเสนอราคา', defaultColor: '#1e40af' },
  { key: 'receipt', label: 'ใบเสร็จรับเงิน', defaultTitle: 'ใบเสร็จรับเงิน/ใบรับประกันสินค้า', defaultColor: '#c9a35e' },
];

const TEXT_FIELDS = [
  { key: 'company_name', label: 'ชื่อบริษัท / ร้าน (แสดงสูงสุด 2 บรรทัด)', max: 120 },
  { key: 'address', label: 'ที่อยู่ (กด Enter เพื่อขึ้นบรรทัดใหม่ · แสดงสูงสุด 3 บรรทัด)', max: 300, multiline: true },
  { key: 'phone', label: 'เบอร์โทร', max: 50 },
  { key: 'line_id', label: 'LINE', max: 50 },
  { key: 'tax_id', label: 'เลขประจำตัวผู้เสียภาษี (ไม่กรอก = ไม่แสดง)', max: 60 },
];

const COLOR_PRESETS = ['#1e40af', '#0f766e', '#15803d', '#b45309', '#b91c1c', '#7e22ce', '#be185d', '#334155'];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const A4_PX = { width: 793.7, height: 1122.5 }; // 210 x 297 mm at 96 dpi
const MAX_PREVIEW_SCALE = 0.6;

const FORM_FIELDS = ['company_name', 'address', 'phone', 'line_id', 'tax_id', 'branch_text', 'title', 'accent_color', 'logo_width'];

const errorText = (err, fallback) => err.response?.data?.error || fallback;

const today = () => new Date().toISOString().slice(0, 10);

// "ff0000" is accepted as "#ff0000"
const normalizeColor = (value) => {
  const text = String(value || '').trim();
  return /^[0-9a-fA-F]{6}$/.test(text) ? `#${text}` : text;
};

// made-up document so the preview shows every part of the header
function sampleData(docType) {
  const customer = { customer_name: 'คุณตัวอย่าง ใจดี', phone: '081-234-5678', customer_code: 'C-0001' };
  const vehicle = { brand: 'Toyota', model: "Vios ปี '13-22", license_plate: '1กก 1234', mileage: 85000, color: 'ขาว' };
  if (docType === 'quotation') {
    return {
      quotation_no: 'QT-0001', quotation_date: today(), queue_no: 'A001', symptom: 'ช่วงล่างมีเสียงดัง', customer, vehicle,
      items: [
        { product_name: 'โช๊คอัพหน้า', quantity: 2, unit_price: 2500 },
        { product_name: 'ค่าแรงเปลี่ยน', quantity: 1, unit_price: 500 },
      ],
    };
  }
  return {
    receipt_no: 'RC-0001', receipt_date: today(), customer, vehicle, total_amount: 5500, paid_amount: 5500,
    items: [
      { product_name_snapshot: 'โช๊คอัพหน้า', qty: 2, price: 2500, amount: 5000 },
      { product_name_snapshot: 'ค่าแรงเปลี่ยน', qty: 1, price: 500, amount: 500 },
    ],
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('read'));
    reader.readAsDataURL(file);
  });
}

// resolves when the browser can decode the picture, so a renamed text file is refused at once
function canDecodeImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

export default function DocHeaderSettingsPage() {
  const [tab, setTab] = useState('quotation');
  const [saved, setSaved] = useState(null); // what the server holds, both documents
  const [forms, setForms] = useState({}); // edited copy per document
  // per document: a data URL (new upload), 'remove', or { copyFrom: docType }
  const [pendingLogo, setPendingLogo] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clipped, setClipped] = useState([]);
  const [scale, setScale] = useState(MAX_PREVIEW_SCALE);
  const fileRef = useRef(null);
  const colRef = useRef(null);
  const previewRef = useRef(null);
  const messageRef = useRef(null);
  const refreshHeaders = useRefreshDocHeaders();

  const applyServerData = (data, onlyTab) => {
    setSaved(data);
    setForms((prev) => (onlyTab
      ? { ...prev, [onlyTab]: { ...data[onlyTab] } }
      : { quotation: { ...data.quotation }, receipt: { ...data.receipt } }));
    setPendingLogo((prev) => (onlyTab ? { ...prev, [onlyTab]: undefined } : {}));
  };

  useEffect(() => {
    client.get('/doc-settings')
      .then((res) => applyServerData(res.data.data))
      .catch((err) => setError(errorText(err, 'โหลดหัวกระดาษไม่สำเร็จ')))
      .finally(() => setLoading(false));
  }, []);

  const meta = DOC_TABS.find((t) => t.key === tab);
  const form = forms[tab];
  const otherTab = tab === 'quotation' ? 'receipt' : 'quotation';

  const isDirtyTab = (key) => {
    if (!forms[key] || !saved) return false;
    return FORM_FIELDS.some((k) => String(forms[key][k] ?? '') !== String(saved[key][k] ?? '')) || Boolean(pendingLogo[key]);
  };
  const dirty = isDirtyTab(tab);
  const dirtyAny = isDirtyTab('quotation') || isDirtyTab('receipt');

  // refreshing or closing the tab with edits that are not saved
  useEffect(() => {
    if (!dirtyAny) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyAny]);

  // the preview sheet shrinks to the width of its column (phones included)
  useLayoutEffect(() => {
    const col = colRef.current;
    if (!col || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => setScale(Math.min(MAX_PREVIEW_SCALE, Math.max(0.2, (col.clientWidth - 2) / A4_PX.width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(col);
    return () => observer.disconnect();
  }, [loading]);

  // a new error replaces the earlier "saved" notice
  useEffect(() => { if (error) setNotice(''); }, [error]);

  // result of save / file errors appear right above the buttons: scroll them into view
  useEffect(() => {
    if ((error || notice) && messageRef.current) messageRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error, notice]);

  const setField = (key, value) => {
    setNotice('');
    setForms((prev) => ({ ...prev, [tab]: { ...prev[tab], [key]: value } }));
  };

  const chooseLogo = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setError('โลโก้ต้องเป็นไฟล์ PNG, JPG หรือ WEBP'); return; }
    if (file.size > LOGO_MAX_BYTES) { setError('ไฟล์โลโก้ใหญ่เกิน 2 MB'); return; }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!(await canDecodeImage(dataUrl))) { setError('อ่านไฟล์โลโก้ไม่ได้ ลองใช้ไฟล์รูปอื่น'); return; }
      setError('');
      setNotice('');
      setPendingLogo((prev) => ({ ...prev, [tab]: dataUrl }));
    } catch {
      setError('อ่านไฟล์โลโก้ไม่ได้');
    }
  };

  const removeLogo = () => {
    setNotice('');
    setPendingLogo((prev) => ({ ...prev, [tab]: 'remove' }));
  };

  // throw away every unsaved edit of this document (also brings a removed logo back)
  const discardEdits = () => {
    setError('');
    setNotice('');
    setForms((prev) => ({ ...prev, [tab]: { ...saved[tab] } }));
    setPendingLogo((prev) => ({ ...prev, [tab]: undefined }));
  };

  // the logo is copied on the server when saving, so no file has to be uploaded again
  const copyFromOther = () => {
    const other = forms[otherTab];
    if (!other) return;
    setNotice('');
    setError('');
    setForms((prev) => ({
      ...prev,
      [tab]: {
        ...prev[tab],
        company_name: other.company_name, address: other.address, phone: other.phone, line_id: other.line_id,
        tax_id: other.tax_id, accent_color: other.accent_color, logo_width: other.logo_width,
      },
    }));
    setPendingLogo((prev) => ({ ...prev, [tab]: { copyFrom: otherTab } }));
    setNotice(`คัดลอกจาก${DOC_TABS.find((t) => t.key === otherTab).label}แล้ว (รวมโลโก้ที่บันทึกไว้) กด "บันทึก" เพื่อใช้งาน`);
  };

  const save = async () => {
    if (!form) return;
    const color = normalizeColor(form.accent_color);
    if (color && !isHexColor(color)) { setError('สีต้องอยู่ในรูปแบบ #rrggbb เช่น #15803d'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = {};
      FORM_FIELDS.forEach((k) => { body[k] = form[k]; });
      body.accent_color = color;
      const logo = pendingLogo[tab];
      if (logo === 'remove') body.remove_logo = true;
      else if (logo && logo.copyFrom) body.copy_logo_from = logo.copyFrom;
      else if (logo) body.logo_data_url = logo;
      await client.put(`/doc-settings/${tab}`, body);
      await refreshHeaders();
      const res = await client.get('/doc-settings');
      // only this document's form is replaced: unsaved edits of the other one stay
      applyServerData(res.data.data, tab);
      setNotice(`บันทึกหัวกระดาษ${meta.label}แล้ว`);
    } catch (err) {
      setError(errorText(err, 'บันทึกไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  // what the preview shows (unsaved edits included, a chosen logo that is not uploaded yet too)
  const pending = form ? pendingLogo[tab] : undefined;
  const previewHeader = useMemo(() => {
    if (!form) return null;
    let logoPath = form.logo_path;
    if (pending === 'remove') logoPath = '';
    else if (pending && pending.copyFrom) logoPath = saved[pending.copyFrom].logo_path;
    else if (pending) logoPath = pending;
    return { ...form, accent_color: normalizeColor(form.accent_color), logo_path: logoPath, logo_width: Number(form.logo_width) || 130 };
  }, [form, pending, saved]);

  // lines the printed header cannot show: the sheet is clipped in the preview exactly as it is on paper.
  // Measured after every render and again once web fonts and the logo have loaded (their size changes the layout).
  const measureClipping = () => {
    const root = previewRef.current;
    if (!root) return;
    const found = [];
    const info = root.querySelector('.doc-brand-info');
    const brand = root.querySelector('.doc-brand');
    if (info && (brand.scrollHeight > brand.clientHeight + 1 || info.scrollHeight > info.clientHeight + 1
      || [...info.children].some((el) => el.scrollHeight > el.clientHeight + 1))) {
      found.push('ชื่อ / ที่อยู่ / ข้อมูลติดต่อยาวเกินพื้นที่หัวกระดาษ บางส่วนจะไม่ถูกพิมพ์ (ลดข้อความหรือย่อโลโก้)');
    }
    const title = root.querySelector('.doc-title-block h1');
    if (title && title.scrollWidth > title.clientWidth + 1) found.push('ชื่อหัวเอกสารยาวเกินไป จะถูกตัดท้าย');
    setClipped((prev) => (prev.join('|') === found.join('|') ? prev : found));
  };
  const measureRef = useRef(measureClipping);
  measureRef.current = measureClipping;
  useLayoutEffect(() => { measureClipping(); });
  useEffect(() => {
    const again = () => measureRef.current();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(again);
    const root = previewRef.current;
    if (root) root.addEventListener('load', again, true); // <img> load events do not bubble
    const timer = setTimeout(again, 500);
    return () => {
      clearTimeout(timer);
      if (root) root.removeEventListener('load', again, true);
    };
  }, [tab, loading]);

  if (loading && !form) return <div className="quotation-page"><div className="loading">กำลังโหลด...</div></div>;
  if (!form) return <div className="quotation-page">{error && <div className="error-message">{error}</div>}</div>;

  const PreviewTemplate = tab === 'quotation' ? QuotationPrintTemplate : ReceiptPrintTemplate;
  const currentLogo = logoSrc(previewHeader.logo_path);
  const colorValue = isHexColor(previewHeader.accent_color) ? previewHeader.accent_color : meta.defaultColor;

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>หัวกระดาษเอกสาร</h1>
          <p className="subtitle">
            ตั้งค่าโลโก้ ชื่อ ที่อยู่ และสีของใบเสนอราคา / ใบเสร็จของสาขานี้ แต่ละสาขาและแต่ละเอกสารตั้งแยกกันได้
          </p>
        </div>
      </div>
      <div className="dev-tabs">
        {DOC_TABS.map((t) => (
          <button key={t.key} type="button" className={`dev-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => { setTab(t.key); setNotice(''); setError(''); }}>
            {t.label}{isDirtyTab(t.key) ? ' •' : ''}
          </button>
        ))}
      </div>

      <div className="dh-layout">
        <div className="dh-preview-col" ref={colRef}>
          <div className="dh-preview-label">ตัวอย่าง (ย่อส่วน) — ตรงกับที่พิมพ์จริง</div>
          <div className="dh-preview" style={{ width: A4_PX.width * scale, height: A4_PX.height * scale }}>
            <div className="dh-preview-inner" ref={previewRef} style={{ transform: `scale(${scale})` }}>
              <PreviewTemplate data={sampleData(tab)} header={previewHeader} />
            </div>
          </div>
        </div>

        <div className="dh-form">
          <div className="form-group">
            <label>โลโก้ (PNG / JPG / WEBP ไม่เกิน 2 MB)</label>
            <div className="dh-logo-row">
              {currentLogo ? <img className="dh-logo-thumb" src={currentLogo} alt="โลโก้" /> : <div className="dh-logo-empty">ไม่มีโลโก้</div>}
              <div className="dh-logo-actions">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseLogo} hidden />
                <button type="button" className="btn btn-secondary" onClick={() => fileRef.current && fileRef.current.click()}>
                  {currentLogo ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้'}
                </button>
                {currentLogo && <button type="button" className="btn-danger" onClick={removeLogo}>เอาโลโก้ออก</button>}
              </div>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="dh-logo-width">ขนาดโลโก้ ({Number(form.logo_width) || 130}px)</label>
            <input id="dh-logo-width" type="range" min="60" max="200" step="5" value={Number(form.logo_width) || 130}
              onChange={(e) => setField('logo_width', Number(e.target.value))} />
          </div>

          <div className="form-group">
            <label htmlFor="dh-title">ชื่อหัวเอกสาร (ยาวเกิน 1 บรรทัดจะถูกตัด)</label>
            <input id="dh-title" type="text" maxLength={60} value={form.title} placeholder={meta.defaultTitle}
              onChange={(e) => setField('title', e.target.value)} />
          </div>
          {TEXT_FIELDS.map((f) => (
            <div className="form-group" key={f.key}>
              <label htmlFor={`dh-${f.key}`}>{f.label}</label>
              {f.multiline ? (
                <textarea id={`dh-${f.key}`} rows={3} maxLength={f.max} value={form[f.key]} onChange={(e) => setField(f.key, e.target.value)} />
              ) : (
                <input id={`dh-${f.key}`} type="text" maxLength={f.max} value={form[f.key]} onChange={(e) => setField(f.key, e.target.value)} />
              )}
            </div>
          ))}
          {tab === 'receipt' && (
            <div className="form-group">
              <label htmlFor="dh-branch_text">PIC / สาขา (ไม่กรอก = ไม่แสดงบรรทัดนี้)</label>
              <input id="dh-branch_text" type="text" maxLength={60} value={form.branch_text} onChange={(e) => setField('branch_text', e.target.value)} />
            </div>
          )}

          <div className="form-group">
            <label>สีหลักของเอกสาร</label>
            <div className="dh-color-row">
              <input type="color" aria-label="เลือกสี" value={colorValue} onChange={(e) => setField('accent_color', e.target.value)} />
              <input type="text" className="dh-color-hex" aria-label="รหัสสี" maxLength={7} placeholder={meta.defaultColor} value={form.accent_color}
                onChange={(e) => setField('accent_color', e.target.value)} />
              <button type="button" className="btn btn-secondary" onClick={() => setField('accent_color', '')}>
                ใช้สีมาตรฐาน ({tab === 'quotation' ? 'น้ำเงิน' : 'ครีม'})
              </button>
            </div>
            <div className="dh-swatches">
              {COLOR_PRESETS.map((c) => (
                <button key={c} type="button" className={`dh-swatch ${form.accent_color === c ? 'active' : ''}`} style={{ background: c }}
                  aria-label={`สี ${c}`} onClick={() => setField('accent_color', c)} />
              ))}
            </div>
          </div>

          <div ref={messageRef}>
            {clipped.map((text) => <div className="warning-message dh-clip-warning" role="alert" key={text}>{text}</div>)}
            {error && <div className="error-message" role="alert">{error}</div>}
            {notice && <div className="info-message" role="status">{notice}</div>}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !dirty}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            <button type="button" className="btn btn-secondary" onClick={discardEdits} disabled={busy || !dirty}>ยกเลิกการแก้ไข</button>
            <button type="button" className="btn btn-secondary" onClick={copyFromOther} disabled={busy}>
              คัดลอกจาก{DOC_TABS.find((t) => t.key === otherTab).label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
