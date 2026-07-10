import React, { useEffect, useRef, useState } from 'react';

// Matches the brand list detectBrand() in productCostRoutes.js looks for,
// so a brand typed here lines up with the same car-brand filter/detection
// used on the product-costs page.
const CAR_BRANDS = [
  'Toyota', 'Honda', 'Nissan', 'Isuzu', 'Mitsubishi', 'Mazda', 'Ford',
  'Chevrolet', 'Suzuki', 'Subaru', 'BMW', 'Mercedes-Benz', 'Volkswagen',
  'Lexus', 'Hyundai', 'Kia', 'Volvo', 'MG', 'Proton', 'Haval', 'Range Rover',
];

export default function CarBrandAutocomplete({ value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const query = (value || '').trim().toLowerCase();
  const suggestions = query
    ? CAR_BRANDS.filter((b) => b.toLowerCase().includes(query))
    : CAR_BRANDS;

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="customer-search-group" style={{ width: '100%' }} ref={wrapRef}>
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        style={{ width: '100%' }}
      />
      {open && suggestions.length > 0 && (
        <div className="autocomplete-dropdown product-dropdown">
          {suggestions.map((b) => (
            <button
              key={b}
              type="button"
              className="autocomplete-item"
              onMouseDown={() => { onChange(b); setOpen(false); }}
            >
              {b}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
