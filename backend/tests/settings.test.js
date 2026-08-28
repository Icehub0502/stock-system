const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, getOwnerToken } = require('./helpers');
const lineWebhookRouter = require('../src/routes/lineWebhook.routes');

const app = createApp();

describe('GET/PUT /api/settings/line — เฉพาะเจ้าของร้าน (username ice)', () => {
  afterEach(async () => {
    await pool.execute("DELETE FROM app_settings WHERE `key` IN ('line_group_id_bot2', 'line_group_id_bot3', 'line_template_blank', 'bot1_close_success')");
  });

  test('office ทั่วไป (ไม่ใช่ ice) → 403 ทั้ง GET และ PUT', async () => {
    const token = await getOfficeToken();
    const getRes = await request(app).get('/api/settings/line').set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(403);

    const putRes = await request(app)
      .put('/api/settings/line')
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: { line_template_blank: 'x' } });
    expect(putRes.status).toBe(403);
  });

  test('ไม่มี token เลย → 401', async () => {
    const res = await request(app).get('/api/settings/line');
    expect(res.status).toBe(401);
  });

  test('ice → เห็นค่าเริ่มต้นตอนยังไม่เคยตั้งค่าอะไรเลย ครบทั้ง 3 บอท', async () => {
    const token = await getOwnerToken();
    const res = await request(app).get('/api/settings/line').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.group_ids.line_group_id_bot2).toBe('');
    expect(typeof res.body.data.bots.bot1).toBe('boolean');

    const blankMsg = res.body.data.messages.bot1.find((m) => m.key === 'line_template_blank');
    expect(blankMsg.value).toBe(blankMsg.default);
    expect(res.body.data.messages.bot1.length).toBeGreaterThan(0);
    expect(res.body.data.messages.bot2.length).toBeGreaterThan(0);
    expect(res.body.data.messages.bot3.length).toBeGreaterThan(0);
  });

  test('ice → PUT แล้ว GET กลับมาต้องเห็นค่าที่บันทึกไว้ (round-trip) แก้ทีละ key ไม่กระทบ key อื่น', async () => {
    const token = await getOwnerToken();
    const customBlank = 'คิว {{queue_no}} ทดสอบแก้เทมเพลต';
    const putRes = await request(app)
      .put('/api/settings/line')
      .set('Authorization', `Bearer ${token}`)
      .send({
        group_ids: { line_group_id_bot2: 'Gtest-bot2' },
        messages: { line_template_blank: customBlank },
      });
    expect(putRes.status).toBe(200);

    const getRes = await request(app).get('/api/settings/line').set('Authorization', `Bearer ${token}`);
    expect(getRes.body.data.group_ids.line_group_id_bot2).toBe('Gtest-bot2');
    const blankMsg = getRes.body.data.messages.bot1.find((m) => m.key === 'line_template_blank');
    expect(blankMsg.value).toBe(customBlank);
    // ไม่ได้แก้ bot1_close_success — ยังต้องเป็นค่าเริ่มต้นอยู่
    const closeMsg = getRes.body.data.messages.bot1.find((m) => m.key === 'bot1_close_success');
    expect(closeMsg.value).toBe(closeMsg.default);
  });

  test('ยิง key ที่ไม่รู้จักมาใน messages → ถูกเมิน ไม่พังไม่เขียนอะไรลง DB', async () => {
    const token = await getOwnerToken();
    const res = await request(app)
      .put('/api/settings/line')
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: { not_a_real_key: 'ไม่ควรถูกบันทึก' } });
    expect(res.status).toBe(200);
    const stored = await lineWebhookRouter.getSetting('not_a_real_key');
    expect(stored).toBeNull();
  });

  test('เทมเพลตที่ตั้งไว้เอง มีผลจริงกับข้อความที่บอทจะส่ง (ไม่ใช่แค่เก็บไว้เฉย ๆ)', async () => {
    await pool.execute(
      "INSERT INTO app_settings (`key`, value) VALUES ('line_template_blank', 'คิว {{queue_no}} — ข้อความกำหนดเอง') ON DUPLICATE KEY UPDATE value = VALUES(value)"
    );
    const stored = await lineWebhookRouter.getSetting('line_template_blank');
    const text = lineWebhookRouter.buildQueueTemplateText('9', stored);
    expect(text).toBe('คิว 9 — ข้อความกำหนดเอง');
  });
});

describe('PUT/DELETE /api/technicians/:id — เฉพาะเจ้าของร้าน', () => {
  let technicianId;

  beforeEach(async () => {
    const [result] = await pool.execute('INSERT INTO technicians (name) VALUES (?)', [`ทดสอบช่าง-${Date.now()}`]);
    technicianId = result.insertId;
  });

  afterEach(async () => {
    await pool.execute('DELETE FROM technicians WHERE id = ?', [technicianId]);
  });

  test('office ทั่วไป (ไม่ใช่ ice) → 403 ทั้งแก้ไขและลบ', async () => {
    const token = await getOfficeToken();
    const putRes = await request(app)
      .put(`/api/technicians/${technicianId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ชื่อใหม่' });
    expect(putRes.status).toBe(403);

    const delRes = await request(app).delete(`/api/technicians/${technicianId}`).set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(403);
  });

  test('ice → แก้ไขชื่อสำเร็จ', async () => {
    const token = await getOwnerToken();
    const res = await request(app)
      .put(`/api/technicians/${technicianId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ชื่อใหม่ทดสอบ' });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query('SELECT name FROM technicians WHERE id = ?', [technicianId]);
    expect(row.name).toBe('ชื่อใหม่ทดสอบ');
  });

  test('ice → ลบสำเร็จ', async () => {
    const token = await getOwnerToken();
    const res = await request(app).delete(`/api/technicians/${technicianId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const [[row]] = await pool.query('SELECT id FROM technicians WHERE id = ?', [technicianId]);
    expect(row).toBeUndefined();
  });
});

describe('GET/POST/PUT/DELETE /api/users — ตอนนี้เฉพาะเจ้าของร้าน (เดิม office ทั่วไปก็เรียกได้ แต่ยังไม่เคยมีหน้าเว็บใช้)', () => {
  test('office ทั่วไป (ไม่ใช่ ice) → 403', async () => {
    const token = await getOfficeToken();
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('ice → เห็นรายชื่อผู้ใช้ได้', async () => {
    const token = await getOwnerToken();
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('ice → ลบบัญชีของตัวเองไม่ได้', async () => {
    const token = await getOwnerToken();
    const [[me]] = await pool.query("SELECT id FROM users WHERE username = 'ice'");
    const res = await request(app).delete(`/api/users/${me.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
