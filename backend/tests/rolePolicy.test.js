const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOwnerToken, getManagerToken, getOfficeToken, getTechnicianToken } = require('./helpers');
const { roleRefusal } = require('../src/middleware/rolePolicy');
const { roleRank } = require('../src/middleware/auth');

const app = createApp();

describe('rolePolicy', () => {
  test('accountant reads everything and writes nothing except the listed few', () => {
    expect(roleRefusal('accountant', 'GET', '/api/receipts/monthly-summary?x=1')).toBeNull();
    expect(roleRefusal('accountant', 'POST', '/api/receipts')).toMatch(/บัญชี/);
    expect(roleRefusal('accountant', 'DELETE', '/api/customers/1')).toMatch(/บัญชี/);
    expect(roleRefusal('accountant', 'PUT', '/api/something-new/1')).toMatch(/บัญชี/);
    expect(roleRefusal('accountant', 'PUT', '/api/auth/change-password')).toBeNull();
    expect(roleRefusal('accountant', 'PATCH', '/api/receipts/5/mark-printed')).toBeNull();
    expect(roleRefusal('accountant', 'PATCH', '/api/receipts/5')).toMatch(/บัญชี/);
    expect(roleRefusal('accountant', 'PATCH', '/api/jobs/5/mark-worksheet-printed')).toMatch(/บัญชี/);
  });
  test('sales does daily sales work but does not move stock or see costs', () => {
    expect(roleRefusal('sales', 'POST', '/api/quotations')).toBeNull();
    expect(roleRefusal('sales', 'POST', '/api/receipts')).toBeNull();
    expect(roleRefusal('sales', 'POST', '/api/claims')).toBeNull();
    expect(roleRefusal('sales', 'GET', '/api/stock-items')).toBeNull();
    expect(roleRefusal('sales', 'GET', '/api/stock-receive/search?q=ab')).toBeNull();
    expect(roleRefusal('sales', 'POST', '/api/stock-items')).toMatch(/สต๊อก/);
    expect(roleRefusal('sales', 'POST', '/api/stock-receive/batch/apply')).toMatch(/สต๊อก/);
    expect(roleRefusal('sales', 'POST', '/api/stock-deductions')).toMatch(/สต๊อก/);
    expect(roleRefusal('sales', 'DELETE', '/api/transactions/9/')).toMatch(/สต๊อก/);
    expect(roleRefusal('sales', 'POST', '/api/claims/3/parts/deduct')).toMatch(/สต๊อก/);
    expect(roleRefusal('sales', 'GET', '/api/stock-receive/costs/missing')).toMatch(/สต๊อก/);
    expect(roleRefusal('sales', 'GET', '/api/suppliers')).toMatch(/สต๊อก/);
  });
  test('other roles are untouched', () => {
    for (const role of ['technician', 'office', 'manager', 'owner', 'dev']) {
      expect(roleRefusal(role, 'POST', '/api/stock-items')).toBeNull();
      expect(roleRefusal(role, 'DELETE', '/api/receipts/1')).toBeNull();
    }
  });
  test('where they sit on the ladder', () => {
    expect(roleRank('sales')).toBe(roleRank('office'));
    expect(roleRank('accountant')).toBe(roleRank('manager'));
    expect(roleRank('accountant')).toBeLessThan(roleRank('owner'));
  });
});

describe('the two roles against the running routes', () => {
  const suffix = Date.now().toString(36);
  const made = [];
  let ownerToken;
  let salesToken;
  let accountantToken;
  let categoryId;

  const as = (token, req) => req.set('Authorization', `Bearer ${token}`);
  const tokenOf = (user) => jwt.sign({ id: user.id, username: user.username, role: user.role, shop_id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });

  async function makeUser(role) {
    const res = await as(ownerToken, request(app).post('/api/users')).send({
      username: `t_${role}_${suffix}`, password: 'password123', full_name: role, role,
    });
    expect(res.status).toBe(201);
    made.push(res.body.id);
    return res.body;
  }

  beforeAll(async () => {
    ownerToken = await getOwnerToken();
    salesToken = tokenOf(await makeUser('sales'));
    accountantToken = tokenOf(await makeUser('accountant'));
    const cat = await as(await getManagerToken(), request(app).post('/api/stock-items/categories')).send({ name: `ROLE-CAT-${suffix}` });
    categoryId = cat.body.id;
  });

  afterAll(async () => {
    if (made.length) await pool.query('DELETE FROM users WHERE id IN (?)', [made]);
    await pool.query('DELETE FROM stock_categories WHERE id = ?', [categoryId]);
  });

  test('an owner can give the new roles, and they log in with them', async () => {
    const login = await request(app).post('/api/auth/login').send({ username: `t_sales_${suffix}`, password: 'password123' });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('sales');
  });

  test('a technician or office user cannot give a role', async () => {
    const res = await as(await getOfficeToken(), request(app).post('/api/users')).send({ username: `t_x_${suffix}`, password: 'password123', role: 'accountant' });
    expect(res.status).toBe(403);
    const tech = await as(await getTechnicianToken(), request(app).get('/api/users'));
    expect(tech.status).toBe(403);
  });

  test('accountant: opens the manager figures, changes nothing, cannot reach user accounts', async () => {
    expect((await as(accountantToken, request(app).get('/api/receipts/monthly-summary'))).status).toBe(200);
    expect((await as(accountantToken, request(app).get('/api/receipts/daily-summary'))).status).toBe(200);
    expect((await as(accountantToken, request(app).get('/api/warranty-register'))).status).toBe(200);
    expect((await as(accountantToken, request(app).get('/api/users'))).status).toBe(403);
    const write = await as(accountantToken, request(app).post('/api/stock-items')).send({ category_id: categoryId, oem_code: `R-${suffix}` });
    expect(write.status).toBe(403);
    expect(write.body.error).toMatch(/บัญชี/);
    expect((await as(accountantToken, request(app).post('/api/warranty-register/assign')).send({ job_id: 1 })).status).toBe(403);
    const pw = await as(accountantToken, request(app).put('/api/auth/change-password')).send({ current_password: 'wrong-password', new_password: 'newpassword1' });
    expect(pw.status).not.toBe(403);
  });

  test('sales: works with customers and sees stock, cannot move it or see costs and manager figures', async () => {
    expect((await as(salesToken, request(app).get('/api/customers'))).status).toBe(200);
    expect((await as(salesToken, request(app).get('/api/stock-items'))).status).toBe(200);
    const write = await as(salesToken, request(app).post('/api/stock-items')).send({ category_id: categoryId, oem_code: `S-${suffix}` });
    expect(write.status).toBe(403);
    expect(write.body.error).toMatch(/สต๊อก/);
    expect((await as(salesToken, request(app).get('/api/stock-receive/costs/missing'))).status).toBe(403);
    expect((await as(salesToken, request(app).get('/api/receipts/monthly-summary'))).status).toBe(403);
    expect((await as(salesToken, request(app).get('/api/users'))).status).toBe(403);
  });
});
