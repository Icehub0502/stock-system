// Single source of truth for the "ใบแจ้งซ่อม" checklist shape — shared by
// the mobile entry form and the print template so they can never drift
// apart. Matches the physical paper form section-for-section.

export function defaultChecklist() {
  return {
    rack: { checked: false, note: '' },
    suspension: {
      wing: { checked: false, note: '' },
      tie_rod_end: { checked: false, note: '' },
      sway_bar_link: { checked: false, note: '' },
      sway_bar_bushing: { checked: false, note: '' },
    },
    wheel_bearing: { front_l: false, front_r: false, rear_l: false, rear_r: false },
    drive_shaft: { front_l: false, front_r: false },
    shock: {
      front: { checked: false, note: '' },
      rear: { checked: false, note: '' },
    },
    equipment: { checked: false, note: '' },
    other: '',
  };
}

// Deep-merges saved data onto the default shape so a checklist saved before
// a future field was added still renders without crashing on undefined.
export function normalizeChecklist(data) {
  const base = defaultChecklist();
  if (!data || typeof data !== 'object') return base;
  return {
    rack: { ...base.rack, ...(data.rack || {}) },
    suspension: {
      wing: { ...base.suspension.wing, ...(data.suspension?.wing || {}) },
      tie_rod_end: { ...base.suspension.tie_rod_end, ...(data.suspension?.tie_rod_end || {}) },
      sway_bar_link: { ...base.suspension.sway_bar_link, ...(data.suspension?.sway_bar_link || {}) },
      sway_bar_bushing: { ...base.suspension.sway_bar_bushing, ...(data.suspension?.sway_bar_bushing || {}) },
    },
    wheel_bearing: { ...base.wheel_bearing, ...(data.wheel_bearing || {}) },
    drive_shaft: { ...base.drive_shaft, ...(data.drive_shaft || {}) },
    shock: {
      front: { ...base.shock.front, ...(data.shock?.front || {}) },
      rear: { ...base.shock.rear, ...(data.shock?.rear || {}) },
    },
    equipment: { ...base.equipment, ...(data.equipment || {}) },
    other: data.other || '',
  };
}

export const SUSPENSION_LABELS = {
  wing: 'ปีกนก',
  tie_rod_end: 'ลูกหมากปลาย',
  sway_bar_link: 'ลูกหมากกันโคลง',
  sway_bar_bushing: 'ยางรัดกันโคลง',
};
