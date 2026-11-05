// The repair timer on a queue card: every stretch at "กำลังซ่อม" counts, other steps do not.
const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { repairTimeFrom } = require('../src/utils/repairTime');
const { createShop, dropShop } = require('./helpers');

const app = createApp();

describe('repairTimeFrom', () => {
  const row = (status, time) => ({ status, changed_at: `2026-11-05 ${time}` });
  const now = '2026-11-05 12:00:00';

  test('a car that never reached repairing has no timer', () => {
    expect(repairTimeFrom([row('received', '09:00:00'), row('inspecting', '09:10:00')], now))
      .toEqual({ repair_seconds: null, repair_running: false });
    expect(repairTimeFrom([], undefined)).toEqual({ repair_seconds: null, repair_running: false });
  });

  test('a car still at repairing counts up to now', () => {
    expect(repairTimeFrom([row('approved', '09:00:00'), row('repairing', '11:30:00')], now))
      .toEqual({ repair_seconds: 1800, repair_running: true });
  });

  test('leaving repairing stops the time', () => {
    expect(repairTimeFrom([row('repairing', '09:00:00'), row('aligning', '10:00:00'), row('ready', '11:00:00')], now))
      .toEqual({ repair_seconds: 3600, repair_running: false });
  });

  test('going back to repairing adds a new stretch, the time in between is left out', () => {
    expect(repairTimeFrom([row('repairing', '09:00:00'), row('aligning', '09:30:00'), row('repairing', '11:00:00')], now))
      .toEqual({ repair_seconds: 5400, repair_running: true });
  });

  test('pressing repairing twice does not restart the time', () => {
    expect(repairTimeFrom([row('repairing', '09:00:00'), row('repairing', '09:30:00'), row('ready', '10:00:00')], now))
      .toEqual({ repair_seconds: 3600, repair_running: false });
  });
});

describe('GET /api/jobs repair time', () => {
  let shop;
  let jobId;
  const date = new Date();
  const jobDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  beforeAll(async () => {
    shop = await createShop();
    const [job] = await pool.query(
      "INSERT INTO jobs (shop_id, job_no, queue_no, job_date, status) VALUES (?, 'JB-TIMER', '1', ?, 'repairing')",
      [shop.shopId, jobDate]
    );
    jobId = job.insertId;
    await pool.query(
      "INSERT INTO job_status_history (job_id, status, changed_at) VALUES (?, 'repairing', DATE_SUB(NOW(), INTERVAL 10 MINUTE))",
      [jobId]
    );
  });

  afterAll(async () => {
    await dropShop(shop.shopId);
    await pool.end();
  });

  test('the card gets the seconds so far and whether it is running', async () => {
    const res = await request(app).get('/api/jobs').query({ date: jobDate }).set('Authorization', `Bearer ${shop.token}`);
    expect(res.status).toBe(200);
    const job = res.body.data.find((j) => j.id === jobId);
    expect(job.repair_running).toBe(true);
    expect(job.repair_seconds).toBeGreaterThanOrEqual(600);
    expect(job.repair_seconds).toBeLessThan(660);
  });

  test('a car not yet repairing has no timer', async () => {
    const [job] = await pool.query(
      "INSERT INTO jobs (shop_id, job_no, queue_no, job_date, status) VALUES (?, 'JB-TIMER2', '2', ?, 'received')",
      [shop.shopId, jobDate]
    );
    const res = await request(app).get('/api/jobs').query({ date: jobDate }).set('Authorization', `Bearer ${shop.token}`);
    const found = res.body.data.find((j) => j.id === job.insertId);
    expect(found.repair_seconds).toBeNull();
    expect(found.repair_running).toBe(false);
  });
});
