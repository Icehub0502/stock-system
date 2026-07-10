import React from 'react';

export default function SearchAutocomplete({
  value,
  placeholder,
  suggestions,
  isOpen = false,
  activeIndex,
  listId,
  onChange,
  onKeyDown,
  onSelect,
  inputRef,
}) {
  const activeId = activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined;

  return (
    <>
      <input
        type="text"
        value={value}
        ref={inputRef}
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-expanded={suggestions.length > 0}
        role="combobox"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />
      {isOpen && (
        <div className="autocomplete-dropdown product-dropdown" id={listId} role="listbox">
          {suggestions.length > 0 ? (
            suggestions.map((suggestion, idx) => (
              <button
                id={`${listId}-${idx}`}
                key={suggestion.id ?? `${idx}`}
                type="button"
                role="option"
                aria-selected={activeIndex === idx}
                className={`autocomplete-item ${activeIndex === idx ? 'is-active' : ''}`}
                onMouseDown={() => onSelect(suggestion)}
              >
                {suggestion.is_set && <span className="autocomplete-set-badge">📦 ชุด</span>}
                {suggestion.category ? `${suggestion.category} · ${suggestion.product_name}` : suggestion.product_name}
              </button>
            ))
          ) : (
            <div className="autocomplete-empty">ไม่พบรายการ</div>
          )}
        </div>
      )}
    </>
  );
}
