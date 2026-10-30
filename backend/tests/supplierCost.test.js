// Parts suppliers and costs: the supplier of a receive bill, the price per piece on its lines, the average cost of an item,
// and filling costs in after the bill is closed.
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { createShop, dropShop } = require('./helpers');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const unique = Date.now().toString(36);

let shopA;
let shopB;
let categoryId;
let n = 0;

async function newItem() {
  n += 1;
  const [r] = await pool.query(
    'INSERT INTO stock_items (shop_id, category_id, oem_code, description, stock_qty, min_stock) VALUES (?, ?, ?, ?, 0, 1)',
    [shopA.shopId, categoryId, `SC${unique}${n}`, `item ${n}`]
  );
  return r.insertId;
}
async function newSession(supplierName, invoice = `INV${unique}${(n += 1)}`) {
  const res = await request(app).post('/api/transactions/receipt-session').set(as(shopA.token)).send({ invoice_no: invoice, supplier_name: supplierName });
  expect(res.status).toBe(201);
  return res.body;
}
const addLine = (session, itemId, qty, unitCost) => request(app).post('/api/stock-receive/lines').set(as(shopA.token))
  .send({ receipt_session_id: session.id, item_id: itemId, qty, unit_cost: unitCost });
const commit = (session) => request(app).post(`/api/stock-receive/sessions/${session.id}/commit`).set(as(shopA.token));
const avgCost = async (itemId) => {
  const value = (await pool.query('SELECT avg_cost FROM stock_items WHERE id = ?', [itemId]))[0][0].avg_cost;
  return value === null ? null : Number(value);
};

beforeAll(async () => {
  shopA = await createShop();
  shopB = await createShop();
  categoryId = (await pool.query('INSERT INTO stock_categories (name) VALUES (?)', [`SupCat ${unique}`]))[0].insertId;
});

afterAll(async () => {
  await pool.query('DELETE FROM stock_receive_lines WHERE receipt_session_id IN (SELECT id FROM receipt_sessions WHERE shop_id = ?)', [shopA.shopId]);
  await pool.query('DELETE FROM stock_item_movements WHERE item_id IN (SELECT id FROM stock_items WHERE shop_id = ?)', [shopA.shopId]);
  await pool.query('DELETE FROM receipt_sessions WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM stock_items WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM stock_categories WHERE id = ?', [categoryId]);
  await dropShop(shopA.shopId);
  await dropShop(shopB.shopId);
  await pool.end();
});

describe('suppliers', () => {
  test('staff type a supplier on the bill: it is added once, whatever the spelling, and only for that branch', async () => {
    const first = await newSession('BBTECT');
    const second = await newSession('  bbtect ');
    expect(second.supplier_id).toBe(first.supplier_id);
    expect(second.supplier_name).toBe('BBTECT'); // the name as it was first written
    const other = await newSession('รุ่งเรืองรัต หนามแดง');
    expect(other.supplier_id).not.toBe(first.supplier_id);

    const list = await request(app).get('/api/suppliers').set(as(shopA.token));
    expect(list.body.data.map((s) => s.name).sort()).toEqual(['BBTECT', 'รุ่งเรืองรัต หนามแดง'].sort());
    expect(list.body.data.find((s) => s.name === 'BBTECT').bills).toBe(2);
    expect((await request(app).get('/api/suppliers').set(as(shopB.token))).body.data).toEqual([]);
    expect((await request(app).post('/api/suppliers').set(as(shopA.token)).send({ name: '   ' })).status).toBe(400);
  });

  test('a bill without a supplier is still allowed; renaming and hiding are for managers', async () => {
    const plain = await request(app).post('/api/transactions/receipt-session').set(as(shopA.token)).send({ invoice_no: `NOSUP${unique}` });
    expect(plain.status).toBe(201);
    expect(plain.body.supplier_id).toBeNull();

    const sup = await newSession('TEIN');
    expect((await request(app).put(`/api/suppliers/${sup.supplier_id}`).set(as(shopA.token)).send({ name: 'TEIN Thai' })).status).toBe(403);
    const renamed = await request(app).put(`/api/suppliers/${sup.supplier_id}`).set(as(shopA.managerToken)).send({ name: 'TEIN Thai', guide_categories: 'โช๊ค' });
    expect(renamed.status).toBe(200);
    const [[stored]] = await pool.query('SELECT supplier_name FROM receipt_sessions WHERE id = ?', [sup.id]);
    expect(stored.supplier_name).toBe('TEIN Thai'); // the bill follows the rename
    expect((await request(app).put(`/api/suppliers/${sup.supplier_id}`).set(as(shopB.managerToken)).send({ name: 'x' })).status).toBe(404);

    await request(app).put(`/api/suppliers/${sup.supplier_id}`).set(as(shopA.managerToken)).send({ is_active: false });
    const active = (await request(app).get('/api/suppliers').set(as(shopA.token))).body.data.map((s) => s.name);
    expect(active).not.toContain('TEIN Thai');
    expect((await request(app).get('/api/suppliers?all=1').set(as(shopA.managerToken))).body.data.map((s) => s.name)).toContain('TEIN Thai');
  });
});

describe('cost of what is received', () => {
  test('the cost of an item is the quantity-weighted average of its closed lines', async () => {
    const item = await newItem();
    const s1 = await newSession('PMC');
    expect((await addLine(s1, item, 2, 100)).status).toBe(201);
    expect((await commit(s1)).status).toBe(200);
    expect(await avgCost(item)).toBe(100);

    const s2 = await newSession('PMC');
    expect((await addLine(s2, item, 3, 200)).status).toBe(201);
    expect(await avgCost(item)).toBe(100); // a pending line changes nothing yet
    expect((await commit(s2)).status).toBe(200);
    expect(await avgCost(item)).toBe(160); // (2*100 + 3*200) / 5
  });

  test('a price can be corrected on a pending line, and bad prices are refused', async () => {
    const item = await newItem();
    const s = await newSession('PMC');
    const line = (await addLine(s, item, 1, 50)).body.line;
    expect((await request(app).patch(`/api/stock-receive/lines/${line.id}`).set(as(shopA.token)).send({ unit_cost: 75 })).status).toBe(200);
    expect((await request(app).patch(`/api/stock-receive/lines/${line.id}`).set(as(shopA.token)).send({ unit_cost: -1 })).status).toBe(400);
    expect((await request(app).patch(`/api/stock-receive/lines/${line.id}`).set(as(shopA.token)).send({})).status).toBe(400);
    expect((await addLine(s, item, 1, 'abc')).status).toBe(400);
    await commit(s);
    expect(await avgCost(item)).toBe(75);
  });

  test('lines closed without a price are listed, and filling them in later updates the average', async () => {
    const item = await newItem();
    const s = await newSession('YOSHI');
    await addLine(s, item, 4, undefined);
    await commit(s);
    expect(await avgCost(item)).toBeNull(); // no cost known yet

    const missing = await request(app).get('/api/stock-receive/costs/missing').set(as(shopA.token));
    const line = missing.body.data.lines.find((l) => l.item_id === item);
    expect(line).toMatchObject({ qty: 4, supplier_name: 'YOSHI' });
    expect(missing.body.data.items.map((i) => i.id)).toContain(item);

    expect((await request(app).put(`/api/stock-receive/costs/lines/${line.id}`).set(as(shopA.token)).send({ unit_cost: 250 })).status).toBe(200);
    expect(await avgCost(item)).toBe(250);
    expect((await request(app).get('/api/stock-receive/costs/missing').set(as(shopA.token))).body.data.lines.map((l) => l.id)).not.toContain(line.id);
    expect((await request(app).put(`/api/stock-receive/costs/lines/${line.id}`).set(as(shopB.token)).send({ unit_cost: 1 })).status).toBe(404);
  });

  test('stock bought before costs were recorded: a manager types a cost by hand, a bill with a price takes over', async () => {
    const item = await newItem();
    expect((await request(app).put(`/api/stock-receive/costs/items/${item}`).set(as(shopA.token)).send({ manual_cost: 40 })).status).toBe(403);
    expect((await request(app).put(`/api/stock-receive/costs/items/${item}`).set(as(shopA.managerToken)).send({ manual_cost: 40 })).status).toBe(200);
    expect(await avgCost(item)).toBe(40);
    expect((await request(app).put(`/api/stock-receive/costs/items/${item}`).set(as(shopB.managerToken)).send({ manual_cost: 5 })).status).toBe(404);

    const s = await newSession('JET');
    await addLine(s, item, 1, 90);
    await commit(s);
    expect(await avgCost(item)).toBe(90);
  });
});
