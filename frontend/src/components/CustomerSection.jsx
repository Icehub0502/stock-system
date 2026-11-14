import React, { useEffect, useState } from 'react';
import client from '../api/client';

export default function CustomerSection({
  customerMode,
  customerQuery,
  customerResults,
  customer,
  newCustomer,
  fieldErrors,
  onCustomerQueryChange,
  onNewCustomerInput,
  onCustomerSelect,
  onCustomerModeChange,
}) {
  const [similarCustomers, setSimilarCustomers] = useState([]);
  // the customer this phone already belongs to: saving a "new customer" with it makes the bill theirs
  const [phoneOwner, setPhoneOwner] = useState(null);

  useEffect(() => {
    const digits = (newCustomer?.phone || '').replace(/D/g, '');
    if (customerMode !== 'new' || digits.length < 9 || digits.length > 10) {
      setPhoneOwner(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await client.get('/receipts/customers/by-phone', { params: { phone: digits } });
        if (!cancelled) setPhoneOwner(response.data.data || null);
      } catch (err) {
        if (!cancelled) setPhoneOwner(null);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerMode, newCustomer?.phone]);

  useEffect(() => {
    const query = (newCustomer?.customer_name || '').trim();
    if (customerMode !== 'new' || !query || query.length < 2) {
      setSimilarCustomers([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await client.get('/receipts/customers', { params: { search: query } });
        const matches = (response.data.data || []).filter((item) => item.customer_name && item.customer_name.toLowerCase() !== query.toLowerCase());
        setSimilarCustomers(matches.slice(0, 3));
      } catch (err) {
        console.error('Error checking similar customers:', err);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [customerMode, newCustomer?.customer_name]);

  const typedName = (newCustomer?.customer_name || '').trim();

  return (
    <div className="info-card">
      <div className="info-card-title">ข้อมูลลูกค้า</div>
      <div className="info-card-grid">
        <div className="form-group customer-search-group">
          <label>ค้นหาลูกค้า</label>
          <input
            type="text"
            value={customerMode === 'existing' ? customerQuery : newCustomer.customer_name}
            onChange={(e) => {
              if (customerMode === 'existing') {
                onCustomerQueryChange(e.target.value);
              } else {
                onNewCustomerInput('customer_name', e.target.value);
              }
            }}
            placeholder="พิมพ์ชื่อ, เบอร์, หรือรหัสลูกค้า"
            required
          />
          {(fieldErrors.customer_id || fieldErrors.customer_name) && (
            <div className="field-error">{fieldErrors.customer_id || fieldErrors.customer_name}</div>
          )}
          {customerMode === 'new' && similarCustomers.length > 0 && (
            <div className="customer-similar-warning">
              <div>พบลูกค้าชื่อใกล้เคียง:</div>
              {similarCustomers.map((cust) => (
                <button key={cust.id} type="button" className="customer-similar-link" onClick={() => onCustomerSelect(cust)}>
                  {cust.customer_name} · {cust.phone || '-'}
                </button>
              ))}
            </div>
          )}
          {customerMode === 'existing' && customerResults.length > 0 && (
            <div className="autocomplete-dropdown">
              {customerResults.map((cust) => (
                <button
                  key={cust.id}
                  type="button"
                  className="autocomplete-item"
                  onClick={() => onCustomerSelect(cust)}
                >
                  {cust.customer_code} · {cust.customer_name} · {cust.phone || '-'}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="form-group">
          <label>โทรศัพท์</label>
          <input
            type="text"
            value={customerMode === 'existing' ? customer?.phone || '' : newCustomer.phone}
            onChange={(e) => customerMode === 'new' && onNewCustomerInput('phone', e.target.value)}
            placeholder="081-234-5678"
            readOnly={customerMode === 'existing'}
          />
          {fieldErrors.phone && <div className="field-error">{fieldErrors.phone}</div>}
          {customerMode === 'new' && phoneOwner && (
            <div className="customer-similar-warning customer-phone-owner" role="alert">
              <div>
                เบอร์นี้เป็นของลูกค้า "{phoneOwner.customer_name}" ({phoneOwner.customer_code}) อยู่แล้ว
                — ถ้าบันทึก บิลนี้จะเป็นของลูกค้าคนนี้
                {typedName && typedName !== phoneOwner.customer_name && ` และชื่อ "${typedName}" ที่พิมพ์จะไม่ถูกบันทึก`}
              </div>
              <button type="button" className="customer-similar-link" onClick={() => onCustomerSelect(phoneOwner)}>
                ใช้ลูกค้าเดิม: {phoneOwner.customer_name} · {phoneOwner.phone}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="customer-mode-toggle two-column info-card-toggle">
        <label>
          <input
            type="radio"
            name="customerMode"
            value="existing"
            checked={customerMode === 'existing'}
            onChange={() => onCustomerModeChange('existing')}
          />
          ลูกค้าเดิม
        </label>
        <label>
          <input
            type="radio"
            name="customerMode"
            value="new"
            checked={customerMode === 'new'}
            onChange={() => onCustomerModeChange('new')}
          />
          ลูกค้าใหม่
        </label>
      </div>
    </div>
  );
}
