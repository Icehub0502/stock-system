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

describe('cancelling what was received', () => {
  const receiveMovement = async (session, itemId) => (await pool.query(
    "SELECT id FROM stock_item_movements WHERE receipt_session_id = ? AND item_id = ? AND reason = 'receive' AND voided_at IS NULL",
    [session.id, itemId]
  ))[0][0].id;

  test('a cancelled receive line no longer counts in the cost of the item', async () => {
    const item = await newItem();
    const cheap = await newSession('PMC');
    await addLine(cheap, item, 2, 100);
    await commit(cheap);
    const wrong = await newSession('PMC');
    await addLine(wrong, item, 2, 300);
    await commit(wrong);
    expect(await avgCost(item)).toBe(200);

    const movementId = await receiveMovement(wrong, item);
    expect((await request(app).delete(`/api/stock-receive/movements/${movementId}`).set(as(shopA.managerToken))).status).toBe(200);
    expect(await avgCost(item)).toBe(100);
    const missing = await request(app).get('/api/stock-receive/costs/missing').set(as(shopA.token));
    expect(missing.status).toBe(200);
    const [[voided]] = await pool.query('SELECT id FROM stock_receive_lines WHERE receipt_session_id = ?', [wrong.id]);
    expect((await request(app).put(`/api/stock-receive/costs/lines/${voided.id}`).set(as(shopA.token)).send({ unit_cost: 5 })).status).toBe(400);
  });

  test('a line closed before the link existed is still found when its receive is cancelled', async () => {
    const item = await newItem();
    const keep = await newSession('JET');
    await addLine(keep, item, 1, 50);
    await commit(keep);
    const old = await newSession('JET');
    await addLine(old, item, 1, 150);
    await commit(old);
    await pool.query('UPDATE stock_receive_lines SET movement_id = NULL WHERE receipt_session_id = ?', [old.id]);
    expect(await avgCost(item)).toBe(100);

    const movementId = await receiveMovement(old, item);
    expect((await request(app).delete(`/api/stock-receive/movements/${movementId}`).set(as(shopA.managerToken))).status).toBe(200);
    expect(await avgCost(item)).toBe(50);
  });

  test('deleting a whole bill takes its prices out of the cost', async () => {
    const item = await newItem();
    const keep = await newSession('EEP');
    await addLine(keep, item, 1, 80);
    await commit(keep);
    const bill = await newSession('EEP');
    await addLine(bill, item, 3, 400);
    await commit(bill);
    expect(await avgCost(item)).toBe(320);

    expect((await request(app).delete(`/api/transactions/receipt-sessions/${bill.id}`).set(as(shopA.managerToken))).status).toBe(200);
    expect(await avgCost(item)).toBe(80);
  });
});

describe('bills of other staff', () => {
  test('roles above office can work on a bill someone else opened; a technician cannot', async () => {
    const item = await newItem();
    const bill = await newSession('PMC'); // opened by the office user
    const byOwner = await request(app).post('/api/stock-receive/lines').set(as(shopA.ownerToken))
      .send({ receipt_session_id: bill.id, item_id: item, qty: 1 });
    expect(byOwner.status).toBe(201);
    expect((await request(app).get(`/api/stock-receive/sessions/${bill.id}/lines`).set(as(shopA.ownerToken))).body.lines).toHaveLength(1);
    expect((await request(app).post(`/api/stock-receive/sessions/${bill.id}/commit`).set(as(shopA.ownerToken))).status).toBe(200);

    const [tech] = await pool.query(
      "INSERT INTO users (shop_id, username, password_hash, full_name, role) VALUES (?, 'tech', 'x', 'Tech', 'technician')",
      [shopA.shopId]
    );
    const techToken = require('jsonwebtoken').sign(
      { id: tech.insertId, username: 'tech', role: 'technician', shop_id: shopA.shopId }, process.env.JWT_SECRET, { expiresIn: '1h' }
    );
    const byTech = await request(app).post('/api/stock-receive/lines').set(as(techToken))
      .send({ receipt_session_id: bill.id, item_id: item, qty: 1 });
    expect(byTech.status).toBe(403);
  });

  test('the same item at a different price on one bill becomes its own line; the same price adds up', async () => {
    const item = await newItem();
    const bill = await newSession('PMC');
    await addLine(bill, item, 3, 100);
    const samePrice = await addLine(bill, item, 1, 100);
    expect(samePrice.body.merged).toBe(true);
    const otherPrice = await addLine(bill, item, 1, 200);
    expect(otherPrice.status).toBe(201);
    expect(otherPrice.body.merged).toBe(false);
    const noPrice = await addLine(bill, item, 2, undefined);
    expect(noPrice.body.merged).toBe(true); // no price typed: joins the latest line
    await commit(bill);
    expect(await avgCost(item)).toBe(142.86); // (4*100 + 3*200) / 7: the 2 unpriced pieces joined the latest (200) line
  });

  test('the same bill number from the same supplier asks first; it can still be opened on purpose', async () => {
    const invoice = `DUP${unique}`;
    const first = await newSession('333', invoice);
    const again = await request(app).post('/api/transactions/receipt-session').set(as(shopA.token)).send({ invoice_no: ` ${invoice.toLowerCase()} `, supplier_name: '333' });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'DUPLICATE_BILL', existing: { id: first.id } });
    const otherShop = await request(app).post('/api/transactions/receipt-session').set(as(shopA.token)).send({ invoice_no: invoice, supplier_name: 'JET' });
    expect(otherShop.status).toBe(201);
    const onPurpose = await request(app).post('/api/transactions/receipt-session').set(as(shopA.token)).send({ invoice_no: invoice, supplier_name: '333', allow_duplicate: true });
    expect(onPurpose.status).toBe(201);
  });

  test('a bill number must be text of at most 100 characters', async () => {
    const send = (invoice_no) => request(app).post('/api/transactions/receipt-session').set(as(shopA.token)).send({ invoice_no });
    expect((await send(12345)).status).toBe(400);
    expect((await send('   ')).status).toBe(400);
    expect((await send('x'.repeat(101))).status).toBe(400);
  });

  test('the bill details carry the price of lines not yet closed (reopening a bill keeps them)', async () => {
    const item = await newItem();
    const bill = await newSession('PMC');
    await addLine(bill, item, 2, 125);
    const detail = await request(app).get(`/api/transactions/receipt-sessions/${bill.id}`).set(as(shopA.token));
    expect(Number(detail.body.items.find((it) => it.source === 'pending_line').unit_cost)).toBe(125);
  });
});
