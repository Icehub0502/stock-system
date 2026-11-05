// The short code of a branch (SPK, PKS) printed on documents and shown on screens. A manager can set it on the print
// header page (shop_doc_settings, doc_type 'repair_notice'); until then it comes from the end of the branch name.
const pool = require('../db/pool');

// "แชมป์พาวเวอร์ PKS" → "PKS"
function branchCodeFromName(shopName) {
  const match = /([A-Za-z0-9]{2,8})\s*$/.exec(String(shopName || ''));
  return match ? match[1] : '';
}

async function branchCodeOf(shopId) {
  const [[row]] = await pool.query(
    `SELECT s.name, d.branch_text
     FROM shops s
     LEFT JOIN shop_doc_settings d ON d.shop_id = s.id AND d.doc_type = 'repair_notice'
     WHERE s.id = ?`,
    [shopId]
  );
  if (!row) return '';
  return row.branch_text || branchCodeFromName(row.name);
}

module.exports = { branchCodeFromName, branchCodeOf };
