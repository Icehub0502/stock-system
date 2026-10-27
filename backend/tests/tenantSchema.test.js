const pool = require('../src/db/pool');
const { migrateTenants, SHOP_TABLES, UNIQUE_SPECS, DEFAULT_SHOP } = require('../src/db/tenantSchema');

afterAll(async () => {
  await pool.end();
});

describe('SaaS phase 1 — shop structure', () => {
  test('shop 1 exists and every shop-owned table has shop_id NOT NULL DEFAULT 1', async () => {
    const [[shop]] = await pool.query('SELECT id, code, status FROM shops WHERE id = ?', [DEFAULT_SHOP.id]);
    expect(shop).toBeTruthy();
    expect(shop.status).toBe('active');

    const [cols] = await pool.query(
      `SELECT TABLE_NAME AS t, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'shop_id'`
    );
    const byTable = new Map(cols.map((c) => [c.t, c]));
    for (const table of SHOP_TABLES) {
      const c = byTable.get(table);
      expect({ table, found: !!c }).toEqual({ table, found: true });
      expect(c.nullable).toBe('NO');
      expect(String(c.def)).toBe('1');
    }
  });

  test('existing rows all belong to shop 1 (nothing was left without a shop)', async () => {
    for (const table of ['customers', 'quotations', 'receipts', 'jobs', 'users']) {
      const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE shop_id <> ?`, [DEFAULT_SHOP.id]);
      expect({ table, n: Number(row.n) }).toEqual({ table, n: 0 });
    }
  });

  test('unique values are per shop: same customer_code ok in two shops, rejected inside one shop', async () => {
    const code = `T${Date.now().toString(36)}`.slice(0, 20);
    const [shop2] = await pool.query("INSERT INTO shops (code, name) VALUES (?, 'Test shop')", [`t${Date.now().toString(36)}`]);
    const shopId = shop2.insertId;
    try {
      await pool.query('INSERT INTO customers (shop_id, customer_code, customer_name) VALUES (1, ?, ?)', [code, 'A']);
      await pool.query('INSERT INTO customers (shop_id, customer_code, customer_name) VALUES (?, ?, ?)', [shopId, code, 'B']);
      await expect(
        pool.query('INSERT INTO customers (shop_id, customer_code, customer_name) VALUES (1, ?, ?)', [code, 'dup'])
      ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });

      // app_settings: same key per shop
      await pool.query("INSERT INTO app_settings (shop_id, `key`, value) VALUES (1, 'tenant_test', 'x')");
      await pool.query("INSERT INTO app_settings (shop_id, `key`, value) VALUES (?, 'tenant_test', 'y')", [shopId]);
      const [rows] = await pool.query("SELECT shop_id, value FROM app_settings WHERE `key` = 'tenant_test' ORDER BY shop_id");
      expect(rows.map((r) => r.value)).toEqual(['x', 'y']);
    } finally {
      await pool.query('DELETE FROM customers WHERE customer_code = ?', [code]);
      await pool.query("DELETE FROM app_settings WHERE `key` = 'tenant_test'");
      await pool.query('DELETE FROM shops WHERE id = ?', [shopId]);
    }
  });

  test('every converted UNIQUE now starts with shop_id', async () => {
    for (const [table, cols] of UNIQUE_SPECS) {
      const [rows] = await pool.query(
        `SELECT INDEX_NAME AS name, COLUMN_NAME AS col FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [table]
      );
      const byName = new Map();
      for (const r of rows) byName.set(r.name, [...(byName.get(r.name) || []), r.col]);
      const lists = [...byName.values()].map((l) => l.join(','));
      expect({ table, hasPerShop: lists.includes(['shop_id', ...cols].join(',')) }).toEqual({ table, hasPerShop: true });
      expect({ table, hasOldGlobal: lists.includes(cols.join(',')) }).toEqual({ table, hasOldGlobal: false });
    }
  });

  test('migration is idempotent', async () => {
    const conn = await pool.getConnection();
    try {
      await expect(migrateTenants(conn)).resolves.toBeUndefined();
      await expect(migrateTenants(conn)).resolves.toBeUndefined();
    } finally {
      conn.release();
    }
  });
});
