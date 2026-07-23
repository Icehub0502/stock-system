import React from 'react';
import WarrantySummary from './WarrantySummary';
import SearchAutocomplete from './SearchAutocomplete';

// รายการที่พิมพ์ชื่อตรงกับคำเหล่านี้ (แร็ค/ลูกหมาก) เปิดให้พนักงานกรอกประกันเองได้
// (ชื่อ/ปี/กม.) แทนการแสดงผลอย่างเดียวจากค่าเริ่มต้นแคตตาล็อก — เจ้าของร้านขอมาเฉพาะ
// 2 รายการนี้ ไม่ใช่ทุกรายการ (ของอื่นยังคงเห็นแค่สรุปประกันแบบอ่านอย่างเดียวเหมือนเดิม)
const MANUAL_WARRANTY_KEYWORDS = ['แร็ค', 'ลูกหมาก'];

export default function ItemSearch({
  item,
  index,
  itemSuggestions,
  suggestionIndex,
  handleItemChange,
  handleItemKeyDown,
  handleSelectServiceItem,
  handleSelectItem,
  onItemNameChange,
  onItemBlur,
  itemNameRef,
  nameField = 'product_name_snapshot',
  placeholder = 'พิมพ์ชื่อสินค้า/บริการ',
  showWarranty = true,
  enableManualWarranty = false,
}) {
  const value = item[nameField] || '';
  const isManualWarrantyItem = enableManualWarranty && MANUAL_WARRANTY_KEYWORDS.some((kw) => value.includes(kw));
  const rawSuggestions = itemSuggestions[index];
  const suggestions = rawSuggestions || [];
  const isOpen = Array.isArray(rawSuggestions);
  const activeIndex = Number.isInteger(suggestionIndex[index]) ? suggestionIndex[index] : -1;
  const selectHandler = handleSelectItem || handleSelectServiceItem;
  const listId = `item-suggestions-${index}`;

  return (
    <div className={`autocomplete-field${isOpen ? ' is-open' : ''}`}>
      <SearchAutocomplete
        value={value}
        placeholder={placeholder}
        suggestions={suggestions}
        isOpen={isOpen}
        activeIndex={activeIndex}
        listId={listId}
        onChange={(nextValue) => {
          handleItemChange(index, nameField, nextValue);
          onItemNameChange(nextValue, index);
        }}
        onKeyDown={(e) => handleItemKeyDown(e, index)}
        onSelect={(suggestion) => selectHandler(index, suggestion)}
        onBlur={() => {
          // Selecting a suggestion fires via onMouseDown, which runs before
          // this blur — the delay lets that handler clear the suggestions
          // first, so this only actually closes the dropdown when focus
          // left *without* picking anything (e.g. clicking straight into
          // another row). Without it, a row's dropdown that was typed into
          // but never resolved stays open forever, stacking on top of
          // whichever row gets focused next.
          window.setTimeout(() => {
            if (typeof onItemBlur === 'function') onItemBlur(index);
          }, 150);
        }}
        inputRef={itemNameRef}
      />
      {showWarranty && (
        isManualWarrantyItem ? (
          <div className="warranty-manual-inputs">
            <input
              type="text"
              className="warranty-manual-input warranty-manual-name"
              placeholder="ชื่อประกัน"
              value={item.warranty_name || ''}
              onChange={(e) => handleItemChange(index, 'warranty_name', e.target.value)}
            />
            <input
              type="number"
              min="0"
              className="warranty-manual-input"
              placeholder="ปี"
              value={item.warranty_year || ''}
              onChange={(e) => handleItemChange(index, 'warranty_year', e.target.value)}
            />
            <input
              type="number"
              min="0"
              className="warranty-manual-input"
              placeholder="กม."
              value={item.warranty_km || ''}
              onChange={(e) => handleItemChange(index, 'warranty_km', e.target.value)}
            />
          </div>
        ) : (
          <WarrantySummary
            warranty_name={item.warranty_name}
            warranty_year={item.warranty_year}
            warranty_km={item.warranty_km}
          />
        )
      )}
    </div>
  );
}
