// SaaS phase 2 — isolation of the business documents: quotations, receipts, jobs, stock, claims,
// repair notices, catalogues and the public pages. Same idea as tenantIsolation.test.js: shop 1 (the
// default shop, token A) and a throwaway second shop (token B) each own data, and neither may reach
// the other's rows through any endpoint.
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { getManagerToken, createShop, dropShop, createCustomerWithVehicle, cleanupCustomer } = require('./helpers');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const today = new Date().toISOString().slice(0, 10);

let tokenA;
let shopB;
let tokenB;
let fxA; // shop 1 customer + vehicle
const cleanupA = { jobs: [], quotations: [], receipts: [], stockItems: [], stockCategories: [] };

beforeAll(async () => {
  tokenA = await getManagerToken();
  shopB = await createShop();
  shopB.token = shopB.managerToken;
  tokenB = shopB.token;
  fxA = await createCustomerWithVehicle({ namePrefix: 'Iso2 A' });
});

afterAll(async () => {
  for (const id of cleanupA.jobs) await pool.query('DELETE FROM jobs WHERE id = ?', [id]);
  for (const id of cleanupA.stockItems) {
    await pool.query('DELETE FROM stock_item_movements WHERE item_id = ?', [id]);
    await pool.query('DELETE FROM stock_items WHERE id = ?', [id]);
  }
  for (const id of cleanupA.stockCategories) await pool.query('DELETE FROM stock_categories WHERE id = ?', [id]);
  await pool.query('DELETE FROM repair_notices WHERE customer_id = ?', [fxA.customerId]);
  await pool.query('DELETE FROM claims WHERE customer_id = ?', [fxA.customerId]);
  await cleanupCustomer(fxA.customerId);
  await dropShop(shopB.shopId);
  await pool.end();
});

async function makeQuotation(token, { customerName, plate }) {
  const res = await request(app).post('/api/quotations').set(as(token)).send({
    newCustomer: { customer_name: customerName, phone: '' },
    newVehicle: { brand: 'Toyota', model: 'Vios', license_plate: plate },
    quotation_date: today,
    items: [{ product_name: 'ลูกหมาก', quantity: 2, unit_price: 500 }],
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe('quotations', () => {
  let qA;
  let qB;

  test('numbers restart per shop and each shop sees only its own', async () => {
    qA = await makeQuotation(tokenA, { customerName: 'Iso2 QA', plate: 'ISO2-A' });
    qB = await makeQuotation(tokenB, { customerName: 'Iso2 QB', plate: 'ISO2-B' });
    cleanupA.quotations.push(qA.quotation_id);
    expect(qB.quotation_no).toMatch(/001$/); // first quotation of the day in a brand-new shop

    const listB = await request(app).get('/api/quotations').set(as(tokenB));
    expect(listB.body.data.map((q) => q.id)).toEqual([qB.quotation_id]);
    const listA = await request(app).get('/api/quotations').set(as(tokenA));
    expect(listA.body.data.some((q) => q.id === qB.quotation_id)).toBe(false);
  });

  test('the other shop gets 404 on every quotation action', async () => {
    const id = qA.quotation_id;
    const calls = [
      request(app).get(`/api/quotations/${id}`).set(as(tokenB)),
      request(app).put(`/api/quotations/${id}`).set(as(tokenB)).send({ customer_id: 1, quotation_date: today, items: [] }),
      request(app).patch(`/api/quotations/${id}/approve`).set(as(tokenB)),
      request(app).patch(`/api/quotations/${id}/close`).set(as(tokenB)).send({ payment_method: 'เงินสด' }),
      request(app).patch(`/api/quotations/${id}/reopen`).set(as(tokenB)),
      request(app).patch(`/api/quotations/${id}/schedule`).set(as(tokenB)).send({ scheduled_date: today }),
      request(app).patch(`/api/quotations/${id}/mark-called`).set(as(tokenB)),
      request(app).patch(`/api/quotations/${id}/no-date`).set(as(tokenB)).send({}),
      request(app).patch(`/api/quotations/${id}/mark-printed`).set(as(tokenB)),
      request(app).patch(`/api/quotations/${id}/undo-decline`).set(as(tokenB)),
      request(app).patch(`/api/quotations/${id}/signature`).set(as(tokenB)).send({ signature: 'data:image/png;base64,AAAA' }),
      request(app).patch(`/api/quotations/${id}/staff-signature`).set(as(tokenB)).send({ signature: 'data:image/png;base64,AAAA' }),
      request(app).delete(`/api/quotations/${id}`).set(as(tokenB)),
    ];
    const results = await Promise.all(calls);
    results.forEach((r, i) => expect({ i, status: r.status }).toEqual({ i, status: 404 }));
    const [[row]] = await pool.query('SELECT status, closed_at FROM quotations WHERE id = ?', [id]);
    expect(row.status).toBe('pending');
    expect(row.closed_at).toBeNull();
  });

  test('a quotation cannot point at another shop customer / vehicle / product', async () => {
    const withCustomer = await request(app).post('/api/quotations').set(as(tokenB)).send({
      customer_id: fxA.customerId, quotation_date: today, items: [],
    });
    expect(withCustomer.status).toBe(400);
    const withVehicle = await request(app).post('/api/quotations').set(as(tokenB)).send({
      newCustomer: { customer_name: 'Iso2 QB2', phone: '' }, vehicle_id: fxA.vehicleId, quotation_date: today, items: [],
    });
    expect(withVehicle.status).toBe(400);
  });

  test('approve + close inside a shop works and the receipt numbering is per shop', async () => {
    const approve = await request(app).patch(`/api/quotations/${qB.quotation_id}/approve`).set(as(tokenB));
    expect(approve.status).toBe(200);
    expect(approve.body.receipt_no).toMatch(/001$/);
    const [[receipt]] = await pool.query('SELECT shop_id, car_sequence_no FROM receipts WHERE id = ?', [approve.body.receipt_id]);
    expect(receipt.shop_id).toBe(shopB.shopId);
    expect(receipt.car_sequence_no).toBe(1); // new shops count cars from 1 (shop 1 continues from 1396)

    const close = await request(app).patch(`/api/quotations/${qB.quotation_id}/close`).set(as(tokenB)).send({ payment_method: 'เงินสด' });
    expect(close.status).toBe(200);
    expect((await request(app).get(`/api/receipts/${approve.body.receipt_id}`).set(as(tokenA))).status).toBe(404);
  });
});

describe('receipts', () => {
  let receiptB;

  test('a shop creates a receipt; the other shop cannot read, edit or delete it', async () => {
    const created = await request(app).post('/api/receipts').set(as(tokenB)).send({
      newCustomer: { customer_name: 'Iso2 RB', phone: '' },
      newVehicle: { brand: 'Honda', model: 'City' },
      receipt_date: today,
      items: [{ product_name_snapshot: 'ค่าแรง', qty: 1, price: 300 }],
    });
    expect(created.status).toBe(201);
    receiptB = created.body;
    expect(receiptB.receipt_no).toMatch(/00\d$/);

    const id = receiptB.receipt_id;
    const results = await Promise.all([
      request(app).get(`/api/receipts/${id}`).set(as(tokenA)),
      request(app).put(`/api/receipts/${id}`).set(as(tokenA)).send({
        customer_id: fxA.customerId, vehicle_id: fxA.vehicleId, receipt_date: today,
        items: [{ product_name_snapshot: 'x', qty: 1, price: 1 }],
      }),
      request(app).patch(`/api/receipts/${id}/meta`).set(as(tokenA)).send({ payment_method: 'เงินสด' }),
      request(app).patch(`/api/receipts/${id}/date`).set(as(tokenA)).send({ receipt_date: today }),
      request(app).patch(`/api/receipts/${id}/mark-printed`).set(as(tokenA)),
      request(app).delete(`/api/receipts/${id}`).set(as(tokenA)),
    ]);
    results.forEach((r, i) => expect({ i, status: r.status }).toEqual({ i, status: 404 }));
  });

  test('lists and summaries only count the caller shop', async () => {
    const list = await request(app).get('/api/receipts').set(as(tokenA));
    expect(list.body.data.some((r) => r.id === receiptB.receipt_id)).toBe(false);

    const byDateA = await request(app).get(`/api/receipts/by-date?date=${today}`).set(as(tokenA));
    expect(byDateA.body.data.some((r) => r.id === receiptB.receipt_id)).toBe(false);
    const byDateB = await request(app).get(`/api/receipts/by-date?date=${today}`).set(as(tokenB));
    expect(byDateB.body.data.some((r) => r.id === receiptB.receipt_id)).toBe(true);

    const dailyB = await request(app).get('/api/receipts/daily-summary').set(as(tokenB));
    const todayRow = dailyB.body.data.find((r) => String(r.date).slice(0, 10) === today);
    expect(Number(todayRow.total_revenue)).toBeGreaterThanOrEqual(300);
    const monthlyB = await request(app).get('/api/receipts/monthly-summary').set(as(tokenB));
    expect(monthlyB.status).toBe(200);
    const totalB = dailyB.body.data.reduce((s, r) => s + Number(r.total_revenue), 0);
    const [[truth]] = await pool.query('SELECT COALESCE(SUM(total_amount), 0) AS t FROM receipts WHERE shop_id = ?', [shopB.shopId]);
    expect(totalB).toBeCloseTo(Number(truth.t));

    for (const path of ['top-products', 'top-vehicle-models', 'top-customers']) {
      const r = await request(app).get(`/api/receipts/${path}`).set(as(tokenA));
      expect(r.status).toBe(200);
    }
    const customersSearch = await request(app).get('/api/receipts/customers?search=Iso2 RB').set(as(tokenA));
    expect(customersSearch.body.data).toEqual([]);
  });

  test('a receipt cannot use another shop customer, vehicle or service item', async () => {
    const res = await request(app).post('/api/receipts').set(as(tokenB)).send({
      customer_id: fxA.customerId, vehicle_id: fxA.vehicleId, receipt_date: today,
      items: [{ product_name_snapshot: 'x', qty: 1, price: 1 }],
    });
    expect(res.status).toBe(400);
  });
});

describe('jobs (queue)', () => {
  let jobA;
  let jobB;
  let fxB;

  test('each shop queues its own cars; job numbers and queue numbers are per shop', async () => {
    const a = await request(app).post('/api/jobs').set(as(tokenA)).send({ vehicle_id: fxA.vehicleId, customer_id: fxA.customerId });
    expect(a.status).toBe(201);
    jobA = a.body;
    cleanupA.jobs.push(jobA.id);

    const cust = await request(app).post('/api/customers').set(as(tokenB)).send({ customer_name: 'Iso2 JB' });
    const veh = await request(app).post('/api/vehicles').set(as(tokenB)).send({ customer_id: cust.body.data.id, brand: 'Mazda', model: '2' });
    fxB = { customerId: cust.body.data.id, vehicleId: veh.body.data.id };
    const b = await request(app).post('/api/jobs').set(as(tokenB)).send({ vehicle_id: fxB.vehicleId, customer_id: fxB.customerId });
    expect(b.status).toBe(201);
    jobB = b.body;
    expect(jobB.job_no).toMatch(/001$/);
    expect(jobB.queue_no).toBe('1');
  });

  test('the other shop cannot see or touch a job', async () => {
    const id = jobA.id;
    const results = await Promise.all([
      request(app).get(`/api/jobs/${id}`).set(as(tokenB)),
      request(app).patch(`/api/jobs/${id}`).set(as(tokenB)).send({ symptom: 'HACKED' }),
      request(app).patch(`/api/jobs/${id}/status`).set(as(tokenB)).send({ status: 'inspecting' }),
      request(app).patch(`/api/jobs/${id}/mark-worksheet-printed`).set(as(tokenB)),
      request(app).post(`/api/jobs/${id}/photos`).set(as(tokenB)).send({ photos: ['data:image/png;base64,AAAA'] }),
      request(app).patch(`/api/jobs/${id}/quote-draft`).set(as(tokenB)).send({ items: [{ product_name: 'x', quantity: 1, unit_price: 1 }] }),
      request(app).post(`/api/jobs/${id}/quotation/approve`).set(as(tokenB)),
      request(app).delete(`/api/jobs/${id}`).set(as(tokenB)),
    ]);
    results.forEach((r, i) => expect({ i, status: r.status }).toEqual({ i, status: 404 }));

    const listB = await request(app).get(`/api/jobs?date=${today}`).set(as(tokenB));
    expect(listB.body.data.map((j) => j.id)).toEqual([jobB.id]);
    const pendingB = await request(app).get('/api/jobs/pending-delivery').set(as(tokenB));
    expect(pendingB.body.data.some((j) => j.id === jobA.id)).toBe(false);
    const baysB = await request(app).get('/api/jobs/bays').set(as(tokenB));
    expect(baysB.body.data.some((j) => j.id === jobA.id)).toBe(false);
    const [[row]] = await pool.query('SELECT symptom, status FROM jobs WHERE id = ?', [id]);
    expect(row.symptom).not.toBe('HACKED');
    expect(row.status).toBe('received');
  });

  test('a job cannot be created for another shop vehicle', async () => {
    const res = await request(app).post('/api/jobs').set(as(tokenB)).send({ vehicle_id: fxA.vehicleId, customer_id: fxA.customerId });
    expect(res.status).toBe(404);
  });

  test('moving jobs to another day only moves the caller shop jobs', async () => {
    const res = await request(app).patch('/api/jobs/move-date').set(as(tokenB)).send({ ids: [jobA.id], job_date: today });
    expect(res.status).toBe(404);
  });

  test('the public board and tracking page are scoped by ?shop=', async () => {
    const [[shop]] = await pool.query('SELECT code FROM shops WHERE id = ?', [shopB.shopId]);
    const boardB = await request(app).get(`/api/board?shop=${shop.code}`);
    expect(boardB.body.data.map((j) => j.id)).toEqual([jobB.id]);
    const boardDefault = await request(app).get('/api/board');
    expect(boardDefault.body.data.some((j) => j.id === jobB.id)).toBe(false);
    expect((await request(app).get('/api/board?shop=no-such-shop')).status).toBe(404);

    // tracking needs plate + phone: shop B's customer has no phone, so use a throwaway one
    await pool.query("UPDATE customers SET phone = '081-234-5678' WHERE id = ?", [fxB.customerId]);
    await pool.query("UPDATE vehicles SET license_plate = 'ISOTRK-1' WHERE id = ?", [fxB.vehicleId]);
    const trackB = await request(app).get(`/api/track?plate=ISOTRK-1&phone_last4=5678&shop=${shop.code}`);
    expect(trackB.status).toBe(200);
    const trackWrongShop = await request(app).get('/api/track?plate=ISOTRK-1&phone_last4=5678');
    expect(trackWrongShop.status).toBe(404);
  });
});

describe('stock (combined stock is per shop)', () => {
  let catA;
  let catB;
  let itemA;
  let itemB;

  test('same category name and OEM code can exist in both shops', async () => {
    const name = `ISO2-CAT-${Date.now().toString(36)}`;
    const a = await request(app).post('/api/stock-items/categories').set(as(tokenA)).send({ name });
    const b = await request(app).post('/api/stock-items/categories').set(as(tokenB)).send({ name });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    catA = a.body.id;
    catB = b.body.id;
    cleanupA.stockCategories.push(catA);

    const ia = await request(app).post('/api/stock-items').set(as(tokenA)).send({ category_id: catA, oem_code: 'ISO2-1', description: 'A item', stock_qty: 5 });
    const ib = await request(app).post('/api/stock-items').set(as(tokenB)).send({ category_id: catB, oem_code: 'ISO2-1', description: 'B item', stock_qty: 7 });
    expect(ia.status).toBe(201);
    expect(ib.status).toBe(201);
    itemA = ia.body.id;
    itemB = ib.body.id;
    cleanupA.stockItems.push(itemA);
  });

  test('categories, items, adjustments and history do not cross shops', async () => {
    const catsB = await request(app).get('/api/stock-items/categories').set(as(tokenB));
    expect(catsB.body.map((c) => c.id)).toEqual([catB]);
    const itemsB = await request(app).get('/api/stock-items').set(as(tokenB));
    expect(itemsB.body.map((i) => i.id)).toEqual([itemB]);
    const itemsA = await request(app).get('/api/stock-items?q=ISO2-1').set(as(tokenA));
    expect(itemsA.body.map((i) => i.id)).toEqual([itemA]);

    const results = await Promise.all([
      request(app).patch(`/api/stock-items/${itemA}/qty`).set(as(tokenB)).send({ delta: 5 }),
      request(app).put(`/api/stock-items/${itemA}`).set(as(tokenB)).send({ category_id: catB, oem_code: 'X', min_stock: 1 }),
      request(app).get(`/api/stock-items/${itemA}/movements`).set(as(tokenB)),
      request(app).delete(`/api/stock-items/${itemA}`).set(as(tokenB)),
      request(app).put(`/api/stock-items/categories/${catA}`).set(as(tokenB)).send({ name: 'HACKED' }),
    ]);
    expect(results[0].status).toBe(404);
    expect(results[1].status).toBe(404);
    expect(results[2].body).toEqual([]); // movements of someone else's item: nothing
    expect(results[3].status).toBe(404);
    expect(results[4].status).toBe(404);
    const [[row]] = await pool.query('SELECT stock_qty, is_active FROM stock_items WHERE id = ?', [itemA]);
    expect(row.stock_qty).toBe(5);
    expect(row.is_active).toBe(1);

    // an item cannot be filed under the other shop's category
    const cross = await request(app).post('/api/stock-items').set(as(tokenB)).send({ category_id: catA, oem_code: 'ISO2-2', description: 'x' });
    expect(cross.status).toBe(404);
  });

  test('deducting and receiving only touch the caller shop stock', async () => {
    const deduct = await request(app).post('/api/stock-deductions').set(as(tokenB)).send({ item_id: itemA, lines: [{ qty: 1 }] });
    expect(deduct.status).toBe(404);
    const ok = await request(app).post('/api/stock-deductions').set(as(tokenB)).send({ item_id: itemB, lines: [{ qty: 2 }] });
    expect(ok.status).toBe(201);
    expect(ok.body.stock_qty).toBe(5);
    const [[a]] = await pool.query('SELECT stock_qty FROM stock_items WHERE id = ?', [itemA]);
    expect(a.stock_qty).toBe(5);

    const lookup = await request(app).get('/api/stock-receive/lookup?code=ISO2-1').set(as(tokenB));
    expect(lookup.body.matches.map((m) => m.item_id)).toEqual([itemB]);
    const search = await request(app).get('/api/stock-receive/search?q=ISO2').set(as(tokenB));
    expect(search.body.matches.every((m) => m.item_id === itemB)).toBe(true);

    // receipt sessions (bills for receiving stock)
    const sessionA = await request(app).post('/api/transactions/receipt-session').set(as(tokenA)).send({ invoice_no: 'ISO2-INV-A' });
    expect(sessionA.status).toBe(201);
    const sessionB = await request(app).post('/api/transactions/receipt-session').set(as(tokenB)).send({ invoice_no: 'ISO2-INV-B' });
    const sessionsB = await request(app).get('/api/transactions/receipt-sessions').set(as(tokenB));
    expect(sessionsB.body.map((s) => s.id)).toEqual([sessionB.body.id]);
    expect((await request(app).get(`/api/transactions/receipt-sessions/${sessionA.body.id}`).set(as(tokenB))).status).toBe(404);
    expect((await request(app).delete(`/api/transactions/receipt-sessions/${sessionA.body.id}`).set(as(tokenB))).status).toBe(404);
    const lineOnForeign = await request(app).post('/api/stock-receive/lines').set(as(tokenB)).send({ item_id: itemB, qty: 1, receipt_session_id: sessionA.body.id });
    expect(lineOnForeign.status).toBe(404);
    const lineForeignItem = await request(app).post('/api/stock-receive/lines').set(as(tokenB)).send({ item_id: itemA, qty: 1, receipt_session_id: sessionB.body.id });
    expect(lineForeignItem.status).toBe(404);
    await pool.query('DELETE FROM receipt_sessions WHERE id = ?', [sessionA.body.id]);
  });
});

describe('claims, repair notices, catalogues', () => {
  test('claims', async () => {
    const mk = await request(app).post('/api/claims').set(as(tokenA)).send({ customer_id: fxA.customerId, vehicle_id: fxA.vehicleId, items: [{ product_name: 'x' }] });
    expect(mk.status).toBe(201);
    const id = mk.body.id;
    expect((await request(app).get(`/api/claims/${id}`).set(as(tokenB))).status).toBe(404);
    expect((await request(app).put(`/api/claims/${id}`).set(as(tokenB)).send({ customer_id: fxA.customerId, vehicle_id: fxA.vehicleId })).status).toBe(404);
    expect((await request(app).delete(`/api/claims/${id}`).set(as(tokenB))).status).toBe(404);
    expect((await request(app).get('/api/claims').set(as(tokenB))).body.data).toEqual([]);
    // shop B cannot file a claim against shop A's customer
    expect((await request(app).post('/api/claims').set(as(tokenB)).send({ customer_id: fxA.customerId, vehicle_id: fxA.vehicleId })).status).toBe(404);
    // claim numbers restart per shop
    const next = await request(app).get('/api/claims/next-code').set(as(tokenB));
    expect(next.body.claim_no).toMatch(/-001$/);
  });

  test('repair notices', async () => {
    const mk = await request(app).post('/api/repair-notices').set(as(tokenA)).send({ vehicle_id: fxA.vehicleId, customer_id: fxA.customerId, checklist: {} });
    expect(mk.status).toBe(201);
    const id = mk.body.id;
    expect((await request(app).get(`/api/repair-notices/${id}`).set(as(tokenB))).status).toBe(404);
    expect((await request(app).put(`/api/repair-notices/${id}`).set(as(tokenB)).send({ vehicle_id: fxA.vehicleId, checklist: {} })).status).toBe(404);
    expect((await request(app).delete(`/api/repair-notices/${id}`).set(as(tokenB))).status).toBe(404);
    expect((await request(app).post('/api/repair-notices').set(as(tokenB)).send({ vehicle_id: fxA.vehicleId, checklist: {} })).status).toBe(404);
    const listB = await request(app).get('/api/repair-notices').set(as(tokenB));
    expect(listB.body.data.some((r) => r.id === id)).toBe(false);
    const search = await request(app).get('/api/repair-notices/vehicle-search?search=ISO2').set(as(tokenB));
    expect(search.body.data.some((r) => r.customer_id === fxA.customerId)).toBe(false);
    // shop B already has one notice (auto-created with its quotation); the counter is its own, not shop 1's
    const [[maxB]] = await pool.query("SELECT COUNT(*) AS n FROM repair_notices WHERE shop_id = ?", [shopB.shopId]);
    const nextB = await request(app).get('/api/repair-notices/next-code').set(as(tokenB));
    expect(nextB.body.code).toBe('RN-' + String(maxB.n + 1).padStart(4, '0'));
  });

  test('service items, quote part prices, product costs', async () => {
    const si = await request(app).post('/api/service-items').set(as(tokenA)).send({ category: 'ISO2', product_name: 'ISO2 item' });
    expect(si.status).toBe(201);
    const siId = si.body.data.id;
    expect((await request(app).get('/api/service-items?search=ISO2').set(as(tokenB))).body.data).toEqual([]);
    expect((await request(app).put(`/api/service-items/${siId}`).set(as(tokenB)).send({ category: 'x', product_name: 'x' })).status).toBe(404);
    expect((await request(app).get(`/api/service-items/${siId}/components`).set(as(tokenB))).body.data).toEqual([]);
    expect((await request(app).delete(`/api/service-items/${siId}`).set(as(tokenB))).status).toBe(404);
    await pool.query('DELETE FROM service_items WHERE id = ?', [siId]);

    const pc = await request(app).post('/api/product-costs').set(as(tokenA)).send({ items: [{ parts: 'ISO2', description: 'ISO2 cost', price: 5 }] });
    const pcId = pc.body.ids[0];
    expect((await request(app).get('/api/product-costs?search=ISO2').set(as(tokenB))).body.data).toEqual([]);
    await request(app).put(`/api/product-costs/${pcId}`).set(as(tokenB)).send({ parts: 'HACKED', description: 'HACKED' });
    await request(app).delete(`/api/product-costs/${pcId}`).set(as(tokenB));
    await request(app).delete('/api/product-costs').set(as(tokenB)).send({ ids: [pcId] });
    const [[still]] = await pool.query('SELECT parts FROM products WHERE id = ?', [pcId]);
    expect(still.parts).toBe('ISO2');
    await pool.query('DELETE FROM products WHERE id = ?', [pcId]);
  });
});

describe('LINE bot stays on shop 1', () => {
  test('the bot never reads or writes another shop rows', async () => {
    const lineRouter = require('../src/routes/lineWebhook.routes');
    const before = (await pool.query('SELECT COUNT(*) AS n FROM quotations WHERE shop_id = ?', [shopB.shopId]))[0][0].n;
    expect(await lineRouter.getSetting('line_group_id', shopB.shopId)).toBeNull();
    await lineRouter.setSetting('tenant_test_key', 'x', shopB.shopId);
    expect(await lineRouter.getSetting('tenant_test_key')).toBeNull(); // shop 1 does not see it
    expect(await lineRouter.getSetting('tenant_test_key', shopB.shopId)).toBe('x');
    const after = (await pool.query('SELECT COUNT(*) AS n FROM quotations WHERE shop_id = ?', [shopB.shopId]))[0][0].n;
    expect(after).toBe(before);
  });
});
