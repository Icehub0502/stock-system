import React, { useEffect, useRef, useState } from "react";
import client from "../api/client";
import CustomerSection from "./CustomerSection";
import VehicleSection from "./VehicleSection";
import ItemTable from "./ItemTable";
import QuotationPrintTemplate from "./QuotationPrintTemplate";
import FormModalShell from "./FormModalShell";
import { todayStr, formatMoney } from "../utils/format";

const defaultItem = {
  product_id: null,
  product_name: '',
  category: '',
  warranty_name: '',
  warranty_year: 0,
  warranty_month: 0,
  warranty_km: 0,
  quantity: 1,
  unit_price: '',
  amount: 0,
};

export default function QuotationFormModal({ quotation, onClose, onSuccess }) {
  const [quotationNo, setQuotationNo] = useState('');
  const [quotationDate, setQuotationDate] = useState(todayStr());
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
  const [queueNo, setQueueNo] = useState('');
  const [symptom, setSymptom] = useState('');
  const [items, setItems] = useState([{ ...defaultItem }]);
  const [productSuggestions, setProductSuggestions] = useState({});
  const [suggestionIndex, setSuggestionIndex] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [toast, setToast] = useState(null);
  // Live preview renders full-size on narrow screens (no room for a side-by-side
  // layout like desktop) — keep it collapsed by default there so it doesn't bury
  // the actual form fields; desktop is unaffected (toggle is CSS-hidden there).
  const [showMobilePreview, setShowMobilePreview] = useState(false);
  const itemNameRefs = useRef([]);
  const itemQtyRefs = useRef([]);
  const itemPriceRefs = useRef([]);
  const productSearchTimers = useRef({});

  const fetchQuotationNo = async () => {
    try {
      const response = await client.get('/quotations/next-no');
      setQuotationNo(response.data.quotation_no || '');
    } catch (err) {
      console.error('Error fetching quotation number:', err);
    }
  };

  const resetForm = () => {
    setQuotationDate(todayStr());
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
    setQueueNo('');
    setSymptom('');
    setItems([{ ...defaultItem }]);
    setProductSuggestions({});
    setSuggestionIndex({});
    setFieldErrors({});
    setError('');
    setToast(null);
    fetchQuotationNo();
  };

  const loadQuotation = async (id) => {
    setLoading(true);
    setError('');
    setFieldErrors({});
    try {
      const response = await client.get(`/quotations/${id}`);
      const detail = response.data.data || {};

      setQuotationNo(detail.quotation_no || '');
      setQuotationDate(detail.quotation_date || todayStr());
      setCustomer({ id: detail.customer_id, customer_name: detail.customer_name, customer_code: detail.customer_code, phone: detail.phone || '' });
      setCustomerMode('existing');
      setCustomerQuery(detail.customer_name || '');
      setNewCustomer({ customer_name: '', phone: '' });
      setMileage(detail.mileage?.toString() || '0');
      setRemark(detail.remark || '');
      setQueueNo(detail.queue_no || '');
      setSymptom(detail.symptom || '');
      setVehicleMode(detail.vehicle_id ? 'existing' : 'new');
      setVehicleId(detail.vehicle_id?.toString() || '');
      setNewVehicle({ brand: '', model: '', color: '', license_plate: '' });
      setItems(
        (detail.items && detail.items.length > 0 ? detail.items : [{ ...defaultItem }]).map((item) => ({
          product_id: item.product_id || null,
          product_name: item.product_name || '',
          category: item.category || '',
          warranty_name: item.warranty_name || '',
          warranty_year: item.warranty_year || 0,
          warranty_month: item.warranty_month || 0,
          warranty_km: item.warranty_km || 0,
          quantity: item.quantity ?? 1,
          unit_price: item.unit_price ?? '',
          amount: Number(item.quantity ?? 0) * Number(item.unit_price ?? 0),
        }))
      );
      setProductSuggestions({});
      setSuggestionIndex({});
      setFieldErrors({});
      setError('');
    } catch (err) {
      console.error('Error loading quotation for edit:', err);
      setError('โหลดข้อมูลใบเสนอราคาไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (quotation?.id) {
      loadQuotation(quotation.id);
    } else {
      resetForm();
    }
  }, [quotation]);

  useEffect(() => () => {
    Object.values(productSearchTimers.current).forEach(clearTimeout);
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

  const loadVehicles = async (customerId, selectedVehicleId = '') => {
    try {
      const response = await client.get(`/receipts/customers/${customerId}/vehicles`);
      const vehicleList = response.data.data || [];
      setVehicles(vehicleList);
      if (vehicleList.length > 0) {
        const selected = selectedVehicleId
          ? vehicleList.find((v) => v.id.toString() === selectedVehicleId)
          : vehicleList[0];
        setVehicleMode('existing');
        setVehicleId((selected || vehicleList[0]).id.toString());
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

  const searchCustomer = async (query) => {
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

  // Same catalog + search source as the receipt form (`/service-items`) so
  // staff see the same item list when quoting as when billing — `/product-costs`
  // queries a separate internal cost-tracking table that isn't kept in sync
  // with what's actually sold, which is why results there looked "wrong".
  const searchProduct = async (query, index) => {
    if (!query) {
      setProductSuggestions((prev) => ({ ...prev, [index]: null }));
      return;
    }
    try {
      const response = await client.get('/service-items', { params: { search: query } });
      setProductSuggestions((prev) => ({ ...prev, [index]: response.data.data || [] }));
      setSuggestionIndex((prev) => ({ ...prev, [index]: 0 }));
    } catch (err) {
      console.error('Error searching products:', err);
    }
  };

  const handleCustomerQueryChange = (value) => {
    setCustomerMode('existing');
    setCustomerQuery(value);
    setCustomer(null);
    setCustomerResults([]);
    if (value) searchCustomer(value);
  };

  const handleNewCustomerInput = (field, value) => {
    setCustomerMode('new');
    setCustomer(null);
    setCustomerQuery('');
    setCustomerResults([]);
    setNewCustomer((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: null }));
  };

  const handleCustomerSelect = (selected) => {
    setCustomer(selected);
    setCustomerMode('existing');
    setCustomerQuery(selected.customer_name);
    setCustomerResults([]);
    setNewCustomer({ customer_name: '', phone: '' });
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

  const showToast = (type, message) => setToast({ type, message });
  const resetToast = () => setToast(null);

  const handleVehicleSelect = (value) => {
    if (value === 'new') {
      setVehicleMode('new');
      setVehicleId('');
    } else {
      setVehicleMode('existing');
      setVehicleId(value);
    }
  };

  const handleVehicleModeChange = (mode) => setVehicleMode(mode);
  const handleNewVehicleFieldChange = (field, value) => setNewVehicle((prev) => ({ ...prev, [field]: value }));
  const handleMileageChange = (value) => setMileage(value);

  const handleItemChange = (index, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: field === 'quantity' ? Number(value) : value,
      };
      const qty = Number(next[index].quantity || 0);
      const price = Number(next[index].unit_price || 0);
      next[index].amount = qty * price;
      return next;
    });
    setFieldErrors((prev) => ({ ...prev, items: null }));
  };

  const handleItemKeyDown = (e, index) => {
    const suggestions = productSuggestions[index] || [];
    const current = Number.isInteger(suggestionIndex[index]) ? suggestionIndex[index] : 0;
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex((prev) => ({ ...prev, [index]: Math.min(current + 1, suggestions.length - 1) }));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex((prev) => ({ ...prev, [index]: Math.max(current - 1, 0) }));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = suggestions[current];
        if (selected) selectProductSuggestion(index, selected);
      } else if (e.key === 'Tab') {
        const selected = suggestions[current];
        if (selected) selectProductSuggestion(index, selected);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const qtyRef = itemQtyRefs.current[index];
      if (qtyRef && qtyRef.focus) qtyRef.focus();
    }
  };

  const handleItemNameChange = (query, index) => {
    if (productSearchTimers.current[index]) {
      clearTimeout(productSearchTimers.current[index]);
    }
    if (!query) {
      setProductSuggestions((prev) => ({ ...prev, [index]: null }));
      return;
    }
    productSearchTimers.current[index] = setTimeout(() => {
      searchProduct(query, index);
    }, 300);
  };

  // Closes a row's dropdown once focus leaves it without a selection being
  // made — see the delay in ItemSearch.jsx's onBlur wiring for why a
  // selection still wins the race against this.
  const handleItemBlur = (index) => {
    setProductSuggestions((prev) => ({ ...prev, [index]: null }));
  };

  // A "set" (e.g. ชุดโปรช่วงล่างเก๋ง) carries one warranty for the whole
  // group, same as a regular item — picking it expands into one row per
  // component instead of a single line, mirroring ReceiptFormModal.jsx's
  // expandSetIntoItems. Price is left blank on every row for staff to fill
  // in manually. The set's warranty is copied onto every expanded row (not
  // just the first) so whichever row matches a printed warranty slot
  // (แร็ค/ลูกหมาก) still carries it through to the printed quotation.
  const expandSetIntoItems = async (index, product) => {
    try {
      const response = await client.get(`/service-items/${product.id}/components`);
      const components = response.data.data || [];
      const rows = (components.length > 0 ? components : [{ component_name: product.product_name, default_qty: 1 }]).map((comp) => {
        const qty = Number(comp.default_qty) > 0 ? Number(comp.default_qty) : 1;
        return {
          product_id: null,
          product_name: comp.component_name,
          category: product.category || '',
          warranty_name: product.warranty_name || '',
          warranty_year: product.warranty_year || 0,
          warranty_month: product.warranty_month || 0,
          warranty_km: product.warranty_km || 0,
          quantity: qty,
          unit_price: '',
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
    setProductSuggestions((prev) => ({ ...prev, [index]: null }));
    setFieldErrors((prev) => ({ ...prev, items: null }));
  };

  const selectProductSuggestion = (index, product) => {
    if (product.is_set) {
      expandSetIntoItems(index, product);
      return;
    }
    setItems((prev) => {
      const next = [...prev];
      // service_items has no price column (same as the receipt flow) — price
      // is always filled in by hand per line, so only the name/warranty
      // change here. product_id stays null: it's a FK to the separate
      // `products` cost table, and a service_items id would violate that
      // constraint.
      next[index] = {
        ...next[index],
        product_id: null,
        product_name: product.product_name,
        category: product.category || '',
        warranty_name: product.warranty_name || '',
        warranty_year: product.warranty_year || 0,
        warranty_month: product.warranty_month || 0,
        warranty_km: product.warranty_km || 0,
      };
      return next;
    });
    setProductSuggestions((prev) => ({ ...prev, [index]: null }));
    setFieldErrors((prev) => ({ ...prev, items: null }));
    setTimeout(() => {
      const qtyRef = itemQtyRefs.current[index];
      if (qtyRef && qtyRef.focus) qtyRef.focus();
    }, 0);
  };

  // insertAfterIndex lets each row's "+ แทรกบรรทัด" button drop a new blank
  // line exactly where it's needed, instead of always appending to the end
  // and having to move it up into place by hand.
  const addItem = (insertAfterIndex) => setItems((prev) => {
    if (insertAfterIndex == null) return [...prev, { ...defaultItem }];
    const next = [...prev];
    next.splice(insertAfterIndex + 1, 0, { ...defaultItem });
    return next;
  });
  const removeItem = (index) => setItems((prev) => prev.filter((_, idx) => idx !== index));

  const calculateTotal = () => items.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    if (customerMode === 'existing' && !customer?.id) {
      setError('กรุณาเลือกลูกค้าก่อน');
      setFieldErrors((prev) => ({ ...prev, customer_id: 'เลือกลูกค้าก่อน' }));
      return;
    }

    if (customerMode === 'new' && !newCustomer.customer_name.trim()) {
      setError('กรุณากรอกชื่อลูกค้าใหม่');
      setFieldErrors((prev) => ({ ...prev, customer_name: 'กรอกชื่อลูกค้า' }));
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
      const name = item.product_name?.toString().trim();
      const qty = Number(item.quantity || 0);
      return Boolean(name) && qty > 0;
    });

    if (validItems.length === 0) {
      setError('กรุณาเพิ่มรายการสินค้า/บริการอย่างน้อยหนึ่งรายการ');
      setFieldErrors((prev) => ({ ...prev, items: 'เพิ่มรายการสินค้า/บริการ' }));
      return;
    }

    setLoading(true);
    try {
      const payload = {
        customer_id: customerMode === 'existing' ? customer?.id : null,
        newCustomer: customerMode === 'new' ? {
          customer_name: newCustomer.customer_name.trim(),
          phone: newCustomer.phone.trim() || null,
        } : null,
        vehicle_id: vehicleMode === 'existing' ? vehicleId : null,
        newVehicle: vehicleMode === 'new' ? {
          brand: newVehicle.brand.trim(),
          model: newVehicle.model.trim(),
          color: newVehicle.color.trim() || null,
          license_plate: newVehicle.license_plate.trim() || null,
        } : null,
        quotation_date: quotationDate,
        mileage: Number(mileage || 0),
        remark: remark.trim(),
        queue_no: queueNo.trim() || null,
        symptom: symptom.trim() || null,
        items: validItems.map((item) => ({
          product_id: item.product_id || null,
          product_name: item.product_name.trim(),
          quantity: Number(item.quantity || 0),
          unit_price: Number(item.unit_price || 0),
          warranty_name: item.warranty_name || null,
          warranty_year: item.warranty_year || 0,
          warranty_month: item.warranty_month || 0,
          warranty_km: item.warranty_km || 0,
        })),
      };

      if (quotation?.id) {
        await client.put(`/quotations/${quotation.id}`, payload);
        showToast('success', 'แก้ไขใบเสนอราคาสำเร็จ');
      } else {
        await client.post('/quotations', payload);
        showToast('success', 'สร้างใบเสนอราคาสำเร็จ');
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
        setError(resp?.error || 'เกิดข้อผิดพลาด');
      }
      showToast('error', resp?.error || 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  const previewVehicle = vehicleMode === 'existing'
    ? vehicles.find((v) => v.id.toString() === vehicleId) || {}
    : newVehicle;

  const previewData = {
    quotation_no: quotationNo || '-',
    quotation_date: quotationDate,
    queue_no: queueNo,
    symptom,
    customer: customerMode === 'existing' ? customer || {} : { ...newCustomer },
    // previewVehicle (from the vehicles list / newVehicle) never carries the
    // document's own mileage reading — that's tracked separately as its own
    // form field, not part of the vehicle record — so it must be merged in
    // explicitly or the live preview shows blank even after typing it in.
    vehicle: { ...previewVehicle, mileage },
    items,
    remark,
    subtotal: calculateTotal(),
    discount: 0,
  };

  return (
    <FormModalShell
      title={quotation ? 'แก้ไขใบเสนอราคา' : 'สร้างใบเสนอราคา'}
      subtitle="ข้อมูลลูกค้า/รถแบบเดียวกับใบเสร็จ พร้อมพรีวิว A4 แบบเรียลไทม์"
      onClose={onClose}
      error={error}
      toast={toast}
      onToastDone={resetToast}
    >
      {({ requestClose }) => (
        <div className="receipt-content">
          <div className="receipt-form-pane">
            <form onSubmit={handleSubmit} className="modal-form receipt-modal-form">
              <div className="info-card receipt-info-card">
                <div className="info-card-title">ข้อมูลใบเสนอราคา</div>
                <div className="receipt-info-grid">
                  <div className="form-group">
                    <label>เลขที่ใบเสนอราคา</label>
                    <input type="text" readOnly value={quotationNo || '-'} />
                  </div>
                  <div className="form-group">
                    <label>วันที่</label>
                    <input
                      type="date"
                      value={quotationDate}
                      onChange={(e) => setQuotationDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>เลขคิว/เลขงาน</label>
                    <input
                      type="text"
                      value={queueNo}
                      onChange={(e) => setQueueNo(e.target.value)}
                      placeholder="เช่น 001"
                    />
                  </div>
                </div>
              </div>

              <div className="info-card note-card">
                <div className="info-card-title">อาการรถ</div>
                <div className="form-group">
                  <textarea
                    value={symptom}
                    onChange={(e) => setSymptom(e.target.value)}
                    rows={3}
                    placeholder="เช่น มีเสียงดังช่วงล่างเวลาเข้าโค้ง, พวงมาลัยสั่น..."
                  />
                </div>
              </div>

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
                itemSuggestions={productSuggestions}
                suggestionIndex={suggestionIndex}
                handleItemChange={handleItemChange}
                handleItemKeyDown={handleItemKeyDown}
                handleSelectServiceItem={selectProductSuggestion}
                handleSelectItem={selectProductSuggestion}
                handleAddItem={addItem}
                handleRemoveItem={removeItem}
                onItemNameChange={handleItemNameChange}
                onItemBlur={handleItemBlur}
                itemNameRefs={itemNameRefs}
                itemQtyRefs={itemQtyRefs}
                itemPriceRefs={itemPriceRefs}
                formatMoney={formatMoney}
                fieldErrors={fieldErrors}
                nameField="product_name"
                showWarranty={true}
                placeholder="พิมพ์ชื่อสินค้า/บริการ"
                compactRows={true}
              />

              <div className="notes-summary-grid">
                <div className="info-card note-card">
                  <div className="info-card-title">หมายเหตุ</div>
                  <div className="form-group">
                    <textarea
                      value={remark}
                      onChange={(e) => setRemark(e.target.value)}
                      rows={5}
                      placeholder="รายละเอียดเพิ่มเติมเกี่ยวกับใบเสนอราคา"
                    />
                  </div>
                </div>
                <div className="info-card total-summary-card">
                  <div className="info-card-title">สรุปยอด</div>
                  <div className="summary-grid summary-grid-card">
                    <div>
                      <div className="summary-label">ยอดรวม</div>
                      <div className="summary-value">฿{formatMoney(calculateTotal())}</div>
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
                      <div className="summary-label">ยอดสุทธิ</div>
                      <div className="summary-value">฿{formatMoney(calculateTotal())}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-footer no-print">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'กำลังบันทึก...' : quotation ? 'อัปเดตใบเสนอราคา' : 'สร้างใบเสนอราคา'}
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
            {showMobilePreview ? 'ซ่อนตัวอย่างใบเสนอราคา ▲' : '👁 ดูตัวอย่างใบเสนอราคา ▼'}
          </button>

          <div className={`receipt-preview-pane ${showMobilePreview ? '' : 'preview-collapsed-mobile'}`}>
            <div className="receipt-preview-header">
              <div>
                <strong>Live Preview</strong>
                <p className="preview-subtitle">ดูตัวอย่างใบเสนอราคาทันที</p>
              </div>
            </div>
            <div className="receipt-preview-frame">
              <QuotationPrintTemplate data={previewData} />
            </div>
          </div>
        </div>
      )}
    </FormModalShell>
  );
}
