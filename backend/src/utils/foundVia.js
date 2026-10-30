// Channels a customer can have found the shop through (customers.found_via). The same list lives in
// frontend/src/utils/foundViaChannels.js — change both together. Never edit or remove the first four values:
// customers already hold them.
const FOUND_VIA_VALUES = [
  'google_map', 'facebook', 'friend', 'other',
  'google_search', 'tiktok', 'line', 'pass_by', 'shop_referral', 'returning',
];

// Error text for a channel (+ note) that cannot be stored, or null when it is fine
function foundViaProblem(channel, note) {
  if (!FOUND_VIA_VALUES.includes(channel)) return 'กรุณาเลือกช่องทางที่ลูกค้าเจอร้าน';
  if (channel === 'other' && !String(note || '').trim()) return 'กรุณาระบุรายละเอียดช่องทาง';
  return null;
}

module.exports = { FOUND_VIA_VALUES, foundViaProblem };
