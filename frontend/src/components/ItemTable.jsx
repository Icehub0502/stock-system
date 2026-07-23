import React from 'react';
import ItemSearch from './ItemSearch';

export default function ItemTable({
  items,
  itemSuggestions,
  suggestionIndex,
  handleItemChange,
  handleItemKeyDown,
  handleSelectServiceItem,
  handleSelectItem,
  handleAddItem,
  handleRemoveItem,
  onItemNameChange,
  onItemBlur,
  itemNameRefs,
  itemQtyRefs,
  itemPriceRefs,
  formatMoney,
  compactRows = false,
  fieldErrors,
  nameField = 'product_name_snapshot',
  showCodeColumn = false,
  codeHeader = 'รหัส',
  nameHeader = 'รายการ',
  quantityHeader = 'จำนวน',
  priceHeader = 'ราคาต่อหน่วย',
  amountHeader = 'จำนวนเงิน',
  placeholder = 'พิมพ์ชื่อสินค้า/บริการ',
  showWarranty = true,
  codeFormatter,
}) {
  const getCodeValue = (item) => {
    if (codeFormatter) return codeFormatter(item);
    if (item.service_item_id) return `SI-${item.service_item_id}`;
    if (item.product_id) return item.product_id ? `PR-${item.product_id}` : '-';
    return '-';
  };

  const getDetailText = (item) => {
    const parts = [];
    if (item.category) parts.push(item.category);
    if (item.warranty_name) parts.push(item.warranty_name);
    if (item.warranty_year) parts.push(`${item.warranty_year} ปี`);
    if (item.warranty_km) parts.push(`${Number(item.warranty_km).toLocaleString()} กม`);
    return parts.length > 0 ? parts.join(' • ') : '—';
  };

  return (
    <div className="info-card receipt-items-section">
      <div className="form-section-header">
        <div>
          <h3>รายการสินค้า/บริการ</h3>
          <p className="receipt-subtle">เลือกจากฐานข้อมูลสินค้าและบริการที่มีอยู่ พร้อมรับประกันอัตโนมัติ</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => handleAddItem()}>
          + เพิ่มรายการ
        </button>
      </div>
      <div className={`items-table receipt-items-table ${compactRows ? 'compact-rows' : ''}`}>
        {fieldErrors.items && <div className="field-error">{fieldErrors.items}</div>}
        <table>
          <thead>
            <tr>
              {showCodeColumn && <th>{codeHeader}</th>}
              <th>{nameHeader}</th>
              {!compactRows && <th>รายละเอียด</th>}
              <th>{quantityHeader}</th>
              <th>{priceHeader}</th>
              <th>{amountHeader}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx}>
                {showCodeColumn && <td data-label={codeHeader}>{getCodeValue(item)}</td>}
                <td className="item-name-cell" data-label={nameHeader}>
                  <ItemSearch
                    item={item}
                    index={idx}
                    itemSuggestions={itemSuggestions}
                    suggestionIndex={suggestionIndex}
                    handleItemChange={handleItemChange}
                    handleItemKeyDown={handleItemKeyDown}
                    handleSelectServiceItem={handleSelectServiceItem}
                    handleSelectItem={handleSelectItem}
                    onItemNameChange={onItemNameChange}
                    onItemBlur={onItemBlur}
                    itemNameRef={(el) => { itemNameRefs.current[idx] = el; }}
                    nameField={nameField}
                    placeholder={placeholder}
                    showWarranty={showWarranty}
                  />
                </td>
                {!compactRows && <td className="item-detail-cell" data-label="รายละเอียด">{getDetailText(item)}</td>}
                <td data-label={quantityHeader}>
                  <input
                    className="receipt-edit-input"
                    ref={(el) => { itemQtyRefs.current[idx] = el; }}
                    type="number"
                    min="1"
                    step="1"
                    value={item.quantity ?? item.qty}
                    onChange={(e) => handleItemChange(idx, 'quantity' in item ? 'quantity' : 'qty', e.target.value)}
                  />
                </td>
                <td data-label={priceHeader}>
                  <input
                    className="receipt-edit-input"
                    ref={(el) => { itemPriceRefs.current[idx] = el; }}
                    type="number"
                    step="0.01"
                    value={item.unit_price ?? item.price}
                    onChange={(e) => handleItemChange(idx, 'unit_price' in item ? 'unit_price' : 'price', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddItem(idx);
                        setTimeout(() => {
                          const nameRef = itemNameRefs.current[idx + 1];
                          if (nameRef && nameRef.focus) nameRef.focus();
                        }, 0);
                      }
                    }}
                  />
                </td>
                <td className="price-cell" data-label={amountHeader}>฿{formatMoney(item.amount)}</td>
                <td className="item-row-actions">
                  <button
                    type="button"
                    className="btn-insert-row"
                    onClick={() => handleAddItem(idx)}
                    title="แทรกบรรทัดใหม่ถัดจากรายการนี้"
                    aria-label="แทรกบรรทัดใหม่ถัดจากรายการนี้"
                  >
                    +
                  </button>
                  <button type="button" className="btn-remove" onClick={() => handleRemoveItem(idx)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
