// Compare vehicle names ignoring case, spaces and punctuation, so "Camry", "camry " and "CAM-RY" count as the same
function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[\s\-_./()'’]+/g, '');
}

module.exports = { normalizeName };
