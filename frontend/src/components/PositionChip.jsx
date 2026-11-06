import React from 'react';
import { positionLabel, POSITION_COLOR, NEUTRAL_POSITION_COLOR } from '../utils/stockPositions';

// ป้ายสีบอกตำแหน่งของสต๊อกรวม (ซ้าย/ขวา/หน้า/หลัง/บน/ล่าง) — สีเดียวกันทุกหน้า
export default function PositionChip({ position, className = 'stock-all-chip-pos' }) {
  if (!position) return null;
  const color = POSITION_COLOR[position] || NEUTRAL_POSITION_COLOR;
  return (
    <span className={className} style={{ color: color.fg, background: color.bg }}>
      {positionLabel(position)}
    </span>
  );
}

// the same chip in the look of the scan pages
export function ScanPositionChip({ position }) {
  return <PositionChip position={position} className="scan-chip" />;
}
