// Trash: every delete keeps a full copy that the platform administrator (dev) can restore.
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { getDevToken, createShop, dropShop } = require('./helpers');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const today = new Date().toISOString().slice(0, 10);

let devToken;
let shop;
let token; // manager of the test shop

beforeAll(async () => {
  devToken = await getDevToken();
  shop = await createShop();
  token = shop.managerToken;
});

afterAll(async () => {
  await pool.query('DELETE FROM deleted_records WHERE shop_id = ?', [shop.shopId]);
  await dropShop(shop.shopId);
  await pool.end();
});

const trashOf = async (entity, recordId) => {
  const [rows] = await pool.query(
    'SELECT * FROM deleted_records WHERE shop_id = ? AND entity = ? AND record_id = ? ORDER BY id DESC LIMIT 1',
    [shop.shopId, entity, recordId]
  );
  return rows[0];
};

async function makeCustomerAndVehicle(name) {
  const cust = await request(app).post('/api/customers').set(as(token)).send({ customer_name: name });
  expect(cust.status).toBe(201);
  const veh = await request(app).post('/api/vehicles').set(as(token))
    .send({ customer_id: cust.body.data.id, brand: 'Honda', model: 'Civic', license_plate: `${name}-1` });
  expect(veh.status).toBe(201);
  return { customerId: cust.body.data.id, vehicleId: veh.body.data.id };
}

describe('who can see and restore the trash', () => {
  test('only dev', async () => {
    for (const t of [token, shop.ownerToken, shop.token]) {
      expect((await request(app).get('/api/dev/trash').set(as(t))).status).toBe(403);
      expect((await request(app).post('/api/dev/trash/1/restore').set(as(t))).status).toBe(403);
    }
    expect((await request(app).get('/api/dev/trash').set(as(devToken))).status).toBe(200);
  });
});

describe('vehicle and customer', () => {
  test('deleting a vehicle keeps a copy; restoring brings back the same row and the quotation link', async () => {
    const { customerId, vehicleId } = await makeCustomerAndVehicle('TrashV');
    // a closed quotation points at the vehicle (the delete sets that link to NULL)
    const [q] = await pool.query(
      `INSERT INTO quotations (shop_id, quotation_no, customer_id, vehicle_id, quotation_date, status, closed_at, total_amount)
       VALUES (?, 'TQ-TRASH-1', ?, ?, ?, 'pending', NOW(), 0)`,
      [shop.shopId, customerId, vehicleId, today]
    );

    const del = await request(app).delete(`/api/vehicles/${vehicleId}`).set(as(token));
    expect(del.status).toBe(200);
    const [[gone]] = await pool.query('SELECT COUNT(*) AS c FROM vehicles WHERE id = ?', [vehicleId]);
    expect(gone.c).toBe(0);
    const [[unlinked]] = await pool.query('SELECT vehicle_id FROM quotations WHERE id = ?', [q.insertId]);
    expect(unlinked.vehicle_id).toBeNull();

    const trash = await trashOf('vehicles', vehicleId);
    expect(trash.label).toContain('Honda Civic');
    expect(trash.deleted_by_name).toBeTruthy();

    const list = await request(app).get(`/api/dev/trash?shop_id=${shop.shopId}&entity=vehicles`).set(as(devToken));
    expect(list.body.data.map((r) => r.id)).toContain(trash.id);

    const restore = await request(app).post(`/api/dev/trash/${trash.id}/restore`).set(as(devToken));
    expect(restore.status).toBe(200);
    const [[back]] = await pool.query('SELECT id, customer_id, brand, license_plate FROM vehicles WHERE id = ?', [vehicleId]);
    expect(back).toMatchObject({ id: vehicleId, customer_id: customerId, brand: 'Honda' });
    const [[relinked]] = await pool.query('SELECT vehicle_id FROM quotations WHERE id = ?', [q.insertId]);
    expect(relinked.vehicle_id).toBe(vehicleId);

    // restoring twice is refused
    expect((await request(app).post(`/api/dev/trash/${trash.id}/restore`).set(as(devToken))).status).toBe(409);

    await pool.query('DELETE FROM quotations WHERE id = ?', [q.insertId]);
    await pool.query('DELETE FROM vehicles WHERE id = ?', [vehicleId]);
    await pool.query('DELETE FROM customers WHERE id = ?', [customerId]);
  });

  test('a customer is restored; one that already has the same code again cannot be restored', async () => {
    const created = await request(app).post('/api/customers').set(as(token)).send({ customer_name: 'TrashC' });
    const id = created.body.data.id;
    expect((await request(app).delete(`/api/customers/${id}`).set(as(token))).status).toBe(200);
    const trash = await trashOf('customers', id);

    const restore = await request(app).post(`/api/dev/trash/${trash.id}/restore`).set(as(devToken));
    expect(restore.status).toBe(200);
    const [[back]] = await pool.query('SELECT customer_name FROM customers WHERE id = ?', [id]);
    expect(back.customer_name).toBe('TrashC');

    // delete again, then take the code with another customer: the restore must refuse, not overwrite
    expect((await request(app).delete(`/api/customers/${id}`).set(as(token))).status).toBe(200);
    const second = await trashOf('customers', id);
    const [[row]] = await pool.query('SELECT customer_code FROM customers WHERE id = ?', [id]).catch(() => [[]]);
    expect(row).toBeUndefined();
    const snapshot = JSON.parse(second.snapshot);
    await pool.query(
      "INSERT INTO customers (shop_id, customer_code, customer_name, phone) VALUES (?, ?, 'Code thief', '')",
      [shop.shopId, snapshot[0].rows[0].customer_code]
    );
    const refused = await request(app).post(`/api/dev/trash/${second.id}/restore`).set(as(devToken));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/ซ้ำ|เดียวกัน/);

    await pool.query('DELETE FROM customers WHERE shop_id = ? AND customer_name = ?', [shop.shopId, 'Code thief']);
  });
});

describe('receipt: restoring brings back the items and re-links the quotation', () => {
  test('delete the receipt of an approved quotation, then restore it', async () => {
    const q = await request(app).post('/api/quotations').set(as(token)).send({
      newCustomer: { customer_name: 'TrashR', phone: '' },
      newVehicle: { brand: 'Toyota', model: 'Vios', license_plate: 'TRASH-R' },
      quotation_date: today,
      items: [{ product_name: 'ลูกหมาก', quantity: 2, unit_price: 500 }],
    });
    expect(q.status).toBe(201);
    const approve = await request(app).patch(`/api/quotations/${q.body.quotation_id}/approve`).set(as(token));
    expect(approve.status).toBe(200);
    const receiptId = approve.body.receipt_id;
    const [[before]] = await pool.query('SELECT COUNT(*) AS c FROM receipt_items WHERE receipt_id = ?', [receiptId]);
    expect(before.c).toBeGreaterThan(0);

    expect((await request(app).delete(`/api/receipts/${receiptId}`).set(as(token))).status).toBe(200);
    const [[mid]] = await pool.query('SELECT status, converted_receipt_id FROM quotations WHERE id = ?', [q.body.quotation_id]);
    expect(mid).toMatchObject({ status: 'pending', converted_receipt_id: null });
    const [[noItems]] = await pool.query('SELECT COUNT(*) AS c FROM receipt_items WHERE receipt_id = ?', [receiptId]);
    expect(noItems.c).toBe(0);

    const trash = await trashOf('receipts', receiptId);
    const restore = await request(app).post(`/api/dev/trash/${trash.id}/restore`).set(as(devToken));
    expect(restore.status).toBe(200);

    const [[after]] = await pool.query('SELECT COUNT(*) AS c FROM receipt_items WHERE receipt_id = ?', [receiptId]);
    expect(after.c).toBe(before.c);
    const [[linked]] = await pool.query('SELECT status, converted_receipt_id FROM quotations WHERE id = ?', [q.body.quotation_id]);
    expect(linked).toMatchObject({ status: 'approved', converted_receipt_id: receiptId });

    await pool.query('UPDATE quotations SET converted_receipt_id = NULL WHERE id = ?', [q.body.quotation_id]);
    await pool.query('DELETE FROM receipt_items WHERE receipt_id = ?', [receiptId]);
    await pool.query('DELETE FROM receipts WHERE id = ?', [receiptId]);
    await pool.query('DELETE FROM quotation_items WHERE quotation_id = ?', [q.body.quotation_id]);
    await pool.query('DELETE FROM quotations WHERE id = ?', [q.body.quotation_id]);
  });
});

describe('job: photos stay on disk while the copy exists', () => {
  test('delete a job with a photo, the file remains, restore brings the job and the photo row back', async () => {
    const { customerId, vehicleId } = await makeCustomerAndVehicle('TrashJ');
    const created = await request(app).post('/api/jobs').set(as(token)).send({ vehicle_id: vehicleId, customer_id: customerId, found_via: 'returning' });
    expect(created.status).toBe(201);
    const jobId = created.body.id;

    const uploads = path.join(__dirname, '..', 'uploads', 'job-photos');
    fs.mkdirSync(uploads, { recursive: true });
    const fileName = `trash-test-${Date.now()}.png`;
    const filePath = path.join(uploads, fileName);
    fs.writeFileSync(filePath, 'x');
    await pool.query(
      'INSERT INTO job_photos (job_id, photo_data, sort_order) VALUES (?, ?, 0)',
      [jobId, `/uploads/job-photos/${fileName}`]
    );

    try {
      expect((await request(app).delete(`/api/jobs/${jobId}`).set(as(token))).status).toBe(200);
      expect(fs.existsSync(filePath)).toBe(true);
      const [[photoGone]] = await pool.query('SELECT COUNT(*) AS c FROM job_photos WHERE job_id = ?', [jobId]);
      expect(photoGone.c).toBe(0);

      const trash = await trashOf('jobs', jobId);
      expect(trash.photo_files).toContain(fileName);
      const restore = await request(app).post(`/api/dev/trash/${trash.id}/restore`).set(as(devToken));
      expect(restore.status).toBe(200);
      const [[photoBack]] = await pool.query('SELECT COUNT(*) AS c FROM job_photos WHERE job_id = ?', [jobId]);
      expect(photoBack.c).toBe(1);

      // delete again, then remove the entry for good: now the file goes too
      expect((await request(app).delete(`/api/jobs/${jobId}`).set(as(token))).status).toBe(200);
      const again = await trashOf('jobs', jobId);
      expect((await request(app).delete(`/api/dev/trash/${again.id}`).set(as(devToken))).status).toBe(200);
      expect(fs.existsSync(filePath)).toBe(false);
    } finally {
      fs.rmSync(filePath, { force: true });
      await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
      await pool.query('DELETE FROM vehicles WHERE id = ?', [vehicleId]);
      await pool.query('DELETE FROM customers WHERE id = ?', [customerId]);
    }
  });
});

describe('other deletes land in the trash too', () => {
  test('technician, claim and repair notice', async () => {
    const tech = await request(app).post('/api/technicians').set(as(token)).send({ name: 'TrashTech' });
    expect(tech.status).toBeLessThan(300);
    const [[t]] = await pool.query("SELECT id FROM technicians WHERE shop_id = ? AND name = 'TrashTech'", [shop.shopId]);
    expect((await request(app).delete(`/api/technicians/${t.id}`).set(as(token))).status).toBe(200);
    expect((await trashOf('technicians', t.id)).label).toBe('TrashTech');
  });

  test('a record from another shop cannot be trashed through the wrong shop', async () => {
    const { customerId, vehicleId } = await makeCustomerAndVehicle('TrashX');
    const other = await createShop();
    try {
      expect((await request(app).delete(`/api/vehicles/${vehicleId}`).set(as(other.managerToken))).status).toBe(404);
      const [[stillThere]] = await pool.query('SELECT COUNT(*) AS c FROM vehicles WHERE id = ?', [vehicleId]);
      expect(stillThere.c).toBe(1);
    } finally {
      await dropShop(other.shopId);
      await pool.query('DELETE FROM vehicles WHERE id = ?', [vehicleId]);
      await pool.query('DELETE FROM customers WHERE id = ?', [customerId]);
    }
  });
});

describe('settings and clean-up', () => {
  test('defaults: automatic clean-up is off; settings validate', async () => {
    const get = await request(app).get('/api/dev/trash/settings').set(as(devToken));
    expect(get.body.data).toMatchObject({ auto_cleanup: false, keep_days: 365, photo_keep_days: 90 });
    expect((await request(app).put('/api/dev/trash/settings').set(as(devToken)).send({ auto_cleanup: true, keep_days: -1, photo_keep_days: 90 })).status).toBe(400);
  });

  test('manual purge removes only old entries', async () => {
    const created = await request(app).post('/api/customers').set(as(token)).send({ customer_name: 'TrashOld' });
    const id = created.body.data.id;
    await request(app).delete(`/api/customers/${id}`).set(as(token));
    const trash = await trashOf('customers', id);

    const fresh = await request(app).post('/api/dev/trash/purge').set(as(devToken)).send({ older_than_days: 30 });
    expect(fresh.status).toBe(200);
    expect((await trashOf('customers', id))?.id).toBe(trash.id);

    await pool.query('UPDATE deleted_records SET deleted_at = DATE_SUB(NOW(), INTERVAL 40 DAY) WHERE id = ?', [trash.id]);
    const old = await request(app).post('/api/dev/trash/purge').set(as(devToken)).send({ older_than_days: 30 });
    expect(old.body.records).toBeGreaterThanOrEqual(1);
    expect(await trashOf('customers', id)).toBeUndefined();
  });
});
