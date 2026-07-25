import React from 'react';

// Route-level Suspense fallback — a generic shape (header bar + a few rows)
// that roughly matches every page's actual layout (header card + table/list),
// so the swap-in feels like progressive loading instead of a layout jump.
export default function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="กำลังโหลดหน้า">
      <div className="skel skel-header" />
      <div className="skel skel-row" />
      <div className="skel skel-row" />
      <div className="skel skel-row" />
      <div className="skel skel-row skel-row-short" />
    </div>
  );
}
