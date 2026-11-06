// How the warranty register words a warranty's status and what is left of it
export const WARRANTY_STATUS = {
  active: { label: 'อยู่ในประกัน', className: 'wr-status-active' },
  soon: { label: 'ใกล้หมด', className: 'wr-status-soon' },
  expired: { label: 'หมดประกัน', className: 'wr-status-expired' },
  none: { label: 'ยังไม่ระบุประกัน', className: 'wr-status-none' },
  waiting: { label: 'รอออกใบเสร็จ', className: 'wr-status-none' },
  void: { label: 'ยกเลิกเลข', className: 'wr-status-none' },
};

export function daysLeftText(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return 'ไม่จำกัดเวลา';
  if (daysLeft < 0) return `เลยมา ${Math.abs(daysLeft).toLocaleString()} วัน`;
  if (daysLeft === 0) return 'หมดวันนี้';
  return `เหลือ ${daysLeft.toLocaleString()} วัน`;
}

export function kmLeftText(row) {
  if (row.km_limit === null || row.km_limit === undefined) {
    return Number(row.warranty_km) > 0 ? `${Number(row.warranty_km).toLocaleString()} กม. (บิลไม่มีเลขไมล์)` : 'ไม่จำกัดระยะ';
  }
  const left = Number(row.km_left);
  return left > 0
    ? `ถึง ${Number(row.km_limit).toLocaleString()} กม. (เหลือ ${left.toLocaleString()} กม.)`
    : `ถึง ${Number(row.km_limit).toLocaleString()} กม. (เกินแล้ว)`;
}
