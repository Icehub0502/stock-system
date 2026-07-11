import React from 'react';
import WarrantySummary from './WarrantySummary';
import SearchAutocomplete from './SearchAutocomplete';

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
  itemNameRef,
  nameField = 'product_name_snapshot',
  placeholder = 'พิมพ์ชื่อสินค้า/บริการ',
  showWarranty = true,
}) {
  const value = item[nameField] || '';
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
        inputRef={itemNameRef}
      />
      {showWarranty && (
        <WarrantySummary
          warranty_name={item.warranty_name}
          warranty_year={item.warranty_year}
          warranty_km={item.warranty_km}
        />
      )}
    </div>
  );
}
