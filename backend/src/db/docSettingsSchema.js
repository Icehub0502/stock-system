// Print header settings per branch ("หัวกระดาษ"): one row per shop and document type (quotation / receipt) holding the
// company name, address, contacts, title, accent colour and logo that the print templates show.
// A shop with no row prints with defaults built from its shop name (see routes/docSettings.routes.js), so another
// branch never prints the first shop's address. Shop 1 (the original Champ Power shop) is seeded once with the
// header that used to be hard-coded in the frontend (its tax id is left empty: it was never printed); logo_path 'builtin:champpower' is the logo bundled with the app.
//
// Idempotent: safe to run on every start.

const SHOP_1_DEFAULTS = {
  company_name: 'บริษัท เจพีเอ็ม โซลูชั่น จำกัด',
  address: 'เลขที่ 784 หมู่ 4 ซอยแพรกษา 12 ตำบลแพรกษา อำเภอเมืองสมุทรปราการ จังหวัดสมุทรปราการ 10280',
  phone: '093-824-5551',
  line_id: '@Champ5',
};

async function migrateDocSettings(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS shop_doc_settings (
      shop_id INT NOT NULL,
      doc_type ENUM('quotation','receipt') NOT NULL,
      company_name VARCHAR(120) DEFAULT NULL,
      address VARCHAR(300) DEFAULT NULL,
      phone VARCHAR(50) DEFAULT NULL,
      line_id VARCHAR(50) DEFAULT NULL,
      tax_id VARCHAR(60) DEFAULT NULL,
      branch_text VARCHAR(60) DEFAULT NULL,
      title VARCHAR(60) DEFAULT NULL,
      accent_color CHAR(7) DEFAULT NULL,
      logo_path VARCHAR(255) DEFAULT NULL,
      logo_width SMALLINT UNSIGNED DEFAULT NULL,
      updated_by VARCHAR(100) DEFAULT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (shop_id, doc_type),
      CONSTRAINT fk_doc_settings_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [[shop1]] = await conn.query('SELECT id FROM shops WHERE id = 1');
  if (!shop1) return;
  // INSERT IGNORE: never overwrites what the shop has edited since
  const seed = (docType, branchText) => conn.query(
    `INSERT IGNORE INTO shop_doc_settings
       (shop_id, doc_type, company_name, address, phone, line_id, branch_text, logo_path)
     VALUES (1, ?, ?, ?, ?, ?, ?, 'builtin:champpower')`,
    [docType, SHOP_1_DEFAULTS.company_name, SHOP_1_DEFAULTS.address, SHOP_1_DEFAULTS.phone,
      SHOP_1_DEFAULTS.line_id, branchText]
  );
  await seed('quotation', null);
  await seed('receipt', 'สมุทรปราการ');
}

module.exports = { migrateDocSettings };
