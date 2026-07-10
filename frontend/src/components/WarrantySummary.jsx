import React from 'react';

export default function WarrantySummary({ warranty_name, warranty_year, warranty_km }) {
  if (!warranty_name) return null;

  return (
    <div className="receipt-warranty-note">
      {warranty_name} • {warranty_year} ปี {warranty_km.toLocaleString()} กม
    </div>
  );
}
