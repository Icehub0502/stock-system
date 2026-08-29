import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import client from '../api/client';
import { jobStatusDef, MAIN_PATH } from '../utils/jobStatus';
import { formatDbDateTime, todayStr } from '../utils/format';
import { resizeImageToDataUrl } from '../utils/resizeImage';
import DeclineReasonModal from '../components/DeclineReasonModal';
import ExtraBillModal from '../components/ExtraBillModal';
import PhotoLightbox from '../components/PhotoLightbox';
import QuotationPrintModal from '../components/QuotationPrintModal';
import RepairWorksheetPrintModal from '../components/RepairWorksheetPrintModal';
import useRealtimeEvent from '../hooks/useRealtimeEvent';

/**
 * รายละเอียดงาน 1 คัน — ข้อมูลรถ/ลูกค้า, รายการอะไหล่/ใบเสนอราคา, ประวัติสถานะ
 * ส่วนสถานะ/ช่องยก (เปลี่ยนไปมา, ย้อนกลับ) ย้ายไปอยู่หน้าการ์ดที่ JobBoardPage.jsx
 * แล้วตามที่เจ้าของร้านสั่ง — หน้านี้เหลือแค่เรื่องที่ซับซ้อนกว่านั้น: แก้ข้อมูล
 * รถ/ลูกค้า และตัดสินใจใบเสนอราคา (อนุมัติ/นัดวัน/ไม่ทำ)
 *
 * จุดตัดสินใจ 3 ทางแยก (อนุมัติ/นัดวันมาทำ/ไม่อนุมัติ) เรียก endpoint เฉพาะของ
 * ใบเสนอราคาเอง (/approve สร้างใบเสร็จ, /schedule ต้องมีวันนัด, /decline ต้องมี
 * เหตุผล — ตัวเดียวกับที่ QuotationListPage.jsx ใช้) แล้วค่อยอัปเดตสถานะงานให้
 * ตรงกันทีหลัง ไม่ใช่ยิง PATCH /jobs/:id/status เฉย ๆ เพราะงั้นจะข้าม side effect
 * สำคัญไป (ดูคอมเมนต์ที่ backend/src/routes/jobs.routes.js PATCH /:id/status)
 */
export default function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [form, setForm] = useState(null);

  // เลือกรายการสินค้า/บริการ (tick-select เหมือน PartsCatalogKioskPage.jsx)
  // แทนตารางกรอกมือแบบเดิม — คีย์ด้วย part.id ดึงจาก service_items แทน
  // quote_part_prices เพราะ (1) มีหมวดหมู่ครบอยู่แล้ว ไม่ผูกกับยี่ห้อ/รุ่นรถ
  // เหมือน quote_part_prices ที่ต้องกรอกยี่ห้อ/รุ่นก่อนถึงจะเห็นรายการ (2) ไม่มี
  // คอลัมน์ราคาเก็บไว้เลย ตรงกับที่ต้องการ — พนักงานเสนอราคาเองทุกครั้งตามแต่ละ
  // เคส ไม่ใช้ราคาตายตัวจากแคตตาล็อก (quote_part_prices ยังเก็บไว้ใช้ในอนาคต
  // ที่อื่นตามเดิม แค่ไม่ใช้ในแผงนี้แล้ว)
  //
  // selectedParts รวม "รายการที่มีอยู่แล้วในใบเสนอราคา" (คีย์ existing-<id>, seed
  // ตอนโหลดใบเสนอราคาที่มีอยู่) กับ "รายการที่เพิ่งติ๊กเลือกใหม่" (คีย์ = part.id
  // ตัวเลข) ไว้ในก้อนเดียวกัน เพื่อให้หน้านี้แก้ไขรายการได้ตลอดแม้สร้างใบเสนอราคา
  // ไปแล้ว (เจ้าของร้านขอ — เจอว่าต้องเพิ่มอะไหล่ทีหลังจะได้เพิ่มเข้าใบเดิมได้เลย
  // ไม่ต้องออกไปแก้ที่หน้าใบเสนอราคาแยก) และให้เป็น single source of truth เดียว
  // สำหรับทั้งช่อง checkmark ในกริดและรายการสรุปด้านบนที่โชว์ตลอดไม่ว่าจะกรอง
  // หมวดหมู่ไหนอยู่ (แก้ปัญหาเดิม: ติ๊กแล้วเปลี่ยนหมวดหมู่ มองไม่เห็นว่าเลือกอะไรไว้)
  const [catalogParts, setCatalogParts] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedParts, setSelectedParts] = useState({});
  const [quotationMeta, setQuotationMeta] = useState(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [showAddPart, setShowAddPart] = useState(false);
  const [newPart, setNewPart] = useState({ part_name: '', category: '' });
  const [addingPart, setAddingPart] = useState(false);
  const [addPartError, setAddPartError] = useState('');

  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(todayStr());
  const [showDecline, setShowDecline] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositDate, setDepositDate] = useState(todayStr());
  const [partPhotosBusy, setPartPhotosBusy] = useState(false);
  const [partPhotosError, setPartPhotosError] = useState('');
  const [intakePhotosBusy, setIntakePhotosBusy] = useState(false);
  const [intakePhotosError, setIntakePhotosError] = useState('');
  const [showWorksheetModal, setShowWorksheetModal] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [siblingQuotations, setSiblingQuotations] = useState([]);
  const [showExtraBillModal, setShowExtraBillModal] = useState(false);

  const load = async ({ silent } = {}) => {
    try {
      if (!silent) setLoading(true);
      const res = await client.get(`/jobs/${id}`);
      setJob(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดข้อมูลงานไม่สำเร็จ');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // บิลอื่นๆ ของงานนี้ (ลูกค้า+รถ+วันเดียวกัน แต่แยกจากบิลหลัก) — ดู
  // GET /jobs/:id/quotations ฝั่ง backend และ ExtraBillModal.jsx ที่สร้างบิลพวกนี้
  const loadSiblingQuotations = async () => {
    try {
      const res = await client.get(`/jobs/${id}/quotations`);
      setSiblingQuotations((res.data.data || []).filter((q) => !q.is_primary));
    } catch (err) {
      // เงียบไว้พอ — แค่แผงเสริม ไม่บล็อกการทำงานหลักของหน้านี้
    }
  };
  useEffect(() => { loadSiblingQuotations(); }, [id]);

  useEffect(() => { load(); }, [id]);

  // Realtime: pick up status/quotation changes made elsewhere (e.g. the job
  // board card, or another staff device) without a manual reload. Skipped
  // while the user has the edit form open or a mutation in flight, so a
  // background refresh never clobbers unsaved input or races an in-flight
  // action's own `load()` call.
  useRealtimeEvent(
    ['job:updated', 'job:status-changed', 'job:quotation-linked'],
    (payload) => {
      if (String(payload.jobId) !== String(id)) return;
      if (editing || saving || busy) return;
      load({ silent: true });
    }
  );

  useEffect(() => {
    if (!form?.brand?.trim()) { setModels([]); return; }
    client.get('/vehicle-models/models', { params: { brand: form.brand.trim() } }).then((res) => setModels(res.data.data || []));
  }, [form?.brand]);

  // โหลดรายการสินค้า/บริการ (ไม่ผูกกับยี่ห้อ/รุ่นรถ) เสมอ ไม่ว่าจะมีใบเสนอราคา
  // อยู่แล้วหรือยัง เพราะแผงนี้แก้ไข/เพิ่มรายการได้ตลอด — รวม "ชุดโปร" (is_set)
  // ไว้ด้วย ติ๊กแล้วจะ "กระเด้ง" ขยายเป็นรายการย่อยให้อัตโนมัติ (ดู togglePart)
  // เหมือนพฤติกรรมเดิมที่ PartsCatalogKioskPage.jsx ใช้
  useEffect(() => {
    if (!job) return;
    setCatalogLoading(true);
    setCatalogError('');
    client.get('/service-items')
      .then((res) => setCatalogParts(
        (res.data.data || [])
          .map((si) => ({ id: si.id, part_name: si.product_name, category: si.category, kind: si.is_set ? 'set' : 'part' }))
      ))
      .catch((err) => setCatalogError(err.response?.data?.error || 'โหลดรายการสินค้า/บริการไม่สำเร็จ'))
      .finally(() => setCatalogLoading(false));
  }, [job?.id]);

  // มีใบเสนอราคาจริงอยู่แล้ว (งานเก่าที่ผ่านขั้นตอนเดิม หรือมาจากไลน์บอท) — โหลด
  // รายการที่มีอยู่มา seed selectedParts (คีย์ existing-<quotation_items.id>)
  // พร้อมเก็บฟิลด์อื่นของใบเสนอราคาไว้ใน quotationMeta ไว้ส่งกลับตอนบันทึกทับ (PUT
  // ต้องส่งฟิลด์ครบ ไม่งั้นข้อมูลเดิมเช่นมัดจำ/หมายเหตุจะหาย) — ถ้ายังไม่มีใบเสนอราคา
  // จริง seed จาก job.quote_draft แทน (ร่างที่ยังไม่ตัดสินใจ เก็บไว้บนตัวงานเอง ดู
  // PATCH /jobs/:id/quote-draft) คีย์ draft-<index> ผูก dependency กับ
  // job?.quotation_id เท่านั้น (ไม่ใช่ทั้ง job object หรือ job?.quote_draft) กัน
  // effect นี้รันซ้ำทุกครั้งที่ job ถูก reload เบื้องหลัง (เช่นจาก realtime) ซึ่งจะทับ
  // รายการที่กำลังแก้ไขอยู่ทิ้ง — จึงรันใหม่แค่ตอนโหลดครั้งแรก หรือตอน quotation_id
  // เปลี่ยน (เช่นหลังโปรโมท draft เป็นใบจริงสำเร็จ)
  useEffect(() => {
    if (!job?.quotation_id) {
      setQuotationMeta(null);
      const draftItems = job?.quote_draft?.items || [];
      const seeded = {};
      draftItems.forEach((it, idx) => {
        seeded[`draft-${idx}`] = {
          part_name: it.product_name,
          quantity: it.quantity,
          unitPrice: String(it.unit_price),
          enabled: true,
        };
      });
      setSelectedParts(seeded);
      return;
    }
    setItemsLoading(true);
    client.get(`/quotations/${job.quotation_id}`)
      .then((res) => {
        const q = res.data.data;
        setQuotationMeta(q);
        const seeded = {};
        (q.items || []).forEach((it) => {
          seeded[`existing-${it.id}`] = {
            part_name: it.product_name,
            quantity: it.quantity,
            unitPrice: String(it.unit_price),
            enabled: true,
          };
        });
        setSelectedParts(seeded);
      })
      .catch((err) => setCatalogError(err.response?.data?.error || 'โหลดรายการในใบเสนอราคาไม่สำเร็จ'))
      .finally(() => setItemsLoading(false));
  }, [job?.quotation_id]);

  function startEdit() {
    setForm({
      customer_name: job.customer_name || '',
      phone: job.phone || '',
      brand: job.brand || '',
      model: job.model || '',
      color: job.color || '',
      license_plate: job.license_plate || '',
      mileage_in: job.mileage_in ?? '',
      queue_no: job.queue_no || '',
      symptom: job.symptom || '',
    });
    if (brands.length === 0) client.get('/vehicle-models/brands').then((res) => setBrands(res.data.data || []));
    setEditing(true);
  }

  // แก้ 3 จุดพร้อมกัน (ลูกค้า/รถ/งาน อยู่คนละตารางกัน) — ยี่ห้อ/รุ่นที่พิมพ์ใหม่ไม่มี
  // ในแคตตาล็อกก็เพิ่มให้เหมือนตอนเพิ่มคิว (ดู AddJobModal.jsx) ไม่มี transaction
  // ครอบคุมทั้ง 3 endpoint เพราะเป็นการแก้ไขข้อมูลอ้างอิง (ไม่ใช่ตัดสต๊อก/เงิน) ถ้า
  // ล้มเหลวกลางทางแค่กด "บันทึก" ซ้ำได้ ไม่มีผลข้างเคียงที่ต้อง rollback
  async function saveEdit() {
    setSaving(true);
    setError('');
    try {
      const brandKnown = brands.includes(form.brand.trim());
      const modelKnown = models.some((m) => m.model === form.model.trim());
      if (form.brand.trim() && form.model.trim() && (!brandKnown || !modelKnown)) {
        await client.post('/vehicle-models', { brand: form.brand.trim(), model: form.model.trim() }).catch(() => {});
      }

      await client.put(`/customers/${job.customer_id}`, { customer_name: form.customer_name.trim(), phone: form.phone.trim() });
      await client.put(`/vehicles/${job.vehicle_id}`, {
        brand: form.brand.trim(), model: form.model.trim(), color: form.color.trim(),
        license_plate: form.license_plate.trim().toUpperCase(), mileage: Number(form.mileage_in) || 0,
      });
      await client.patch(`/jobs/${id}`, {
        queue_no: form.queue_no, mileage_in: Number(form.mileage_in) || null, symptom: form.symptom,
      });

      setEditing(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  // จิ้มเลือก/ถอนรายการ (เหมือน PartsCatalogKioskPage.jsx) — ไม่มีราคาตั้งต้น
  // จากแคตตาล็อกให้เติมให้ (service_items ไม่เก็บราคา) พนักงานพิมพ์ราคาเอง
  // ทุกครั้งตามหน้างานจริง
  //
  // "ชุดโปร" (kind === 'set') ไม่ใช่รายการเดียว — จิ้มเลือกแล้วต้อง "กระเด้ง"
  // ขยายเป็นรายการย่อยของชุดนั้นทุกชิ้น (มาจาก service_item_components) ลงไปใน
  // selectedParts ทีเดียว คีย์ `set-<setId>-comp-<idx>` ไม่ใช่เพิ่มเป็นบรรทัดเดียว
  // ชื่อ "ชุดโปร..." เฉยๆ — พฤติกรรมเดียวกับ PartsCatalogKioskPage.jsx.togglePart
  async function togglePart(part) {
    if (part.kind === 'set') {
      const alreadyIn = Object.values(selectedParts).some((it) => it.setId === part.id);
      if (alreadyIn) {
        setSelectedParts((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((k) => {
            if (next[k].setId === part.id) delete next[k];
          });
          return next;
        });
        return;
      }
      try {
        const res = await client.get(`/service-items/${part.id}/components`);
        const components = res.data.data || [];
        const rows = components.length > 0 ? components : [{ component_name: part.part_name, default_qty: 1 }];
        setSelectedParts((prev) => {
          const next = { ...prev };
          rows.forEach((comp, idx) => {
            next[`set-${part.id}-comp-${idx}`] = {
              setId: part.id,
              part_name: comp.component_name,
              quantity: Number(comp.default_qty) > 0 ? Number(comp.default_qty) : 1,
              unitPrice: '',
              enabled: true,
            };
          });
          return next;
        });
      } catch (err) {
        setCatalogError(err.response?.data?.error || 'โหลดรายการย่อยของชุดไม่สำเร็จ');
      }
      return;
    }

    setSelectedParts((prev) => {
      const key = part.id;
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return {
        ...prev,
        [key]: { ...part, quantity: 1, unitPrice: '', enabled: true },
      };
    });
  }

  function changePartQty(key, delta) {
    setSelectedParts((prev) => {
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
  }

  function updatePartPrice(key, value) {
    setSelectedParts((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], unitPrice: value } } : prev));
  }

  function removeSelected(key) {
    setSelectedParts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // ปิดการมองเห็น/นับราคา — ไม่ได้ลบรายการทิ้ง แค่กันไม่ให้นับรวมยอด ใช้ตอนเสนอลูกค้า
  // ที่มีตัวเลือกราคาต่างกัน (เช่นโช้ค 2 แบบ) พิมพ์ทั้งสองแบบไว้ในรายการเดียวกัน แล้ว
  // กดปิดอันที่ลูกค้ายังไม่เลือกเพื่อให้เห็นราคาสุทธิของอันที่เปิดอยู่ — ปิดไว้ตอนกด
  // "บันทึกรายการ" ก็จะไม่ถูกบันทึกไปด้วย (ดู saveQuotationItems ที่กรองเฉพาะ enabled)
  function toggleEnabled(key) {
    setSelectedParts((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], enabled: prev[key].enabled === false } } : prev));
  }

  const catalogCategories = useMemo(() => {
    const seen = new Set();
    const list = [];
    catalogParts.forEach((p) => {
      if (p.category && !seen.has(p.category)) {
        seen.add(p.category);
        list.push(p.category);
      }
    });
    return list;
  }, [catalogParts]);

  const filteredCatalogParts = categoryFilter
    ? catalogParts.filter((p) => p.category === categoryFilter)
    : catalogParts;

  const selectedPartsList = Object.values(selectedParts);
  // เฉพาะรายการที่ "เปิด" อยู่เท่านั้นที่นับเป็นจำนวน/ยอดรวม/สิ่งที่จะบันทึกจริง —
  // รายการที่ปิดไว้ (toggleEnabled) ยังโชว์ในลิสต์เผื่อเทียบราคาต่อ แต่ไม่นับรวม
  const activePartsList = selectedPartsList.filter((p) => p.enabled !== false);
  const selectedPartsCount = activePartsList.reduce((sum, p) => sum + p.quantity, 0);
  const selectedPartsTotal = activePartsList.reduce((sum, p) => sum + p.quantity * (Number(p.unitPrice) || 0), 0);

  // เพิ่มรายการสินค้า/บริการใหม่ที่ยังไม่มีในระบบ (POST /service-items) — ไม่มี
  // ช่องราคา เพราะ service_items ไม่เก็บราคาไว้เลย พนักงานพิมพ์ราคาเองตอนติ๊ก
  // เลือกเข้ารายการ (เหมือนรายการอื่นทุกชิ้นในแผงนี้)
  async function submitNewPart(e) {
    e.preventDefault();
    if (!newPart.part_name.trim()) {
      setAddPartError('กรุณากรอกชื่อสินค้า/บริการ');
      return;
    }
    if (!newPart.category.trim()) {
      setAddPartError('กรุณากรอกหมวดหมู่');
      return;
    }
    setAddingPart(true);
    setAddPartError('');
    try {
      const res = await client.post('/service-items', {
        category: newPart.category.trim(),
        product_name: newPart.part_name.trim(),
      });
      const created = {
        id: res.data.data.id,
        part_name: newPart.part_name.trim(),
        category: newPart.category.trim(),
      };
      setCatalogParts((prev) => [...prev, created]);
      setSelectedParts((prev) => ({
        ...prev,
        [created.id]: { ...created, quantity: 1, unitPrice: '' },
      }));
      setNewPart({ part_name: '', category: '' });
      setShowAddPart(false);
    } catch (err) {
      setAddPartError(err.response?.data?.error || 'เพิ่มรายการไม่สำเร็จ');
    } finally {
      setAddingPart(false);
    }
  }

  // บันทึกรายการที่ติ๊กเลือกไว้ — ถ้ามีใบเสนอราคาจริงอยู่แล้ว (งานเก่า/มาจากไลน์บอท)
  // แก้ไขรายการทับของเดิมทั้งชุดผ่าน PUT ปกติเหมือนเดิมทุกอย่าง; ถ้ายังไม่มี ไม่สร้าง
  // ใบเสนอราคาจริงอีกต่อไป — บันทึกเป็นแค่ "ร่าง" ไว้บนตัวงานเอง (quote_draft) แล้ว
  // เปิดหน้าต่างเซ็น/พิมพ์ให้ทันที ลูกค้าดู/เซ็น/ขอใบพิมพ์ได้โดยยังไม่ต้องมีใบเสนอ
  // ราคาจริงในระบบ จนกว่าจะกด อนุมัติ/นัดวันมาทำ/ไม่ทำ อย่างใดอย่างหนึ่ง (เจ้าของร้าน
  // ขอ — ไม่อยากให้ทุกครั้งที่ติ๊กเลือกอะไหล่กลายเป็นใบเสนอราคาจริงรกพื้นที่ทันที)
  async function saveQuotationItems() {
    if (activePartsList.length === 0) {
      setError('กรุณาเลือกรายการอย่างน้อย 1 รายการ');
      return;
    }
    setBusy(true);
    setError('');
    // บันทึกเฉพาะรายการที่ "เปิด" อยู่ — รายการที่ปิดไว้เพื่อเทียบราคา (toggleEnabled)
    // เป็นแค่ตัวช่วยตัดสินใจตอนคุยกับลูกค้า ไม่ควรติดไปในใบเสนอราคาจริง
    const items = activePartsList.map((p) => ({
      product_name: p.part_name,
      quantity: p.quantity,
      unit_price: Number(p.unitPrice) || 0,
    }));
    try {
      if (job.quotation_id) {
        await client.put(`/quotations/${job.quotation_id}`, {
          customer_id: quotationMeta?.customer_id,
          vehicle_id: quotationMeta?.vehicle_id,
          quotation_date: quotationMeta?.quotation_date,
          mileage: quotationMeta?.mileage,
          remark: quotationMeta?.remark,
          queue_no: quotationMeta?.queue_no,
          symptom: quotationMeta?.symptom,
          deposit_amount: quotationMeta?.deposit_amount,
          deposit_date: quotationMeta?.deposit_date,
          items,
        });
        await load();
      } else {
        await client.patch(`/jobs/${id}/quote-draft`, { items });
        await load();
        setShowPrintModal(true);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  // อนุมัติ/นัดวันมาทำ/ไม่ทำ: งานเก่าที่มีใบเสนอราคาจริงอยู่แล้วใช้ endpoint เดิมของ
  // ใบเสนอราคา (ไม่เปลี่ยนพฤติกรรม); งานที่ยังเป็นแค่ร่าง (ปกติตอนนี้) ใช้ endpoint
  // ใหม่ที่ "โปรโมท" quote_draft เป็นใบเสนอราคาจริงในทีเดียวกับการตัดสินใจ (ดู
  // POST /jobs/:id/quotation/* ใน backend/src/routes/jobs.routes.js)
  async function handleApprove() {
    setBusy(true);
    setError('');
    try {
      if (job.quotation_id) {
        await client.patch(`/quotations/${job.quotation_id}/approve`);
        await client.patch(`/jobs/${id}/status`, { status: 'approved' });
      } else {
        await client.post(`/jobs/${id}/quotation/approve`);
      }
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'อนุมัติไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function handleSchedule() {
    if (!scheduleDate) return;
    setBusy(true);
    setError('');
    try {
      if (job.quotation_id) {
        await client.patch(`/quotations/${job.quotation_id}/schedule`, { scheduled_date: scheduleDate });
        await client.patch(`/jobs/${id}/status`, { status: 'scheduled' });
      } else {
        await client.post(`/jobs/${id}/quotation/schedule`, { scheduled_date: scheduleDate });
      }
      setShowSchedule(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกวันนัดหมายไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  // มัดจำ: ลูกค้าวางเงินแล้วขับรถกลับไปก่อน (รออะไหล่) ยังไม่รู้วันที่จะกลับมาทำ —
  // ใบเสนอราคาไปอยู่สถานะ "ยังไม่ระบุวันนัดหมาย" ในหน้ามัดจำ ส่วนงานจบเป็น "เอารถลง"
  // หลุดจากคิววันนี้ พอถึงวันนัดค่อยกด "สร้างคิว" จากหน้ามัดจำเพื่อรับรถกลับเข้ามาใหม่
  async function handleDeposit() {
    if (!(Number(depositAmount) > 0)) {
      setError('กรุณากรอกยอดมัดจำให้ถูกต้อง');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (job.quotation_id) {
        await client.patch(`/quotations/${job.quotation_id}/no-date`);
        await client.patch(`/jobs/${id}/status`, { status: 'carout' });
      } else {
        await client.post(`/jobs/${id}/quotation/deposit`, {
          deposit_amount: Number(depositAmount),
          deposit_date: depositDate,
        });
      }
      setShowDeposit(false);
      navigate('/appointments');
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกมัดจำไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  // รูปรถตอนรับเข้า — เดิมตั้งได้ครั้งเดียวตอนสร้างงานที่หน้า "เพิ่มคิว" เท่านั้น ไม่มี
  // ทางเพิ่ม/ลบทีหลังเลย พังกับงานที่สร้างจากไลน์ (ยังไม่มีรูปตอนสร้าง ตั้งใจให้มา
  // แนบทีหลังตอนรถถึงร้านจริง) เพิ่ม/ลบ/จัดลำดับได้ทุกสถานะงาน (mirror รูปอะไหล่ด้านล่าง
  // ทุกอย่างยกเว้นไม่ต้องเช็คสถานะอนุมัติ)
  async function handleAddIntakePhotos(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setIntakePhotosBusy(true);
    setIntakePhotosError('');
    try {
      // ลูกค้าเปิดดูและเซฟรูปเองได้จากหน้าประวัติ (/track) — ใช้ขนาด/คุณภาพสูงกว่า
      // ค่าเริ่มต้นของฟังก์ชัน (ตั้งไว้สำหรับรูปการ์ดอะไหล่เล็ก ๆ) กันรูปแตกตอนเซฟ —
      // เก็บรูปย่อเล็กจริง ๆ คู่กันไปด้วย (thumb) ให้ GET /jobs ใช้โชว์บนการ์ดรายการ
      // งานวันนี้แทนรูปเต็ม (เดิมโหลดหนักทั้งวัน)
      const resized = await Promise.all(files.map(async (f) => ({
        full: await resizeImageToDataUrl(f, 1280, 0.85),
        thumb: await resizeImageToDataUrl(f, 200, 0.5),
      })));
      await client.post(`/jobs/${id}/photos`, { photos: resized });
      await load({ silent: true });
    } catch (err) {
      setIntakePhotosError(err.response?.data?.error || 'เพิ่มรูปรถไม่สำเร็จ');
    } finally {
      setIntakePhotosBusy(false);
    }
  }

  async function handleDeleteIntakePhoto(photoId) {
    setIntakePhotosBusy(true);
    setIntakePhotosError('');
    try {
      await client.delete(`/jobs/${id}/photos/${photoId}`);
      await load({ silent: true });
    } catch (err) {
      setIntakePhotosError(err.response?.data?.error || 'ลบรูปรถไม่สำเร็จ');
    } finally {
      setIntakePhotosBusy(false);
    }
  }

  async function handleMoveIntakePhoto(photoId, direction) {
    setIntakePhotosBusy(true);
    setIntakePhotosError('');
    try {
      await client.patch(`/jobs/${id}/photos/${photoId}/move`, { direction });
      await load({ silent: true });
    } catch (err) {
      setIntakePhotosError(err.response?.data?.error || 'จัดลำดับรูปไม่สำเร็จ');
    } finally {
      setIntakePhotosBusy(false);
    }
  }

  // รูปอะไหล่ของใหม่ก่อนใส่ — เพิ่ม/ลบ/จัดลำดับได้ตลอด (หลังอนุมัติแล้วเท่านั้น ดู
  // canAddPartPhotos ด้านล่าง) mirror utils/resizeImage.js เดียวกับ AddJobModal.jsx
  // ที่ใช้ตอนถ่ายรูปรถรับเข้าคิว แต่ยิงเข้า API ทันทีทีละครั้ง ไม่รอกดบันทึกฟอร์ม
  // เพราะรูปพวกนี้เพิ่มเข้าไปทีหลังหลังงานสร้างไปนานแล้ว ไม่มีฟอร์มให้รอบันทึกรวม
  async function handleAddPartPhotos(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setPartPhotosBusy(true);
    setPartPhotosError('');
    try {
      // ลูกค้าเปิดดูและเซฟรูปเองได้จากหน้าประวัติ (/track) — ใช้ขนาด/คุณภาพสูงกว่า
      // ค่าเริ่มต้นของฟังก์ชัน (ตั้งไว้สำหรับรูปการ์ดอะไหล่เล็ก ๆ) กันรูปแตกตอนเซฟ
      const resized = await Promise.all(files.map((f) => resizeImageToDataUrl(f, 1280, 0.85)));
      await client.post(`/jobs/${id}/part-photos`, { photos: resized });
      await load({ silent: true });
    } catch (err) {
      setPartPhotosError(err.response?.data?.error || 'เพิ่มรูปอะไหล่ไม่สำเร็จ');
    } finally {
      setPartPhotosBusy(false);
    }
  }

  async function handleDeletePartPhoto(photoId) {
    setPartPhotosBusy(true);
    setPartPhotosError('');
    try {
      await client.delete(`/jobs/${id}/part-photos/${photoId}`);
      await load({ silent: true });
    } catch (err) {
      setPartPhotosError(err.response?.data?.error || 'ลบรูปอะไหล่ไม่สำเร็จ');
    } finally {
      setPartPhotosBusy(false);
    }
  }

  async function handleMovePartPhoto(photoId, direction) {
    setPartPhotosBusy(true);
    setPartPhotosError('');
    try {
      await client.patch(`/jobs/${id}/part-photos/${photoId}/move`, { direction });
      await load({ silent: true });
    } catch (err) {
      setPartPhotosError(err.response?.data?.error || 'จัดลำดับรูปไม่สำเร็จ');
    } finally {
      setPartPhotosBusy(false);
    }
  }

  async function handleDeclineConfirm({ reason, note }) {
    setBusy(true);
    setError('');
    try {
      if (job.quotation_id) {
        await client.patch(`/quotations/${job.quotation_id}/decline`, { reason, note });
        await client.patch(`/jobs/${id}/status`, { status: 'rejected' });
      } else {
        await client.post(`/jobs/${id}/quotation/decline`, { reason, note });
      }
      setShowDecline(false);
      navigate('/quotations/declined-summary');
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteJob() {
    setBusy(true);
    setError('');
    try {
      await client.delete(`/jobs/${id}`);
      navigate('/jobs');
    } catch (err) {
      setError(err.response?.data?.error || 'ลบงานไม่สำเร็จ');
      setBusy(false);
      setShowDeleteConfirm(false);
    }
  }

  if (loading) return <div className="office-dashboard container"><div className="loading">กำลังโหลด...</div></div>;
  if (!job) return <div className="office-dashboard container"><div className="error-message">{error || 'ไม่พบงานนี้'}</div></div>;

  const isDecisionPoint = job.status === 'quoted';
  // มีข้อมูลให้ตัดสินใจแล้วหรือยัง — ใบเสนอราคาจริง (งานเก่า/ไลน์บอท) หรือร่างที่
  // บันทึกไว้แล้ว (ปกติตอนนี้) อย่างใดอย่างหนึ่งก็พอ
  const hasQuoteData = Boolean(job.quotation_id) || (job.quote_draft?.items?.length > 0);
  // ลายเซ็นลูกค้า: อ่านจากใบเสนอราคาจริงถ้ามีแล้ว ไม่งั้นอ่านจากร่าง
  const customerSigned = job.quotation_id ? Boolean(job.customer_signature) : Boolean(job.quote_draft?.customer_signature);

  const intakePhotos = (job.photos || []).filter((p) => p.photo_type !== 'part');
  const partPhotos = (job.photos || []).filter((p) => p.photo_type === 'part');
  // ถ่ายรูปอะไหล่ได้ตั้งแต่อนุมัติเป็นต้นไป (อนุมัติ/กำลังซ่อม/รอตั้งศูนย์/พร้อมส่ง/
  // ส่งแล้ว) — mirror PART_PHOTO_ALLOWED_STATUSES ฝั่ง backend/src/routes/jobs.routes.js
  const canAddPartPhotos = MAIN_PATH.indexOf(job.status) >= MAIN_PATH.indexOf('approved');

  return (
    <div className="office-dashboard container">
      <div className="dashboard-header">
        <h2>{job.job_no} <span className="dashboard-header-sub">— คิว {job.queue_no || '-'}</span></h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn-danger" onClick={() => setShowDeleteConfirm(true)}>ลบงานนี้</button>
          <button type="button" onClick={() => navigate('/jobs')}>← กลับรายการงาน</button>
        </div>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          ข้อมูลรถ / ลูกค้า
          {!editing && <button type="button" onClick={startEdit}>แก้ไข</button>}
        </div>

        {editing ? (
          <form className="modal-form" onSubmit={(e) => { e.preventDefault(); saveEdit(); }}>
            <label>เลขคิว</label>
            <input type="text" value={form.queue_no} onChange={(e) => setForm({ ...form, queue_no: e.target.value })} />

            <label>ทะเบียนรถ</label>
            <input type="text" value={form.license_plate} onChange={(e) => setForm({ ...form, license_plate: e.target.value })} />

            <label>ชื่อลูกค้า</label>
            <input type="text" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />

            <label>เบอร์โทรศัพท์</label>
            <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />

            <label>ยี่ห้อรถ</label>
            <input
              type="text" list="jdp-brand-options" value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value, model: '' })}
            />
            <datalist id="jdp-brand-options">
              {brands.map((b) => <option key={b} value={b} />)}
            </datalist>

            <label>รุ่นรถ</label>
            <input type="text" list="jdp-model-options" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <datalist id="jdp-model-options">
              {models.map((m) => <option key={m.model} value={m.model} />)}
            </datalist>

            <label>สีรถ</label>
            <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />

            <label>เลขไมล์</label>
            <input type="number" min="0" value={form.mileage_in} onChange={(e) => setForm({ ...form, mileage_in: e.target.value })} />

            <label>อาการ</label>
            <textarea rows={3} value={form.symptom} onChange={(e) => setForm({ ...form, symptom: e.target.value })} />

            {error && <p className="error-text">{error}</p>}

            <div className="modal-actions">
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
              <button type="button" onClick={() => { setEditing(false); setError(''); }} disabled={saving}>ยกเลิก</button>
            </div>
          </form>
        ) : (
          <>
            <p><strong>ชื่อลูกค้า:</strong> {job.customer_name || '-'} {job.phone && `(${job.phone})`}</p>
            <p><strong>ยี่ห้อรถ:</strong> {job.brand || '-'}</p>
            <p><strong>รุ่นรถ:</strong> {job.model || '-'} {job.color && `· ${job.color}`}</p>
            <p><strong>ทะเบียนรถ:</strong> {job.license_plate || '-'}</p>
            <p><strong>เลขไมล์:</strong> {job.mileage_in ?? '-'}</p>
            <p><strong>อาการที่แจ้ง:</strong> {job.symptom || '-'}</p>
            {job.note && <p><strong>หมายเหตุ:</strong> {job.note}</p>}
            <p style={{ fontSize: 13, color: '#6b7280' }}>ดูสถานะ/เปลี่ยนสถานะ/ช่องยกได้ที่การ์ดในหน้ารายการงานวันนี้</p>
          </>
        )}
      </div>

      {isDecisionPoint && (
        <div className="dash-panel">
          <div className="dash-panel-title">ตัดสินใจใบเสนอราคา</div>
          {error && <p className="error-text">{error}</p>}
          {hasQuoteData ? (
            <>
              <div className="modal-actions" style={{ marginBottom: 10 }}>
                <button type="button" onClick={() => setShowPrintModal(true)}>
                  เซ็นเอกสาร / พิมพ์ใบเสนอราคา
                </button>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-primary" disabled={busy || !customerSigned} onClick={handleApprove}>
                  อนุมัติ
                </button>
                <button type="button" disabled={busy} onClick={() => setShowSchedule(true)}>
                  นัดวันมาทำ
                </button>
                <button type="button" disabled={busy} onClick={() => { setError(''); setShowDeposit(true); }}>
                  มัดจำ
                </button>
                <button type="button" className="btn-danger" disabled={busy} onClick={() => setShowDecline(true)}>
                  ไม่ทำ
                </button>
              </div>
              {!customerSigned && (
                <p style={{ color: '#92400e', fontSize: 12.5, marginTop: 6 }}>กรุณาเซ็นเอกสารก่อนกดอนุมัติ</p>
              )}
            </>
          ) : (
            <p style={{ color: '#92400e', fontSize: 13 }}>⚠️ เพิ่มรายการอะไหล่แล้วกดบันทึกข้อมูลก่อน ถึงจะตัดสินใจได้</p>
          )}
        </div>
      )}

      <div className="dash-panel">
        <div className="dash-panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          ใบเสนอราคา
          {hasQuoteData && (
            <button type="button" onClick={() => setShowWorksheetModal(true)}>
              🔧 พิมพ์ใบแจ้งซ่อม
            </button>
          )}
        </div>
        {job.quotation_id && (
          <p className="jdp-quotation-meta">
            เลขที่ <strong>{job.quotation_no}</strong> — สถานะ {job.quotation_status}
            {' '}(<Link to="/quotations">ไปหน้าใบเสนอราคา / พิมพ์</Link>)
          </p>
        )}
        {job.deposit_amount > 0 && (
          <p className="jdp-deposit-meta">
            💰 มัดจำแล้ว <strong>฿{Number(job.deposit_amount).toLocaleString('th-TH')}</strong>
            {job.deposit_date && ` เมื่อวันที่ ${new Date(job.deposit_date).toLocaleDateString('th-TH')}`}
          </p>
        )}

        <div className="jdp-part-picker">
          {error && <p className="error-text">{error}</p>}
          {catalogError && <p className="error-text">{catalogError}</p>}

          {/* รายการที่เลือกไว้ — โชว์ตลอดไม่ว่าจะกรองหมวดหมู่ไหนอยู่ (ทั้งของเดิม
              ที่มีอยู่แล้วในใบเสนอราคา และของที่เพิ่งติ๊กเพิ่ม) แก้จำนวน/ราคา/ลบ
              ได้ตรงนี้เลย ไม่ต้องไล่หาในกริดด้านล่าง */}
          {selectedPartsList.length > 0 && (
            <div className="jdp-selected-list">
              <div className="jdp-selected-list-title">รายการที่เลือก ({selectedPartsCount} ชิ้น)</div>
              {Object.entries(selectedParts).map(([key, item]) => {
                const isEnabled = item.enabled !== false;
                return (
                  <div className={`jdp-selected-row${isEnabled ? '' : ' jdp-selected-row--disabled'}`} key={key}>
                    <span className="jdp-selected-name">{item.part_name}</span>
                    {/* กลุ่มควบคุมทั้งสี่ (ปิดการมองเห็น/จำนวน/ราคา/ลบ) รวมเป็นก้อนเดียว
                        ไม่แยกกันห่อบรรทัดใหม่ทีละปุ่ม — กันปัญหาเดิมที่จอแคบแล้วปุ่มหลุด
                        กระจัดกระจาย/โดนตัดขอบ ถ้าพื้นที่ไม่พอก็ตกไปทั้งก้อนแทน */}
                    <div className="jdp-selected-controls">
                      <button
                        type="button"
                        className="jdp-selected-toggle"
                        onClick={() => toggleEnabled(key)}
                        aria-label={isEnabled ? 'ปิดการมองเห็น (ไม่นับราคา)' : 'เปิดการมองเห็น (นับราคา)'}
                        title={isEnabled ? 'ปิดการมองเห็น (ไม่นับราคา)' : 'เปิดการมองเห็น (นับราคา)'}
                      >
                        {isEnabled ? '👁️' : '🚫'}
                      </button>
                      <div className="jdp-selected-qty">
                        <button type="button" onClick={() => changePartQty(key, -1)} aria-label="ลดจำนวน">−</button>
                        <span>{item.quantity}</span>
                        <button type="button" onClick={() => changePartQty(key, 1)} aria-label="เพิ่มจำนวน">+</button>
                      </div>
                      <label className="jdp-selected-price">
                        <span>฿</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="ราคา/หน่วย"
                          value={item.unitPrice}
                          onChange={(e) => updatePartPrice(key, e.target.value)}
                        />
                      </label>
                      <button type="button" className="jdp-selected-remove" onClick={() => removeSelected(key)} aria-label="ลบรายการ">
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
              <div className="jdp-selected-total">รวม {selectedPartsTotal.toLocaleString('th-TH')} บาท</div>
            </div>
          )}

          {catalogLoading || itemsLoading ? (
            <div className="loading">กำลังโหลดรายการสินค้า/บริการ...</div>
          ) : (
            <>
              {catalogCategories.length > 0 && (
                <div className="jdp-category-bar">
                  <button
                    type="button"
                    className={`jdp-category-chip ${!categoryFilter ? 'active' : ''}`}
                    onClick={() => setCategoryFilter('')}
                  >
                    ทั้งหมด
                  </button>
                  {catalogCategories.map((cat) => (
                    <button
                      type="button"
                      key={cat}
                      className={`jdp-category-chip ${categoryFilter === cat ? 'active' : ''}`}
                      onClick={() => setCategoryFilter(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}

              {filteredCatalogParts.length === 0 ? (
                <p className="empty-message">ยังไม่มีรายการสินค้า/บริการในระบบ — เพิ่มใหม่ได้ด้านล่าง</p>
              ) : (
                <div className="jdp-item-grid">
                  {filteredCatalogParts.map((part) => {
                    const selected = part.kind === 'set'
                      ? Object.values(selectedParts).some((it) => it.setId === part.id)
                      : selectedParts[part.id];
                    return (
                      <button
                        type="button"
                        key={part.id}
                        className={`jdp-item-btn ${selected ? 'active' : ''} ${part.kind === 'set' ? 'jdp-item-set' : ''}`}
                        onClick={() => togglePart(part)}
                      >
                        {selected && <span className="jdp-item-check">✓</span>}
                        {part.part_name}
                        {part.kind === 'set' && <span className="jdp-item-set-badge">ชุดโปร</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div className="jdp-add-part">
            {!showAddPart ? (
              <button type="button" onClick={() => setShowAddPart(true)}>
                + เพิ่มรายการใหม่
              </button>
            ) : (
              <form className="modal-form jdp-add-part-form" onSubmit={submitNewPart}>
                <label>ชื่อสินค้า/บริการ</label>
                <input
                  type="text"
                  value={newPart.part_name}
                  onChange={(e) => setNewPart({ ...newPart, part_name: e.target.value })}
                />
                <label>หมวดหมู่</label>
                <input
                  type="text"
                  list="jdp-category-options"
                  value={newPart.category}
                  onChange={(e) => setNewPart({ ...newPart, category: e.target.value })}
                />
                <datalist id="jdp-category-options">
                  {catalogCategories.map((c) => <option key={c} value={c} />)}
                </datalist>
                {addPartError && <p className="error-text">{addPartError}</p>}
                <div className="modal-actions">
                  <button type="submit" className="btn-primary" disabled={addingPart}>
                    {addingPart ? 'กำลังเพิ่ม...' : 'เพิ่ม'}
                  </button>
                  <button type="button" onClick={() => { setShowAddPart(false); setAddPartError(''); }} disabled={addingPart}>
                    ยกเลิก
                  </button>
                </div>
              </form>
            )}
          </div>

          <button
            type="button"
            className="btn-primary"
            disabled={busy || itemsLoading || activePartsList.length === 0}
            onClick={saveQuotationItems}
          >
            {busy ? 'กำลังบันทึก...' : job.quotation_id ? '+ เพิ่มรายการเข้าใบเสนอราคา' : 'บันทึกข้อมูล'}
          </button>
        </div>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          บิลอื่นๆ ของงานนี้ {siblingQuotations.length > 0 && `(${siblingQuotations.length})`}
          <button type="button" onClick={() => setShowExtraBillModal(true)}>+ เพิ่มบิลใหม่</button>
        </div>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: -6 }}>
          แยกรายการที่ลูกค้าอยากทำวันหลัง/ขอใบเสนอราคาไว้ก่อนออกเป็นบิลต่างหาก ไม่กระทบบิลหลัก/สถานะคิวนี้
        </p>
        {siblingQuotations.length === 0 ? (
          <p className="empty-message">ยังไม่มีบิลแยก</p>
        ) : (
          <table className="quotation-table">
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>สถานะ</th>
                <th>ยอดรวม</th>
                <th>มัดจำ</th>
              </tr>
            </thead>
            <tbody>
              {siblingQuotations.map((q) => (
                <tr key={q.id}>
                  <td>{q.quotation_no}</td>
                  <td>{q.status}{q.scheduled_date && ` — นัด ${new Date(q.scheduled_date).toLocaleDateString('th-TH')}`}</td>
                  <td>฿{Number(q.total_amount).toLocaleString('th-TH')}</td>
                  <td>{q.deposit_amount > 0 ? `฿${Number(q.deposit_amount).toLocaleString('th-TH')}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
          ดูรายละเอียด/พิมพ์บิลเหล่านี้ได้ที่ <Link to="/quotations">หน้าใบเสนอราคา</Link>
        </p>
      </div>

      {showExtraBillModal && (
        <ExtraBillModal
          job={job}
          catalogParts={catalogParts}
          onClose={() => setShowExtraBillModal(false)}
          onCreated={() => { setShowExtraBillModal(false); loadSiblingQuotations(); }}
        />
      )}

      <div className="dash-panel">
        <div className="dash-panel-title">รูปรถตอนรับเข้า</div>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: -6 }}>
          เพิ่มรูปรถได้ทุกเมื่อ — เช่นงานที่รับคิวมาจากไลน์ยังไม่มีรูปตอนสร้าง หรือถ่ายตอนรับรถไม่ครบ
        </p>
        {intakePhotosError && <p className="error-text">{intakePhotosError}</p>}
        {intakePhotos.length > 0 && (
          <div className="job-photo-picker">
            {intakePhotos.map((p, idx) => (
              <div className="job-photo-thumb" key={p.id}>
                <span className="job-photo-num">{idx + 1}</span>
                <img src={p.photo_data} alt="" onClick={() => setLightboxSrc(p.photo_data)} />
                <div className="job-photo-thumb-actions">
                  <button type="button" disabled={intakePhotosBusy || idx === 0} onClick={() => handleMoveIntakePhoto(p.id, -1)}>◀</button>
                  <button type="button" disabled={intakePhotosBusy} onClick={() => handleDeleteIntakePhoto(p.id)}>✕</button>
                  <button type="button" disabled={intakePhotosBusy || idx === intakePhotos.length - 1} onClick={() => handleMoveIntakePhoto(p.id, 1)}>▶</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="job-photo-add-row">
          <label className="btn job-photo-add-btn">
            📷 ถ่ายรูป
            <input type="file" accept="image/*" capture="environment" multiple hidden disabled={intakePhotosBusy} onChange={handleAddIntakePhotos} />
          </label>
          <label className="btn job-photo-add-btn">
            🖼️ เลือกรูป
            <input type="file" accept="image/*" multiple hidden disabled={intakePhotosBusy} onChange={handleAddIntakePhotos} />
          </label>
          {intakePhotosBusy && <span style={{ fontSize: 13, color: '#6b7280' }}>กำลังบันทึก...</span>}
        </div>
      </div>

      {canAddPartPhotos && (
        <div className="dash-panel">
          <div className="dash-panel-title">รูปอะไหล่ของใหม่</div>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: -6 }}>
            ถ่ายรูปอะไหล่ของใหม่ตามรายการที่เปลี่ยน ให้ลูกค้าดูได้ว่าเปลี่ยนของจริงตามที่เสนอราคาไว้
          </p>
          {partPhotosError && <p className="error-text">{partPhotosError}</p>}
          {partPhotos.length > 0 && (
            <div className="job-photo-picker">
              {partPhotos.map((p, idx) => (
                <div className="job-photo-thumb" key={p.id}>
                  <span className="job-photo-num">{idx + 1}</span>
                  <img src={p.photo_data} alt="" onClick={() => setLightboxSrc(p.photo_data)} />
                  <div className="job-photo-thumb-actions">
                    <button type="button" disabled={partPhotosBusy || idx === 0} onClick={() => handleMovePartPhoto(p.id, -1)}>◀</button>
                    <button type="button" disabled={partPhotosBusy} onClick={() => handleDeletePartPhoto(p.id)}>✕</button>
                    <button type="button" disabled={partPhotosBusy || idx === partPhotos.length - 1} onClick={() => handleMovePartPhoto(p.id, 1)}>▶</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="job-photo-add-row">
            <label className="btn job-photo-add-btn">
              📷 ถ่ายรูป
              <input type="file" accept="image/*" capture="environment" multiple hidden disabled={partPhotosBusy} onChange={handleAddPartPhotos} />
            </label>
            <label className="btn job-photo-add-btn">
              🖼️ เลือกรูป
              <input type="file" accept="image/*" multiple hidden disabled={partPhotosBusy} onChange={handleAddPartPhotos} />
            </label>
            {partPhotosBusy && <span style={{ fontSize: 13, color: '#6b7280' }}>กำลังบันทึก...</span>}
          </div>
        </div>
      )}

      <div className="dash-panel">
        <div className="dash-panel-title">ประวัติสถานะ</div>
        <ul className="job-history-list">
          {(job.history || []).map((h, i) => (
            <li key={i}>
              <span className={`status-badge ${jobStatusDef(h.status).badge}`}>{jobStatusDef(h.status).label}</span>
              <span className="job-history-time">{formatDbDateTime(h.changed_at)}</span>
              <span className="job-history-by">{h.full_name || h.username || '-'}</span>
            </li>
          ))}
        </ul>
      </div>

      {showSchedule && (
        <div className="modal-backdrop" onClick={() => setShowSchedule(false)}>
          <div className="modal-card" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">นัดวันมาทำ</h3>
            <div className="modal-form">
              <label>วันที่นัด</label>
              <input type="date" value={scheduleDate} min={todayStr()} onChange={(e) => setScheduleDate(e.target.value)} />
              {error && <p className="error-text">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-primary" disabled={busy} onClick={handleSchedule}>
                  {busy ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button type="button" onClick={() => setShowSchedule(false)} disabled={busy}>ยกเลิก</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeposit && (
        <div className="modal-backdrop" onClick={() => setShowDeposit(false)}>
          <div className="modal-card" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">รับมัดจำ</h3>
            <p style={{ color: '#6b7280', fontSize: 13, marginTop: -4 }}>
              ลูกค้าวางมัดจำแล้วขับรถกลับไปก่อน (รออะไหล่) — รถจะออกจากคิววันนี้ ไปรออยู่หน้ามัดจำ
              พอนัดวันได้แล้วค่อยกด "สร้างคิว" จากหน้านั้น
            </p>
            <div className="modal-form">
              <label>ยอดมัดจำ (บาท)</label>
              <input
                type="number" min="0" step="0.01" autoFocus
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
              />
              <label>วันที่มัดจำ</label>
              <input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
              {error && <p className="error-text">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-primary" disabled={busy} onClick={handleDeposit}>
                  {busy ? 'กำลังบันทึก...' : 'บันทึกมัดจำ'}
                </button>
                <button type="button" onClick={() => setShowDeposit(false)} disabled={busy}>ยกเลิก</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDecline && (
        <DeclineReasonModal
          quotation={{ quotation_no: job.quotation_no || job.job_no, customer_name: job.customer_name }}
          loading={busy}
          onConfirm={handleDeclineConfirm}
          onCancel={() => setShowDecline(false)}
        />
      )}

      {showPrintModal && job.quotation_id && (
        <QuotationPrintModal
          quotation={{ id: job.quotation_id }}
          onClose={() => { setShowPrintModal(false); load({ silent: true }); }}
        />
      )}

      {/* ยังไม่มีใบเสนอราคาจริง — ประกอบข้อมูลแสดงผล/พิมพ์จากงาน+ร่าง (quote_draft)
          ตรงๆ ไม่ fetch จาก /quotations/:id (ยังไม่มีให้ fetch) ลายเซ็นบันทึกกลับไป
          ที่ร่างบนงานนี้แทน ไม่ใช่ใบเสนอราคา (skipFetch/markPrintedUrl=null เพราะ
          ยังไม่ใช่เอกสารจริงที่ต้องติดตามว่า "พิมพ์แล้ว") */}
      {showPrintModal && !job.quotation_id && job.quote_draft?.items?.length > 0 && (
        <QuotationPrintModal
          quotation={{
            id: null,
            quotation_no: null,
            quotation_date: todayStr(),
            queue_no: job.queue_no,
            symptom: job.symptom,
            customer_name: job.customer_name,
            phone: job.phone,
            brand: job.brand,
            model: job.model,
            color: job.color,
            license_plate: job.license_plate,
            mileage: job.mileage_in,
            items: job.quote_draft.items,
            remark: job.quote_draft.remark,
            customer_signature: job.quote_draft.customer_signature,
            staff_signature: job.quote_draft.staff_signature,
            staff_name: job.quote_draft.staff_name,
            deposit_amount: job.quote_draft.deposit_amount,
            deposit_date: job.quote_draft.deposit_date,
          }}
          skipFetch
          signatureUrl={`/jobs/${id}/quote-draft/signature`}
          staffSignatureUrl={`/jobs/${id}/quote-draft/staff-signature`}
          markPrintedUrl={null}
          onClose={() => { setShowPrintModal(false); load({ silent: true }); }}
        />
      )}

      {showWorksheetModal && (
        <RepairWorksheetPrintModal
          data={{
            job_no: job.job_no,
            queue_no: job.queue_no,
            date: todayStr(),
            symptom: job.symptom,
            customer_name: job.customer_name,
            phone: job.phone,
            vehicle: { brand: job.brand, model: job.model, color: job.color, license_plate: job.license_plate, mileage: job.mileage_in },
            items: activePartsList.map((p) => ({ product_name: p.part_name, quantity: p.quantity })),
          }}
          onClose={() => setShowWorksheetModal(false)}
        />
      )}

      {lightboxSrc && <PhotoLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      {showDeleteConfirm && (
        <div className="modal-backdrop" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-card" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">ลบงานนี้?</h3>
            <p>ยืนยันลบงาน {job.job_no} — คิว {job.queue_no || '-'} ของ {job.customer_name || 'ลูกค้า'} ข้อมูลนี้จะหายถาวร กู้คืนไม่ได้</p>
            {error && <p className="error-text">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-danger" disabled={busy} onClick={handleDeleteJob}>
                {busy ? 'กำลังลบ...' : 'ยืนยันลบ'}
              </button>
              <button type="button" onClick={() => setShowDeleteConfirm(false)} disabled={busy}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
