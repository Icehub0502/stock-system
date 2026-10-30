// Activity log: every change by a signed-in user is recorded for the administrator, with the record as it was before.
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { getDevToken, createShop, dropShop } = require('./helpers');
const { sanitize } = require('../src/middleware/activityLogger');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const unique = Date.now().toString(36);

let shop;
let devToken;

// the entry is written after the response has gone out: wait for it
async function waitForEntries(where, params, expected = 1) {
  for (let i = 0; i < 40; i += 1) {
    const [rows] = await pool.query(`SELECT * FROM activity_log WHERE shop_id = ? AND ${where} ORDER BY id`, [shop.shopId, ...params]);
    if (rows.length >= expected) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

beforeAll(async () => {
  // the per-user summary shows the 100 busiest users of the day: entries left by earlier runs of the whole
  // suite (each makes its own shops and users) would push this test's user out of it
  await pool.query('DELETE FROM activity_log WHERE shop_id IS NULL OR shop_id <> 1');
  shop = await createShop();
  devToken = await getDevToken();
});

afterAll(async () => {
  await pool.query('DELETE FROM activity_log WHERE shop_id = ? OR username = ?', [shop.shopId, `ghost${unique}`]);
  await pool.query('DELETE FROM deleted_records WHERE shop_id = ?', [shop.shopId]);
  await pool.query('DELETE FROM customers WHERE shop_id = ?', [shop.shopId]);
  await dropShop(shop.shopId);
  await pool.end();
});

describe('what is recorded', () => {
  test('create, edit and delete of a customer: who, what, and the record as it was before', async () => {
    const created = await request(app).post('/api/customers').set(as(shop.token)).send({ customer_name: `Log ${unique}`, phone: '081-222-3333' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const [create] = await waitForEntries("entity = 'customers' AND kind = 'create'", []);
    expect(create).toMatchObject({ username: 'office', role: 'office', method: 'POST', status: 201, shop_id: shop.shopId });
    expect(create.entity_id).toBe(String(id)); // the history of the record starts at its creation
    expect(create.summary).toContain(`Log ${unique}`);
    expect(JSON.parse(create.request_body)).toMatchObject({ customer_name: `Log ${unique}` });

    const edited = await request(app).put(`/api/customers/${id}`).set(as(shop.token)).send({ customer_name: `Log ${unique} edited`, phone: '081-222-3333' });
    expect(edited.status).toBe(200);
    const [update] = await waitForEntries("entity = 'customers' AND kind = 'update'", []);
    expect(update.entity_id).toBe(String(id));
    expect(JSON.parse(update.before_data)).toMatchObject({ customer_name: `Log ${unique}` }); // the old name
    expect(JSON.parse(update.request_body)).toMatchObject({ customer_name: `Log ${unique} edited` });

    const removed = await request(app).delete(`/api/customers/${id}`).set(as(shop.token));
    expect(removed.status).toBe(200);
    const [del] = await waitForEntries("entity = 'customers' AND kind = 'delete'", []);
    expect(del.summary).toContain('ลบ');
    expect(del.summary).toContain(`Log ${unique} edited`); // what was deleted, by name
    expect(JSON.parse(del.before_data)).toMatchObject({ customer_name: `Log ${unique} edited`, phone: '081-222-3333' });
  });

  test('passwords never reach the log; a failed login is recorded under the name that was tried', async () => {
    const secret = `Sup3r-secret-${unique}`;
    const made = await request(app).post('/api/users').set(as(shop.ownerToken)).send({ username: `u${unique}`.slice(0, 20), password: secret, full_name: 'Log user', role: 'office' });
    expect(made.status).toBe(201);
    const [entry] = await waitForEntries("entity = 'users' AND kind = 'create'", []);
    expect(entry.request_body).not.toContain(secret);
    expect(JSON.parse(entry.request_body).password).toBe('[ซ่อน]');
    expect(entry.role).toBe('owner');

    const failed = await request(app).post('/api/auth/login').send({ username: `ghost${unique}`, password: 'wrong-password-123' });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    for (let i = 0; i < 40; i += 1) {
      const [rows] = await pool.query("SELECT * FROM activity_log WHERE kind = 'login' AND username = ?", [`ghost${unique}`]);
      if (rows.length) {
        expect(rows[0].status).toBe(failed.status);
        expect(rows[0].summary).toContain('ไม่สำเร็จ');
        expect(rows[0].request_body).not.toContain('wrong-password-123');
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the failed login was not recorded');
  });

  test('reads and anonymous writes are not recorded', async () => {
    const [[before]] = await pool.query('SELECT COUNT(*) AS n FROM activity_log');
    await request(app).get('/api/customers').set(as(shop.token));
    await request(app).post('/api/customers').send({ customer_name: 'nobody' }); // no token
    await new Promise((r) => setTimeout(r, 400));
    const [[after]] = await pool.query('SELECT COUNT(*) AS n FROM activity_log');
    expect(after.n).toBe(before.n);
  });

  test('secrets are hidden, files and long text are cut short', () => {
    const out = sanitize({
      customer_name: 'A', password: 'x', new_password: 'y', token: 't', customer_signature: 'sig',
      logo_data_url: `data:image/png;base64,${'A'.repeat(5000)}`,
      note: 'n'.repeat(900),
      nested: { current_password: 'z', items: Array.from({ length: 60 }, (_, i) => i) },
    });
    expect(out.password).toBe('[ซ่อน]');
    expect(out.new_password).toBe('[ซ่อน]');
    expect(out.token).toBe('[ซ่อน]');
    expect(out.customer_signature).toBe('[ซ่อน]');
    expect(out.logo_data_url).toMatch(/^\[ไฟล์ \d+ ตัวอักษร\]$/);
    expect(out.note.length).toBeLessThan(600);
    expect(out.nested.current_password).toBe('[ซ่อน]');
    expect(out.nested.items).toHaveLength(51);
    expect(out.customer_name).toBe('A');
  });
});

describe('what the administrator sees', () => {
  test('only the developer account can read it', async () => {
    for (const t of [shop.token, shop.managerToken, shop.ownerToken]) {
      expect((await request(app).get('/api/dev/activity').set(as(t))).status).toBe(403);
    }
    expect((await request(app).get('/api/dev/activity')).status).toBe(401);
  });

  test('list with filters, one entry in full, and the per-user summary', async () => {
    const list = await request(app).get(`/api/dev/activity?shop_id=${shop.shopId}&kind=delete`).set(as(devToken));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    expect(list.body.data.every((r) => r.kind === 'delete' && r.shop_id === shop.shopId)).toBe(true);
    expect(list.body.data[0]).toMatchObject({ username: 'office', has_before: true });
    expect(list.body.data[0].request_body).toBeUndefined(); // the list stays light

    const one = await request(app).get(`/api/dev/activity/${list.body.data[0].id}`).set(as(devToken));
    expect(one.body.data.before_data).toMatchObject({ phone: '081-222-3333' });
    expect(one.body.data.path).toMatch(/^\/api\/customers\/\d+$/);

    const byUser = await request(app).get(`/api/dev/activity?shop_id=${shop.shopId}&user=office`).set(as(devToken));
    expect(byUser.body.data.length).toBeGreaterThanOrEqual(3);
    const failedOnly = await request(app).get(`/api/dev/activity?shop_id=${shop.shopId}&failed=1`).set(as(devToken));
    expect(failedOnly.body.data.every((r) => r.status >= 400)).toBe(true);

    const summary = await request(app).get('/api/dev/activity/summary').set(as(devToken));
    const office = summary.body.data.users.find((u) => u.shop_id === shop.shopId && u.username === 'office');
    expect(office).toMatchObject({ creates: 1, updates: 1, deletes: 1 });
    expect(summary.body.data.logins.failed).toBeGreaterThanOrEqual(1);

    expect((await request(app).get('/api/dev/activity/0').set(as(devToken))).status).toBe(400);
    expect((await request(app).get('/api/dev/activity/99999999').set(as(devToken))).status).toBe(404);
  });
});
