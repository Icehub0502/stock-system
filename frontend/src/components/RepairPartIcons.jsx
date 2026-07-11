import React from 'react';

// Simple line-art icons for each repair-checklist part, echoing the
// illustrations on the physical paper form so a technician can recognize
// the part at a glance instead of reading every label carefully.
const base = {
  viewBox: '0 0 48 48',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function IconRack(props) {
  return (
    <svg {...base} width={props.size || 28} height={props.size || 28}>
      <circle cx="7" cy="24" r="3.5" />
      <line x1="10.5" y1="24" x2="16" y2="24" />
      <path d="M16 18h16v12H16z" />
      <line x1="19" y1="18" x2="19" y2="30" />
      <line x1="23" y1="18" x2="23" y2="30" />
      <line x1="27" y1="18" x2="27" y2="30" />
      <line x1="32" y1="24" x2="37.5" y2="24" />
      <circle cx="41" cy="24" r="3.5" />
    </svg>
  );
}

export function IconWishbone(props) {
  return (
    <svg {...base} width={props.size || 28} height={props.size || 28}>
      <path d="M8 34 L21 12 L40 20" />
      <path d="M8 34 L40 20" />
      <circle cx="8" cy="34" r="3.2" />
      <circle cx="21" cy="12" r="3.2" />
      <circle cx="40" cy="20" r="3.2" />
    </svg>
  );
}

export function IconTieRodEnd(props) {
  return (
    <svg {...base} width={props.size || 28} height={props.size || 28}>
      <line x1="6" y1="30" x2="26" y2="30" />
      <circle cx="32" cy="26" r="7" />
      <line x1="32" y1="19" x2="32" y2="10" />
    </svg>
  );
}

export function IconSwayBarLink(props) {
  return (
    <svg {...base} width={props.size || 28} height={props.size || 28}>
      <circle cx="9" cy="24" r="4.5" />
      <line x1="13.5" y1="24" x2="34.5" y2="24" />
      <circle cx="39" cy="24" r="4.5" />
    </svg>
  );
}

export function IconSwayBarBushing(props) {
  return (
    <svg {...base} width={props.size || 28} height={props.size || 28}>
      <rect x="6" y="20" width="36" height="8" rx="4" />
      <path d="M17 14v20M31 14v20" />
      <path d="M17 14h14v6H17z" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="29" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconWheelBearing(props) {
  return (
    <svg {...base} width={props.size || 28} height={props.size || 28}>
      <circle cx="24" cy="24" r="17" />
      <circle cx="24" cy="24" r="6" />
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x = 24 + 11.5 * Math.cos(rad);
        const y = 24 + 11.5 * Math.sin(rad);
        return <circle key={deg} cx={x} cy={y} r="1.8" fill="currentColor" stroke="none" />;
      })}
    </svg>
  );
}

export function IconDriveShaft(props) {
  return (
    <svg {...base} width={props.size || 28} height={props.size || 28}>
      <line x1="15" y1="24" x2="33" y2="24" />
      <path d="M6 24h6M8 20l4 8M11 20l4 8" />
      <path d="M36 24h6M38 20l4 8M41 20l4 8" />
    </svg>
  );
}

export function IconShock(props) {
  return (
    <svg {...base} width={props.size || 28} height={props.size || 28}>
      <rect x="16" y="5" width="16" height="15" rx="2" />
      <line x1="24" y1="20" x2="24" y2="43" />
      <path d="M17 24 L31 27 L17 30 L31 33 L17 36 L31 39" />
    </svg>
  );
}

export function IconEquipment(props) {
  return (
    <svg {...base} width={props.size || 28} height={props.size || 28}>
      <path d="M31 8a7 7 0 00-9.9 8L8 29.1a3 3 0 004.9 4.9L26 21a7 7 0 008-9.9l-5 5-4-4z" />
    </svg>
  );
}
