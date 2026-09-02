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

describe('/api/settings/decline-reasons — พนักงานทั่วไปอ่านได้ แก้ไข/เพิ่ม/ลบเฉพาะเจ้าของร้าน', () => {
  afterEach(async () => {
    await pool.execute("DELETE FROM decline_reasons WHERE label LIKE 'ทดสอบ%'");
  });

  test('office ทั่วไป → อ่านได้ (200) แต่เพิ่ม/แก้ไข/ลบไม่ได้ (403)', async () => {
    const officeToken = await getOfficeToken();
    const getRes = await request(app).get('/api/settings/decline-reasons').set('Authorization', `Bearer ${officeToken}`);
    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body.data)).toBe(true);
    expect(getRes.body.data.length).toBeGreaterThan(0);

    const postRes = await request(app)
      .post('/api/settings/decline-reasons')
      .set('Authorization', `Bearer ${officeToken}`)
      .send({ label: 'ทดสอบเหตุผล' });
    expect(postRes.status).toBe(403);
  });

  test('ไม่มี token เลย → 401', async () => {
    const res = await request(app).get('/api/settings/decline-reasons');
    expect(res.status).toBe(401);
  });

  test('ice → เพิ่ม/แก้ไข/ลบได้ครบ (round-trip)', async () => {
    const ownerToken = await getOwnerToken();
    const addRes = await request(app)
      .post('/api/settings/decline-reasons')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ label: 'ทดสอบเหตุผลใหม่' });
    expect(addRes.status).toBe(201);
    const id = addRes.body.data.id;

    const listRes = await request(app).get('/api/settings/decline-reasons').set('Authorization', `Bearer ${ownerToken}`);
    expect(listRes.body.data.find((r) => r.id === id).label).toBe('ทดสอบเหตุผลใหม่');

    const putRes = await request(app)
      .put(`/api/settings/decline-reasons/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ label: 'ทดสอบเหตุผลแก้ไขแล้ว' });
    expect(putRes.status).toBe(200);

    const delRes = await request(app).delete(`/api/settings/decline-reasons/${id}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(delRes.status).toBe(200);

    const finalListRes = await request(app).get('/api/settings/decline-reasons').set('Authorization', `Bearer ${ownerToken}`);
    expect(finalListRes.body.data.find((r) => r.id === id)).toBeUndefined();
  });
});

describe('GET /api/settings/line-template-blank — พนักงานทั่วไปก็อ่านได้ (ปุ่ม "คัดลอกลงกลุ่ม" ต้องใช้)', () => {
  afterEach(async () => {
    await pool.execute("DELETE FROM app_settings WHERE `key` = 'line_template_blank'");
  });

  test('office ทั่วไป (ไม่ใช่ ice) → 200 เห็นค่าเริ่มต้นได้', async () => {
    const token = await getOfficeToken();
    const res = await request(app).get('/api/settings/line-template-blank').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.template).toContain('{{queue_no}}');
  });

  test('ไม่มี token เลย → 401', async () => {
    const res = await request(app).get('/api/settings/line-template-blank');
    expect(res.status).toBe(401);
  });

  test('เจ้าของร้านแก้เทมเพลตแล้ว → endpoint นี้ต้องคืนค่าที่แก้ ไม่ใช่ค่าเริ่มต้น', async () => {
    const token = await getOfficeToken();
    await pool.execute(
      "INSERT INTO app_settings (`key`, value) VALUES ('line_template_blank', 'คิว {{queue_no}} — เทมเพลตกำหนดเอง') ON DUPLICATE KEY UPDATE value = VALUES(value)"
    );
    const res = await request(app).get('/api/settings/line-template-blank').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.template).toBe('คิว {{queue_no}} — เทมเพลตกำหนดเอง');
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
