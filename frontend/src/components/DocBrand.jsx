import React from 'react';
import champpowerLogo from '../image/champpower-logo.jpg';

// 'builtin:champpower' is the logo bundled with the app (the original shop); anything else is an uploaded file path
export function logoSrc(logoPath) {
  if (!logoPath) return '';
  return logoPath === 'builtin:champpower' ? champpowerLogo : logoPath;
}

// Logo + company details at the top-left of a printed quotation / receipt
export default function DocBrand({ header }) {
  const src = logoSrc(header.logo_path);
  return (
    <div className="doc-brand">
      {src && <img className="doc-logo-big" src={src} style={{ width: header.logo_width || 130 }} alt={header.company_name || 'logo'} />}
      <div className="doc-brand-info">
        {header.company_name && <div className="doc-brand-name">{header.company_name}</div>}
        {header.address && <div className="doc-brand-addr">ที่อยู่ : {header.address}</div>}
        {(header.phone || header.line_id) && (
          <div className="doc-brand-addr">
            {[header.phone && `โทร : ${header.phone}`, header.line_id && `LINE : ${header.line_id}`].filter(Boolean).join('  ·  ')}
          </div>
        )}
        {header.tax_id && <div className="doc-brand-addr">เลขประจำตัวผู้เสียภาษี : {header.tax_id}</div>}
      </div>
    </div>
  );
}
