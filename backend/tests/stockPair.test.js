const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, getManagerToken, getTechnicianToken } = require('./helpers');
const { suggestPairs, withoutSideWords, sideInDescription } = require('../src/utils/stockPair');

const app = createApp();

describe('suggesting pairs', () => {
  const row = (id, oem_code, description, category_id = 1) => ({ id, category_id, oem_code, description });

  test('by the code, then by a description that differs only by the side', () => {
    const pairs = suggestPairs([
      row(1, 'JET-1L', ''), row(2, 'JET-1R', ''),
      row(3, 'A100', 'ปีกนก VIGO ซ้าย'), row(4, 'B200', 'ปีกนก VIGO ขวา'),
      row(5, 'C300', 'โช้ค VIGO'),
    ]);
    expect(pairs.map((p) => [p.left.id, p.right.id, p.reason])).toEqual([[1, 2, 'code'], [3, 4, 'description']]);
  });
  test('never across categories, and never a guess between several candidates', () => {
    expect(suggestPairs([row(1, 'X-1L', '', 1), row(2, 'X-1R', '', 2)])).toEqual([]);
    expect(suggestPairs([row(1, 'A', 'ปีกนก ซ้าย'), row(2, 'B', 'ปีกนก ซ้าย'), row(3, 'C', 'ปีกนก ขวา')])).toEqual([]);
  });
  test('reading a side out of a description', () => {
    expect(withoutSideWords('ปีกนกล่าง ข้างซ้าย VIGO')).toBe('ปีกนกล่าง VIGO');
    expect(withoutSideWords('ลูกหมาก RH')).toBe('ลูกหมาก');
    expect(sideInDescription('ปีกนก ขวา')).toBe('right');
    expect(sideInDescription('ปีกนก LH')).toBe('left');
    expect(sideInDescription('ปีกนก ซ้าย/ขวา')).toBeNull();
    expect(sideInDescription('ปีกนก')).toBeNull();
  });
});

describe('/api/stock-items pairs', () => {
  let officeToken;
  let managerToken;
  let techToken;
  let categoryId;
  const suffix = Date.now().toString(36).toUpperCase();
  const sessionIds = [];
  let counter = 0;

  const as = (req, token = officeToken) => req.set('Authorization', `Bearer ${token}`);
  const pair = (body, token) => as(request(app).post('/api/stock-items/pairs'), token).send(body);
  const unpair = (id, token) => as(request(app).post(`/api/stock-items/${id}/unpair`), token);

  async function makeItem(code, qty, extra = {}) {
    const res = await as(request(app).post('/api/stock-items'), managerToken).send({
      category_id: categoryId, oem_code: `${code}-${suffix}`, description: `ทดสอบ ${code}`, stock_qty: qty, ...extra,
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }
  async function makePair(qtyLeft = 3, qtyRight = 2) {
    counter += 1;
    const left = await makeItem(`P${counter}L`, qtyLeft);
    const right = await makeItem(`P${counter}R`, qtyRight);
    return { left, right, leftCode: `P${counter}L-${suffix}`, rightCode: `P${counter}R-${suffix}` };
  }
  const row = async (id) => {
    const [[r]] = await pool.query('SELECT * FROM stock_items WHERE id = ?', [id]);
    return r;
  };
  const positions = async (id) => {
    const [rows] = await pool.query('SELECT position, qty, oem_code FROM stock_item_positions WHERE item_id = ? ORDER BY position', [id]);
    return rows;
  };
  const lookup = (code) => as(request(app).get('/api/stock-receive/lookup')).query({ code });

  beforeAll(async () => {
    officeToken = await getOfficeToken();
    managerToken = await getManagerToken();
    techToken = await getTechnicianToken();
    const cat = await as(request(app).post('/api/stock-items/categories'), managerToken).send({ name: `PAIR-CAT-${suffix}` });
    categoryId = cat.body.id;
  });

  afterAll(async () => {
    const [items] = await pool.query('SELECT id FROM stock_items WHERE category_id = ?', [categoryId]);
    const ids = items.map((r) => r.id);
    if (ids.length) {
      await pool.query('DELETE FROM stock_receive_lines WHERE item_id IN (?)', [ids]);
      await pool.query('DELETE FROM stock_item_movements WHERE item_id IN (?)', [ids]);
      await pool.query('UPDATE stock_items SET merged_into_id = NULL WHERE id IN (?)', [ids]);
      await pool.query('DELETE FROM stock_items WHERE id IN (?)', [ids]);
    }
    if (sessionIds.length) await pool.query('DELETE FROM receipt_sessions WHERE id IN (?)', [sessionIds]);
    await pool.query('DELETE FROM stock_categories WHERE id = ?', [categoryId]);
  });

  test('two items become one left/right item, with every piece and both codes', async () => {
    const { left, right, leftCode, rightCode } = await makePair(3, 2);
    const res = await pair({ left_id: left, right_id: right, description: 'ปีกนก VIGO' });
    expect(res.status).toBe(200);
    expect(res.body.item_id).toBe(left);

    const item = await row(left);
    expect(item).toMatchObject({ has_sides: 1, stock_qty: 5, description: 'ปีกนก VIGO', is_active: 1 });
    expect(await positions(left)).toEqual([
      { position: 'left', qty: 3, oem_code: leftCode },
      { position: 'right', qty: 2, oem_code: rightCode },
    ]);
    expect(await row(right)).toMatchObject({ is_active: 0, stock_qty: 0, merged_into_id: left });

    const scan = await lookup(rightCode);
    expect(scan.body.matches).toHaveLength(1);
    expect(scan.body.matches[0]).toMatchObject({ item_id: left, position: 'right', qty: 2 });

    const list = await as(request(app).get('/api/stock-items')).query({ q: leftCode });
    expect(list.body[0]).toMatchObject({ id: left, paired_from_id: right });
  });

  test('history and bill lines move with their side, and an open bill still confirms', async () => {
    const { left, right } = await makePair(1, 1);
    const session = await as(request(app).post('/api/transactions/receipt-session')).send({ invoice_no: `PAIR-${suffix}-${counter}` });
    sessionIds.push(session.body.id);
    await as(request(app).post('/api/stock-receive/lines')).send({ item_id: right, position: null, qty: 4, unit_cost: 100, receipt_session_id: session.body.id });
    await as(request(app).post('/api/stock-receive/lines')).send({ item_id: left, position: null, qty: 2, unit_cost: 200, receipt_session_id: session.body.id });

    expect((await pair({ left_id: left, right_id: right, description: 'x' })).status).toBe(200);
    const [moves] = await pool.query('SELECT position, qty_after FROM stock_item_movements WHERE item_id = ? ORDER BY position', [left]);
    expect(moves).toEqual([{ position: 'left', qty_after: 1 }, { position: 'right', qty_after: 1 }]);

    const commit = await as(request(app).post(`/api/stock-receive/sessions/${session.body.id}/commit`));
    expect(commit.status).toBe(200);
    expect((await positions(left)).map((p) => p.qty)).toEqual([3, 5]);
    expect((await row(left)).stock_qty).toBe(8);
    expect(Number((await row(left)).avg_cost)).toBe(133.33);

    // a deduction now asks for a side and takes it from that side
    const none = await as(request(app).post('/api/stock-deductions')).send({ item_id: left, lines: [{ position: null, qty: 1 }] });
    expect(none.status).toBe(400);
    const out = await as(request(app).post('/api/stock-deductions')).send({ item_id: left, lines: [{ position: 'right', qty: 1 }] });
    expect(out.status).toBe(201);
    expect((await positions(left)).map((p) => p.qty)).toEqual([3, 4]);
  });

  test('the undo gives back two items with what each side holds now, and their own history', async () => {
    const { left, right, leftCode, rightCode } = await makePair(3, 2);
    await pair({ left_id: left, right_id: right, description: 'ชื่อใหม่' });
    await as(request(app).post('/api/stock-deductions')).send({ item_id: left, lines: [{ position: 'right', qty: 1 }] });

    const res = await unpair(left);
    expect(res.status).toBe(200);
    expect(await row(left)).toMatchObject({ has_sides: 0, stock_qty: 3, oem_code: leftCode, description: `ทดสอบ ${leftCode.split('-')[0]}`, pre_pair_description: null });
    expect(await row(right)).toMatchObject({ is_active: 1, stock_qty: 1, oem_code: rightCode, merged_into_id: null });
    expect(await positions(left)).toEqual([]);
    const [rightMoves] = await pool.query('SELECT position FROM stock_item_movements WHERE item_id = ?', [right]);
    expect(rightMoves.length).toBeGreaterThanOrEqual(2);
    expect(rightMoves.every((m) => m.position === null)).toBe(true);
    expect((await lookup(rightCode)).body.matches[0]).toMatchObject({ item_id: right, position: null, qty: 1 });

    expect((await unpair(left)).status).toBe(400);
  });

  test('car models of both sides are kept once each, and the manual cost is not lost', async () => {
    const fit = { brand: 'TOYOTA', model: 'VIGO', year_from: 2005, year_to: 2010 };
    const left = await makeItem('FITL', 0, { fitments: [fit] });
    const right = await makeItem('FITR', 0, { fitments: [fit, { brand: 'TOYOTA', model: 'REVO', year_from: 2015, year_to: 2020 }] });
    await pool.query('UPDATE stock_items SET manual_cost = 500 WHERE id = ?', [right]);
    expect((await pair({ left_id: left, right_id: right, description: 'x' })).status).toBe(200);
    const [fits] = await pool.query('SELECT model FROM stock_item_fitments WHERE item_id = ? ORDER BY model', [left]);
    expect(fits.map((f) => f.model)).toEqual(['REVO', 'VIGO']);
    expect(Number((await row(left)).avg_cost)).toBe(500);
  });

  test('a code joined into a pair cannot come back as a separate item by being added again', async () => {
    const { left, right, rightCode } = await makePair(1, 1);
    await pair({ left_id: left, right_id: right, description: 'x' });
    const res = await as(request(app).post('/api/stock-items'), managerToken).send({ category_id: categoryId, oem_code: rightCode, description: 'ซ้ำ', stock_qty: 9 });
    expect(res.status).toBe(409);
    expect(await row(right)).toMatchObject({ is_active: 0, merged_into_id: left });
    expect((await positions(left)).map((p) => p.qty)).toEqual([1, 1]);
  });

  test('suggestions offer plain items only, and an item leaves the list once joined', async () => {
    const code = `SUG${suffix}`;
    const left = await makeItem(`${code}-L`, 1, { oem_code: `${code}-L` });
    const right = await makeItem(`${code}-R`, 1, { oem_code: `${code}-R` });
    const list = async () => (await as(request(app).get('/api/stock-items/pair-suggestions'))).body.data;
    const found = (await list()).find((s) => s.left.id === left);
    expect(found).toMatchObject({ reason: 'code', right: { id: right } });
    expect(found.left.category_name).toBe(`PAIR-CAT-${suffix}`);
    await pair({ left_id: left, right_id: right, description: 'x' });
    expect((await list()).some((s) => s.left.id === left || s.right.id === right)).toBe(false);
  });

  test('refuses what cannot be joined, and leaves it as it was', async () => {
    const { left, right } = await makePair(1, 1);
    expect((await pair({ left_id: left, right_id: left, description: 'x' })).status).toBe(400);
    expect((await pair({ left_id: left, description: 'x' })).status).toBe(400);
    expect((await pair({ left_id: left, right_id: 999999999, description: 'x' })).status).toBe(404);
    const sided = (await as(request(app).post('/api/stock-items'), managerToken).send({
      category_id: categoryId, has_sides: true, codes: { left: `SL-${suffix}`, right: `SR-${suffix}` }, stocks: { left: 1, right: 1 },
    })).body.id;
    expect((await pair({ left_id: left, right_id: sided, description: 'x' })).status).toBe(400);
    expect(await row(left)).toMatchObject({ has_sides: 0, stock_qty: 1, is_active: 1 });
    expect(await row(right)).toMatchObject({ is_active: 1, stock_qty: 1 });
    expect((await unpair(left)).status).toBe(400);
    expect((await unpair(sided)).status).toBe(400);
    expect((await unpair(999999999)).status).toBe(404);
  });

  test('technicians are out', async () => {
    const { left, right } = await makePair(1, 1);
    expect((await pair({ left_id: left, right_id: right, description: 'x' }, techToken)).status).toBe(403);
    expect((await as(request(app).get('/api/stock-items/pair-suggestions'), techToken)).status).toBe(403);
  });
});
