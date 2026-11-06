const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getManagerToken, getTechnicianToken } = require('./helpers');

const app = createApp();

describe('/api/stock-receive/batch — continuous scanning: sort the codes, then put them on the bill', () => {
  let officeToken;
  let techToken;
  let categoryId;
  const suffix = Date.now().toString(36).toUpperCase();
  const code = (text) => `${text}${suffix}`;
  const sessionIds = [];

  const asOffice = (req) => req.set('Authorization', `Bearer ${officeToken}`);
  const asTech = (req) => req.set('Authorization', `Bearer ${techToken}`);
  const resolve = (codes, as = asOffice) => as(request(app).post('/api/stock-receive/batch/resolve')).send({ codes });
  const apply = (body, as = asOffice) => as(request(app).post('/api/stock-receive/batch/apply')).send(body);

  beforeAll(async () => {
    officeToken = await getManagerToken();
    techToken = await getTechnicianToken();
    const cat = await asOffice(request(app).post('/api/stock-items/categories')).send({ name: `BATCH-CAT-${suffix}` });
    categoryId = cat.body.id;
  });

  afterAll(async () => {
    const [items] = await pool.query('SELECT id FROM stock_items WHERE category_id = ?', [categoryId]);
    const itemIds = items.map((row) => row.id);
    if (sessionIds.length) {
      await pool.query('DELETE FROM stock_receive_lines WHERE receipt_session_id IN (?)', [sessionIds]);
      await pool.query('UPDATE stock_items SET created_in_session_id = NULL WHERE created_in_session_id IN (?)', [sessionIds]);
    }
    if (itemIds.length) {
      await pool.query('DELETE FROM stock_receive_lines WHERE item_id IN (?)', [itemIds]);
      await pool.query('DELETE FROM stock_item_movements WHERE item_id IN (?)', [itemIds]);
      await pool.query('DELETE FROM stock_items WHERE id IN (?)', [itemIds]);
    }
    if (sessionIds.length) await pool.query('DELETE FROM receipt_sessions WHERE id IN (?)', [sessionIds]);
    await pool.execute('DELETE FROM stock_categories WHERE id = ?', [categoryId]);
  });

  async function createItem(extra) {
    const res = await asOffice(request(app).post('/api/stock-items')).send({
      category_id: categoryId, description: 'ทดสอบสแกนต่อเนื่อง', ...extra,
    });
    expect(res.body.id).toBeTruthy();
    return res.body.id;
  }

  async function openSession() {
    const res = await asOffice(request(app).post('/api/transactions/receipt-session')).send({ invoice_no: `BATCH-${suffix}-${sessionIds.length}` });
    sessionIds.push(res.body.id);
    return res.body.id;
  }

  const stockOf = async (itemId) => {
    const [[row]] = await pool.query('SELECT stock_qty FROM stock_items WHERE id = ?', [itemId]);
    return row.stock_qty;
  };

  test('resolve: sorts known codes, new pairs and new singles, and saves nothing', async () => {
    const plain = await createItem({ oem_code: code('PLAIN-'), stock_qty: 1 });
    const sided = await createItem({
      has_sides: true, codes: { left: code('SIDE-L'), right: code('SIDE-R') }, stocks: { left: 1, right: 1 },
    });
    const newLeft = code('NEW-1L-');
    const newRight = code('NEW-1R-');
    const res = await resolve([code('PLAIN-').toLowerCase(), code('SIDE-R'), newLeft, newRight, code('LONE-')]);

    expect(res.status).toBe(200);
    expect(res.body.known.map((k) => [k.match.item_id, k.match.position])).toEqual([[plain, null], [sided, 'right']]);
    expect(res.body.pairs).toEqual([{ left: newLeft, right: newRight }]);
    expect(res.body.singles.map((s) => s.code)).toEqual([code('LONE-')]);
    const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM stock_items WHERE oem_code = ?', [newLeft]);
    expect(row.n).toBe(0);
  });

  test('resolve: a code written differently is offered, never matched automatically', async () => {
    const itemId = await createItem({ oem_code: `AB-12-${suffix}`, stock_qty: 0 });
    const res = await resolve([`AB12${suffix}`]);
    expect(res.body.known).toEqual([]);
    expect(res.body.singles).toEqual([]);
    expect(res.body.choose).toHaveLength(1);
    expect(res.body.choose[0]).toMatchObject({ code: `AB12${suffix}`, loose: true });
    expect(res.body.choose[0].matches[0].item_id).toBe(itemId);
  });

  test('resolve: a code used by two items in different categories must be chosen', async () => {
    const shared = code('SHARED-');
    await createItem({ oem_code: shared });
    const other = await asOffice(request(app).post('/api/stock-items/categories')).send({ name: `BATCH-CAT2-${suffix}` });
    const otherItem = await asOffice(request(app).post('/api/stock-items')).send({ category_id: other.body.id, oem_code: shared });
    const res = await resolve([shared]);
    expect(res.body.choose[0]).toMatchObject({ code: shared, loose: false });
    expect(res.body.choose[0].matches).toHaveLength(2);
    await pool.execute('DELETE FROM stock_items WHERE id = ?', [otherItem.body.id]);
    await pool.execute('DELETE FROM stock_categories WHERE id = ?', [other.body.id]);
  });

  test('resolve: a new code joins its other side when that side is blank, else it only says the other side exists', async () => {
    const leftCode = `ATT-${suffix}-L`;
    const rightCode = `ATT-${suffix}-R`;
    const sided = await createItem({ has_sides: true, codes: { left: leftCode, right: '' }, stocks: { left: 1, right: 0 } });
    const attached = await resolve([rightCode]);
    expect(attached.body.attach).toEqual([expect.objectContaining({
      code: rightCode, item_id: sided, position: 'right', partner_code: leftCode,
    })]);

    const plainLeft = `SEP-${suffix}-L`;
    await createItem({ oem_code: plainLeft });
    const separate = await resolve([`SEP-${suffix}-R`]);
    expect(separate.body.attach).toEqual([]);
    expect(separate.body.singles[0]).toMatchObject({ code: `SEP-${suffix}-R`, side: 'right', partner: { code: plainLeft } });
  });

  test('resolve: validates the request and sets aside what cannot be a code', async () => {
    expect((await resolve('x')).status).toBe(400);
    expect((await resolve([])).status).toBe(400);
    expect((await resolve(Array(201).fill('x'))).status).toBe(400);
    const tooLong = 'x'.repeat(101);
    const res = await resolve([tooLong]);
    expect(res.status).toBe(200);
    expect(res.body.invalid).toEqual([tooLong.slice(0, 100)]);
  });

  test('apply: puts everything on the bill as pending, and the bill confirms it as before', async () => {
    const plain = await createItem({ oem_code: code('APL-PLAIN-'), stock_qty: 5 });
    const left = `APL-${suffix}-L`;
    const right = `APL-${suffix}-R`;
    const blankLeft = `BLK-${suffix}-L`;
    const blankRight = `BLK-${suffix}-R`;
    const blank = await createItem({ has_sides: true, codes: { left: blankLeft, right: '' }, stocks: { left: 0, right: 0 } });
    const sessionId = await openSession();

    const res = await apply({
      receipt_session_id: sessionId,
      known: [{ item_id: plain, position: null, qty: 2 }],
      attach: [{ item_id: blank, position: 'right', code: blankRight, qty: 1 }],
      new_items: [
        { category_id: categoryId, description: 'คู่ใหม่', has_sides: true, codes: { left, right }, qtys: { left: 3, right: 2 }, unit_cost: 500 },
        { category_id: categoryId, oem_code: code('APL-ONE-'), qty: 4 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    expect(res.body.lines).toHaveLength(5);
    expect(res.body.lines.find((l) => l.code === left)).toMatchObject({ position: 'left', qty: 3, unit_cost: 500 });
    expect(res.body.lines.find((l) => l.code === right)).toMatchObject({ position: 'right', qty: 2 });
    expect(await stockOf(plain)).toBe(5);

    // the pair is one item with both sides, and scanning either side finds it now
    const lookup = await asOffice(request(app).get('/api/stock-receive/lookup')).query({ code: right });
    expect(lookup.body.matches[0].position).toBe('right');
    expect(lookup.body.matches[0].item_id).toBe(res.body.lines.find((l) => l.code === left).item_id);
    const filled = await asOffice(request(app).get('/api/stock-receive/lookup')).query({ code: blankRight });
    expect(filled.body.matches[0]).toMatchObject({ item_id: blank, position: 'right' });

    const commit = await asOffice(request(app).post(`/api/stock-receive/sessions/${sessionId}/commit`));
    expect(commit.body).toMatchObject({ applied: 5, total_qty: 12 });
    expect(await stockOf(plain)).toBe(7);
  });

  test('apply: merges with a pending line already on the bill', async () => {
    const itemId = await createItem({ oem_code: code('MRG-') });
    const sessionId = await openSession();
    await asOffice(request(app).post('/api/stock-receive/lines')).send({ item_id: itemId, position: null, qty: 1, receipt_session_id: sessionId });
    const res = await apply({ receipt_session_id: sessionId, known: [{ item_id: itemId, position: null, qty: 2 }] });
    expect(res.status).toBe(201);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].qty).toBe(3);
  });

  test('apply: one bad row leaves nothing behind', async () => {
    const itemId = await createItem({ oem_code: code('RBK-') });
    const sided = await createItem({ has_sides: true, codes: { left: code('RBK-L-'), right: code('RBK-R-') }, stocks: { left: 0, right: 0 } });
    const sessionId = await openSession();
    const fresh = code('RBK-NEW-');
    const res = await apply({
      receipt_session_id: sessionId,
      known: [{ item_id: itemId, position: null, qty: 1 }, { item_id: sided, position: 'front', qty: 1 }],
      new_items: [{ category_id: categoryId, oem_code: fresh, qty: 1 }],
    });
    expect(res.status).toBe(400);
    const [[lines]] = await pool.query('SELECT COUNT(*) AS n FROM stock_receive_lines WHERE receipt_session_id = ?', [sessionId]);
    expect(lines.n).toBe(0);
    const [[items]] = await pool.query('SELECT COUNT(*) AS n FROM stock_items WHERE oem_code = ?', [fresh]);
    expect(items.n).toBe(0);
  });

  test('apply: refuses a code already in stock, one code entered twice, and a filled position', async () => {
    const taken = code('TKN-');
    await createItem({ oem_code: taken });
    const sessionId = await openSession();
    const exists = await apply({ receipt_session_id: sessionId, new_items: [{ category_id: categoryId, oem_code: taken, qty: 1 }] });
    expect(exists.status).toBe(409);
    expect(exists.body.code).toBe('CODE_EXISTS');

    const twice = await apply({
      receipt_session_id: sessionId,
      new_items: [{ category_id: categoryId, oem_code: code('TWC-'), qty: 1 }, { category_id: categoryId, oem_code: code('twc-').toUpperCase(), qty: 1 }],
    });
    expect(twice.status).toBe(400);

    const filledLeft = code('FIL-L-');
    const filledRight = code('FIL-R-');
    const filled = await createItem({ has_sides: true, codes: { left: filledLeft, right: filledRight }, stocks: { left: 0, right: 0 } });
    const full = await apply({ receipt_session_id: sessionId, attach: [{ item_id: filled, position: 'right', code: code('FIL-X-'), qty: 1 }] });
    expect(full.status).toBe(409);
    const lookup = await asOffice(request(app).get('/api/stock-receive/lookup')).query({ code: filledRight });
    expect(lookup.body.matches[0].position).toBe('right');
  });

  test('apply: validates the request, and only office staff can apply', async () => {
    const itemId = await createItem({ oem_code: code('VLD-') });
    const sessionId = await openSession();
    expect((await apply({ receipt_session_id: sessionId })).status).toBe(400);
    expect((await apply({ known: [{ item_id: itemId, position: null, qty: 1 }] })).status).toBe(400);
    expect((await apply({ receipt_session_id: sessionId, known: [{ item_id: itemId, qty: 0 }] })).status).toBe(400);
    expect((await apply({ receipt_session_id: sessionId, attach: [{ item_id: itemId, qty: 1 }] })).status).toBe(400);
    expect((await apply({ receipt_session_id: sessionId, new_items: [{ category_id: categoryId, qty: 1 }] })).status).toBe(400);
    expect((await apply({ receipt_session_id: 999999999, known: [{ item_id: itemId, position: null, qty: 1 }] })).status).toBe(404);
    expect((await apply({ receipt_session_id: sessionId, known: [{ item_id: itemId, position: null, qty: 1 }] }, asTech)).status).toBe(403);
  });
});
