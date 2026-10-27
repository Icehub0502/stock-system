// SaaS phase 2 — every SQL statement that touches a shop-owned table must mention shop_id
// (see scripts/tenant-lint.js). A new query added without it fails here.
const { lintAll } = require('../scripts/tenant-lint');

test('no SQL statement on a shop-owned table is missing shop_id', () => {
  const findings = lintAll().map((f) => `${f.file.split(/[\/]src[\/]/)[1]}:${f.line} (${f.tables.join(', ')})`);
  expect(findings).toEqual([]);
});
