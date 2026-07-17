import React, { useEffect, useRef, useState } from "react";
import client from "../api/client";
import ReceiptInfoSection from "./ReceiptInfoSection";
import CustomerSection from "./CustomerSection";
import VehicleSection from "./VehicleSection";
import ItemTable from "./ItemTable";
import ReceiptPrintTemplate from "./ReceiptPrintTemplate";
import FormModalShell from "./FormModalShell";
import { todayStr, formatMoney } from "../utils/format";

export default function ReceiptFormModal({ onClose, onSuccess, receiptId }) {
  const [receiptNo, setReceiptNo] = useState('');
  const [receiptDate, setReceiptDate] = useState(todayStr());
  const [pic, setPic] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [customerMode, setCustomerMode] = useState('new');
  const [newCustomer, setNewCustomer] = useState({ customer_name: '', phone: '' });
  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState('');
  const [vehicleMode, setVehicleMode] = useState('new');
  const [newVehicle, setNewVehicle] = useState({ brand: '', model: '', color: '', license_plate: '' });
  const [mileage, setMileage] = useState('0');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState([{
    service_item_id: null,
    product_name_snapshot: '',
    category: '',
    warranty_name: '',
    warranty_year: 0,
    warranty_month: 0,
    warranty_km: 0,
    qty: 1,
    price: '',
    amount: 0,
  }]);
  const [itemSuggestions, setItemSuggestions] = useState({});
  const [suggestionIndex, setSuggestionIndex] = useState({});
  const itemNameRefs = useRef([]);
  const itemQtyRefs = useRef([]);
  const itemPriceRefs = useRef([]);
  const itemSearchTimers = useRef({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [toast, setToast] = useState(null);
  // Live preview renders full-size on narrow screens (no room for a side-by-side
  // layout like desktop) — keep it collapsed by default there so it doesn't bury
  // the actual form fields; desktop is unaffected (toggle is CSS-hidden there).
  const [showMobilePreview, setShowMobilePreview] = useState(false);

  useEffect(() => {
    fetchReceiptNo();
  }, []);

  const resetForm = () => {
    setReceiptNo('');
    setReceiptDate(todayStr());
    setPic('');
    setCustomerQuery('');
    setCustomer(null);
    setCustomerMode('new');
    setNewCustomer({ customer_name: '', phone: '' });
    setVehicles([]);
    setVehicleId('');
    setVehicleMode('new');
    setNewVehicle({ brand: '', model: '', color: '', license_plate: '' });
    setMileage('0');
    setRemark('');
    setItems([{
      service_item_id: null,
      product_name_snapshot: '',
      category: '',
      warranty_name: '',
      warranty_year: 0,
      warranty_month: 0,
      warranty_km: 0,
      qty: 1,
      price: '',
      amount: 0,
    }]);
    setItemSuggestions({});
    setSuggestionIndex({});
    setFieldErrors({});
    setError('');
    setToast(null);
    fetchReceiptNo();
  };

  const loadReceipt = async (id) => {
    setLoading(true);
    setError('');
    setFieldErrors({});

    try {
      const response = await client.get(`/receipts/${id}`);
      const data = response.data.data;
      const receiptData = data || {};

      setReceiptNo(receiptData.receipt_no || '');
      setReceiptDate(receiptData.receipt_date || todayStr());
      setPic(receiptData.pic || '');
      setCustomer({ id: receiptData.customer_id, customer_name: receiptData.customer_name, customer_code: receiptData.customer_code, phone: receiptData.phone || '' });
      setCustomerMode('existing');
      setCustomerQuery(receiptData.customer_name || '');
      setNewCustomer({ customer_name: '', phone: '' });
      setMileage(receiptData.mileage?.toString() || '0');
      setRemark(receiptData.remark || '');
      setVehicleMode('existing');
      setVehicleId(receiptData.vehicle_id?.toString() || '');
      setNewVehicle({ brand: '', model: '', color: '', license_plate: '' });
      setItems((receiptData.items || [{
        service_item_id: null,
        product_name_snapshot: '',
        category: '',
        warranty_name: '',
        warranty_year: 0,
        warranty_month: 0,
        warranty_km: 0,
        qty: 1,
        price: '',
        amount: 0,
      }]).map((item) => ({
        service_item_id: item.service_item_id || null,
        product_name_snapshot: item.product_name_snapshot || item.service_item_name || '',
        category: item.category || '',
        warranty_name: item.warranty_name || '',
        warranty_year: item.warranty_year || 0,
        warranty_month: item.warranty_month || 0,
        warranty_km: item.warranty_km || 0,
        qty: item.qty ?? 1,
        price: item.price ?? '',
        amount: item.amount ?? 0,
      })));
      setItemSuggestions({});
      setSuggestionIndex({});
      setFieldErrors({});
      setError('');
    } catch (err) {
      console.error('Error loading receipt for edit:', err);
      setError('โหลดข้อมูลใบเสร็จไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (receiptId) {
      loadReceipt(receiptId);
    } else {
      resetForm();
    }
  }, [receiptId]);

  useEffect(() => () => {
    Object.values(itemSearchTimers.current).forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (customer?.id) {
      loadVehicles(customer.id, vehicleId);
    } else {
      setVehicles([]);
      setVehicleId('');
      setVehicleMode('new');
    }
  }, [customer]);

  const fetchReceiptNo = async () => {
    try {
      const response = await client.get('/receipts/next-no');
      setReceiptNo(response.data.receipt_no || '');
    } catch (err) {
      console.error('Error fetching receipt number:', err);
    }
  };

  const searchCustomers = async (query) => {
    if (!query) {
      setCustomerResults([]);
      return;
    }
    try {
      const response = await client.get('/receipts/customers', { params: { search: query } });
      setCustomerResults(response.data.data || []);
    } catch (err) {
      console.error('Error searching customers:', err);
    }
  };

  const handleCustomerSelect = (selected) => {
    setCustomer(selected);
    setCustomerMode('existing');
    setCustomerQuery(selected.customer_name);
    setCustomerResults([]);
    setNewCustomer({ customer_name: '', phone: '' });
    setError('');
  };

  const handleCustomerQueryChange = (value) => {
    setCustomerMode('existing');
    setCustomerQuery(value);
    setCustomer(null);
    setCustomerResults([]);
    if (value) {
      searchCustomers(value);
    }
  };

  const handleNewCustomerInput = (field, value) => {
    setCustomerMode('new');
    setCustomer(null);
    setCustomerQuery('');
    setCustomerResults([]);
    setNewCustomer((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: null }));
  };

  const handleCustomerModeChange = (mode) => {
    if (mode === 'existing') {
      setCustomerMode('existing');
      setNewCustomer({ customer_name: '', phone: '' });
      setCustomerQuery('');
      setCustomerResults([]);
    } else {
      setCustomerMode('new');
      setCustomer(null);
      setCustomerQuery('');
      setCustomerResults([]);
    }
  };

  const handleVehicleModeChange = (mode) => {
    setVehicleMode(mode);
  };

  const handleVehicleSelect = (value) => {
    if (value === 'new') {
      setVehicleMode('new');
      setVehicleId('');
    } else {
      setVehicleMode('existing');
      setVehicleId(value);
      // บิลใหม่ (ยังไม่ได้แก้ไขบิลเดิม) → เอาเลขไมล์ล่าสุดของรถคันนี้มาตั้งเป็นค่า
      // เริ่มต้นให้เลย ไม่งั้นจะค้างที่ 0 ทั้งที่แก้เลขไมล์รถไว้แล้วในหน้ารถลูกค้า —
      // บิลที่แก้ไขอยู่มีเลขไมล์ของตัวเองอยู่แล้ว จึงไม่แตะตรงนี้ กันค่าที่โหลดมาถูกทับ
      if (!receiptId) {
        const selected = vehicles.find((v) => v.id.toString() === value);
        if (selected) setMileage(String(selected.mileage ?? 0));
      }
    }
  };

  const handleNewVehicleFieldChange = (field, value) => {
    setNewVehicle((prev) => ({ ...prev, [field]: value }));
  };

  const handleMileageChange = (value) => {
    setMileage(value);
  };

  const loadVehicles = async (customerId, selectedVehicleId = '') => {
    try {
      const response = await client.get(`/receipts/customers/${customerId}/vehicles`);
      const vehicleList = response.data.data || [];
      setVehicles(vehicleList);
      if (vehicleList.length > 0) {
        const selected = selectedVehicleId
          ? vehicleList.find((v) => v.id.toString() === selectedVehicleId)
          : vehicleList[0];
        if (selected) {
          setVehicleMode('existing');
          setVehicleId(selected.id.toString());
        } else {
          setVehicleMode('existing');
          setVehicleId(vehicleList[0].id.toString());
        }
        // เหมือน handleVehicleSelect ด้านล่าง — ตั้งเลขไมล์เริ่มต้นจากรถที่เลือก
        // เฉพาะตอนสร้างบิลใหม่เท่านั้น
        if (!receiptId) {
          setMileage(String((selected || vehicleList[0]).mileage ?? 0));
        }
      } else {
        setVehicleMode('new');
        setVehicleId('');
      }
    } catch (err) {
      console.error('Error loading vehicles:', err);
      setVehicles([]);
      setVehicleMode('new');
      setVehicleId('');
    }
  };

  const searchServiceItems = async (query, index) => {
    if (!query) {
      setItemSuggestions((prev) => ({ ...prev, [index]: null }));
      return;
    }
    try {
      const response = await client.get('/service-items', { params: { search: query } });
      setItemSuggestions((prev) => ({ ...prev, [index]: response.data.data || [] }));
      setSuggestionIndex((prev) => ({ ...prev, [index]: 0 }));
    } catch (err) {
      console.error('Error searching service items:', err);
    }
  };

  const handleItemNameChange = (query, index) => {
    if (itemSearchTimers.current[index]) {
      clearTimeout(itemSearchTimers.current[index]);
    }
    if (!query) {
      setItemSuggestions((prev) => ({ ...prev, [index]: null }));
      return;
    }
    itemSearchTimers.current[index] = setTimeout(() => {
      searchServiceItems(query, index);
    }, 300);
  };

  // Closes a row's dropdown once focus leaves it without a selection being
  // made — see the delay in ItemSearch.jsx's onBlur wiring for why a
  // selection still wins the race against this.
  const handleItemBlur = (index) => {
    setItemSuggestions((prev) => ({ ...prev, [index]: null }));
  };

  const blankItem = () => ({
    service_item_id: null,
    product_name_snapshot: '',
    category: '',
    warranty_name: '',
    warranty_year: 0,
    warranty_month: 0,
    warranty_km: 0,
    qty: 1,
    price: '',
    amount: 0,
  });

  // insertAfterIndex lets each row's "+ แทรกบรรทัด" button drop a new blank
  // line exactly where it's needed, instead of always appending to the end
  // and having to move it up into place by hand.
  const handleAddItem = (insertAfterIndex) => {
    setItems((prev) => {
      if (insertAfterIndex == null) return [...prev, blankItem()];
      const next = [...prev];
      next.splice(insertAfterIndex + 1, 0, blankItem());
      return next;
    });
  };

  const handleRemoveItem = (index) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleItemChange = (index, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: field === 'qty' ? Number(value) : value,
      };
      if (field === 'qty' || field === 'price') {
        const qty = Number(next[index].qty || 0);
        const price = Number(next[index].price || 0);
        next[index].amount = qty * price;
      }
      return next;
    });
    setFieldErrors((prev) => ({ ...prev, items: null }));
  };

  // A "set" (e.g. ชุดโปรช่วงล่าง) carries one warranty for the whole group,
  // same as a regular item — picking it expands into one row per
  // component instead of a single line. Price is intentionally left blank
  // on every row; staff fill it in manually per line on the receipt. The
  // set's warranty is copied onto every expanded row (not just the first)
  // so whichever row's name matches a printed warranty slot (แร็ค/ลูกหมาก)
  // still carries it through to the printed receipt.
  const expandSetIntoItems = async (index, item) => {
    try {
      const response = await client.get(`/service-items/${item.id}/components`);
      const components = response.data.data || [];
      const rows = (components.length > 0 ? components : [{ component_name: item.product_name, default_qty: 1 }]).map((comp) => {
        const qty = Number(comp.default_qty) > 0 ? Number(comp.default_qty) : 1;
        return {
          service_item_id: null,
          product_name_snapshot: comp.component_name,
          category: item.category,
          warranty_name: item.warranty_name || '',
          warranty_year: item.warranty_year || 0,
          warranty_month: item.warranty_month || 0,
          warranty_km: item.warranty_km || 0,
          qty,
          price: '',
          amount: 0,
        };
      });
      setItems((prev) => {
        const next = [...prev];
        next.splice(index, 1, ...rows);
        return next;
      });
    } catch (err) {
      console.error('Error expanding set into items:', err);
    }
    setItemSuggestions((prev) => ({ ...prev, [index]: null }));
    setFieldErrors((prev) => ({ ...prev, items: null }));
  };

  const handleSelectServiceItem = (index, item) => {
    if (item.is_set) {
      expandSetIntoItems(index, item);
      return;
    }
    setItems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        service_item_id: item.id,
        product_name_snapshot: item.product_name,
        category: item.category,
        warranty_name: item.warranty_name || '',
        warranty_year: item.warranty_year || 0,
        warranty_month: item.warranty_month || 0,
        warranty_km: item.warranty_km || 0,
        qty: item.default_qty ? Number(item.default_qty) : 1,
        price: item.price || next[index].price || '',
        amount: (item.default_qty ? Number(item.default_qty) : Number(next[index].qty || 1)) * Number(item.price || next[index].price || 0),
      };
      return next;
    });
    setItemSuggestions((prev) => ({ ...prev, [index]: null }));
    setFieldErrors((prev) => ({ ...prev, items: null }));
    setTimeout(() => {
      const qtyRef = itemQtyRefs.current[index];
      if (qtyRef && qtyRef.focus) qtyRef.focus();
    }, 0);
  };

  const handleItemKeyDown = (e, index) => {
    const suggestions = itemSuggestions[index] || [];
    const currentIdx = Number.isInteger(suggestionIndex[index]) ? suggestionIndex[index] : 0;
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIdx = Math.min(currentIdx + 1, suggestions.length - 1);
        setSuggestionIndex((prev) => ({ ...prev, [index]: nextIdx }));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const nextIdx = Math.max(currentIdx - 1, 0);
        setSuggestionIndex((prev) => ({ ...prev, [index]: nextIdx }));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const sel = suggestions[currentIdx];
        if (sel) handleSelectServiceItem(index, sel);
      } else if (e.key === 'Tab') {
        const sel = suggestions[currentIdx];
        if (sel) {
          handleSelectServiceItem(index, sel);
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const qtyRef = itemQtyRefs.current[index];
      if (qtyRef && qtyRef.focus) qtyRef.focus();
    }
  };

  const calculateTotal = () => {
    return items.reduce((sum, item) => {
      const qty = Number(item.qty || 0);
      const price = Number(item.price || 0);
      return sum + qty * price;
    }, 0);
  };

  const serviceItemCount = items.filter((item) => item.product_name_snapshot?.toString().trim()).length;
  const warrantyHighlights = items.filter((item) => item.warranty_name || item.warranty_year || item.warranty_km);

  const previewVehicle = vehicleMode === 'existing'
    ? vehicles.find((v) => v.id.toString() === vehicleId) || {}
    : newVehicle;

  const previewData = {
    receipt_no: receiptNo,
    receipt_date: receiptDate,
    pic,
    customer: customerMode === 'existing' ? customer || {} : { ...newCustomer },
    // previewVehicle (from the vehicles list / newVehicle) never carries the
    // document's own mileage reading — that's tracked separately as its own
    // form field, not part of the vehicle record — so it must be merged in
    // explicitly or the live preview shows blank even after typing it in.
    vehicle: { ...previewVehicle, mileage },
    items,
    remark,
    total_amount: calculateTotal(),
    discount: 0,
  };

  const showToast = (type, message) => {
    setToast({ type, message });
  };

  const resetToast = () => setToast(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    if (customerMode === 'existing' && !customer?.id) {
      setError('กรุณาเลือกลูกค้าก่อน');
      return;
    }

    if (customerMode === 'new' && !newCustomer.customer_name.trim()) {
      setError('กรุณากรอกชื่อลูกค้าใหม่');
      setFieldErrors((prev) => ({ ...prev, customer_name: 'ต้องกรอกชื่อลูกค้า' }));
      return;
    }

    if (vehicleMode === 'existing' && !vehicleId) {
      setError('กรุณาเลือกรถของลูกค้า');
      setFieldErrors((prev) => ({ ...prev, vehicle_id: 'เลือกรถก่อน' }));
      return;
    }

    if (vehicleMode === 'new' && (!newVehicle.brand.trim() || !newVehicle.model.trim())) {
      setError('กรุณากรอกข้อมูลรถใหม่ให้ครบถ้วน');
      setFieldErrors((prev) => ({ ...prev, vehicle: 'กรอกยี่ห้อและรุ่น' }));
      return;
    }

    // Price is intentionally NOT required — a set-expanded component row
    // (e.g. from ชุดโปรช่วงล่าง) is often left at its default blank price
    // since it's already covered by the set's combined price, and should
    // still be saved (as ฿0), not silently dropped for lacking a price.
    const validItems = items.filter((item) => {
      const label = item.product_name_snapshot?.toString().trim();
      const qty = Number(item.qty || 0);
      return (label || item.service_item_id) && qty > 0;
    });

    if (validItems.length === 0) {
      setError('กรุณาเพิ่มรายการสินค้า/บริการอย่างน้อยหนึ่งรายการ');
      setFieldErrors((prev) => ({ ...prev, items: 'เพิ่มรายการหนึ่งรายการขึ้นไป' }));
      return;
    }

    const normalizedItems = validItems.map((item) => ({
      service_item_id: item.service_item_id,
      product_name_snapshot: item.product_name_snapshot,
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      amount: Number(item.qty || 0) * Number(item.price || 0),
      warranty_name: item.warranty_name,
      warranty_year: item.warranty_year,
      warranty_month: item.warranty_month,
      warranty_km: item.warranty_km,
    }));

    setLoading(true);
    try {
      const payload = {
        customer_id: customerMode === 'existing' ? customer?.id : null,
        newCustomer: customerMode === 'new' ? {
          customer_name: newCustomer.customer_name.trim(),
          phone: newCustomer.phone.trim() || null,
        } : null,
        vehicle_id: vehicleMode === 'existing' ? vehicleId : null,
        receipt_date: receiptDate,
        mileage: Number(mileage || 0),
        remark: remark.trim(),
        items: normalizedItems,
        newVehicle: vehicleMode === 'new' ? {
          brand: newVehicle.brand.trim(),
          model: newVehicle.model.trim(),
          color: newVehicle.color.trim() || null,
          license_plate: newVehicle.license_plate.trim() || null,
        } : null,
      };

      if (receiptId) {
        await client.put(`/receipts/${receiptId}`, payload);
        showToast('success', 'แก้ไขบิลสำเร็จ');
      } else {
        await client.post('/receipts', payload);
        showToast('success', 'บันทึกบิลสำเร็จ');
      }
      onSuccess();
    } catch (err) {
      const resp = err.response?.data;
      if (resp && Array.isArray(resp.errors)) {
        const map = {};
        resp.errors.forEach((e) => { map[e.field] = e.message; });
        setFieldErrors(map);
        setError('กรุณาตรวจสอบข้อมูลในฟอร์ม');
      } else {
        setError(resp?.error || 'เกิดข้อผิดพลาดในการบันทึกบิล');
      }
      showToast('error', resp?.error || 'เกิดข้อผิดพลาดในการบันทึกบิล');
      console.error('Receipt save error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormModalShell
      title={receiptId ? 'แก้ไขใบเสร็จรับเงิน / ใบรับประกัน' : 'สร้างใบเสร็จรับเงิน / ใบรับประกัน'}
      subtitle="กรอกข้อมูลลูกค้า รถ และรายการสินค้า/บริการอย่างรวดเร็ว"
      onClose={onClose}
      error={error}
      toast={toast}
      onToastDone={resetToast}
    >
      {({ requestClose }) => (
        <div className="receipt-content">
          <div className="receipt-form-pane">
            <form onSubmit={handleSubmit} className="modal-form receipt-modal-form">
              <ReceiptInfoSection
                receiptNo={receiptNo}
                receiptDate={receiptDate}
                pic={pic}
                onDateChange={setReceiptDate}
                onPicChange={setPic}
              />

              <div className="receipt-section-grid">
                <CustomerSection
                  customerMode={customerMode}
                  customerQuery={customerQuery}
                  customerResults={customerResults}
                  customer={customer}
                  newCustomer={newCustomer}
                  fieldErrors={fieldErrors}
                  onCustomerQueryChange={handleCustomerQueryChange}
                  onNewCustomerInput={handleNewCustomerInput}
                  onCustomerSelect={handleCustomerSelect}
                  onCustomerModeChange={handleCustomerModeChange}
                />

                <VehicleSection
                  vehicles={vehicles}
                  vehicleMode={vehicleMode}
                  vehicleId={vehicleId}
                  newVehicle={newVehicle}
                  mileage={mileage}
                  fieldErrors={fieldErrors}
                  onVehicleSelect={handleVehicleSelect}
                  onVehicleModeChange={handleVehicleModeChange}
                  onNewVehicleFieldChange={handleNewVehicleFieldChange}
                  onMileageChange={handleMileageChange}
                />
              </div>

              <ItemTable
                items={items}
                itemSuggestions={itemSuggestions}
                suggestionIndex={suggestionIndex}
                handleItemChange={handleItemChange}
                handleItemKeyDown={handleItemKeyDown}
                handleSelectServiceItem={handleSelectServiceItem}
                handleAddItem={handleAddItem}
                handleRemoveItem={handleRemoveItem}
                onItemNameChange={handleItemNameChange}
                onItemBlur={handleItemBlur}
                itemNameRefs={itemNameRefs}
                itemQtyRefs={itemQtyRefs}
                itemPriceRefs={itemPriceRefs}
                formatMoney={formatMoney}
                fieldErrors={fieldErrors}
                showCodeColumn={false}
                compactRows={true}
              />

              {warrantyHighlights.length > 0 && (
                <div className="info-card">
                  <div className="info-card-title">รับประกันที่ผูกกับรายการ</div>
                  <div className="receipt-warranty-stack">
                    {warrantyHighlights.map((item, idx) => (
                      <div className="receipt-warranty-item" key={`${item.product_name_snapshot || 'item'}-${idx}`}>
                        <div className="receipt-warranty-name">{item.product_name_snapshot || `รายการ ${idx + 1}`}</div>
                        <div className="receipt-warranty-meta">
                          {item.warranty_name ? `${item.warranty_name} • ` : ''}
                          {item.warranty_year ? `${item.warranty_year} ปี • ` : ''}
                          {item.warranty_km ? `${Number(item.warranty_km).toLocaleString()} กม` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="notes-summary-grid">
                <div className="info-card note-card">
                  <div className="info-card-title">หมายเหตุ</div>
                  <div className="form-group">
                    <textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={5} placeholder="เช่น บริการพิเศษ, ส่งมอบวันที่..." />
                  </div>
                </div>
                <div className="info-card total-summary-card">
                  <div className="info-card-title">สรุปบิล</div>
                  <div className="summary-grid summary-grid-card">
                    <div>
                      <div className="summary-label">รายการ</div>
                      <div className="summary-value">{serviceItemCount}</div>
                    </div>
                    <div>
                      <div className="summary-label">ลูกค้า</div>
                      <div className="summary-value">{customerMode === 'existing' ? customer?.customer_name || '-' : newCustomer.customer_name || '-'}</div>
                    </div>
                    <div>
                      <div className="summary-label">รถ</div>
                      <div className="summary-value">{vehicleMode === 'existing' ? vehicles.find((v) => v.id.toString() === vehicleId)?.brand || '-' : newVehicle.brand || '-'}</div>
                    </div>
                    <div>
                      <div className="summary-label">รวมทั้งสิ้น</div>
                      <div className="summary-value">฿{formatMoney(calculateTotal())}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-footer no-print">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'กำลังบันทึก...' : 'บันทึกบิล'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={requestClose}>
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>

          <button
            type="button"
            className="mobile-preview-toggle"
            onClick={() => setShowMobilePreview((v) => !v)}
          >
            {showMobilePreview ? 'ซ่อนตัวอย่างใบเสร็จ ▲' : '👁 ดูตัวอย่างใบเสร็จ ▼'}
          </button>

          <div className={`receipt-preview-pane ${showMobilePreview ? '' : 'preview-collapsed-mobile'}`}>
            <div className="receipt-preview-header">
              <div>
                <strong>Live Preview</strong>
                <p className="preview-subtitle">ดูตัวอย่างใบเสร็จทันที</p>
              </div>
            </div>
            <div className="receipt-preview-frame">
              <ReceiptPrintTemplate data={previewData} />
            </div>
          </div>
        </div>
      )}
    </FormModalShell>
  );
}
