// Print header per branch: defaults, saving, validation, logo upload, isolation between shops and roles.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { UPLOADS_DIR } = require('../src/utils/photoStorage');
const { createShop, dropShop } = require('./helpers');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });

let shopA;
let shopB;
let pngDataUrl;

const get = (shop, token = shop.token) => request(app).get('/api/doc-settings').set(as(token));
const put = (shop, type, body, token = shop.managerToken) => request(app).put(`/api/doc-settings/${type}`).set(as(token)).send(body);

beforeAll(async () => {
  shopA = await createShop();
  shopB = await createShop();
  const png = await sharp({ create: { width: 1200, height: 600, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
  pngDataUrl = `data:image/png;base64,${png.toString('base64')}`;
});

afterAll(async () => {
  for (const shop of [shopA, shopB]) {
    if (!shop) continue;
    fs.rmSync(path.join(UPLOADS_DIR, 'shops', String(shop.shopId)), { recursive: true, force: true });
    await dropShop(shop.shopId);
  }
  await pool.end();
});

describe('doc header settings', () => {
  test('a shop with nothing saved prints its own name only', async () => {
    const res = await get(shopA);
    expect(res.status).toBe(200);
    for (const type of ['quotation', 'receipt']) {
      expect(res.body.data[type].company_name).toMatch(/^Test shop/);
      expect(res.body.data[type].address).toBe('');
      expect(res.body.data[type].logo_path).toBe('');
      expect(res.body.data[type].saved).toBe(false);
    }
  });

  test('shop 1 keeps the header that used to be hard-coded', async () => {
    const token = require('jsonwebtoken').sign({ id: 1, username: 'x', role: 'office', shop_id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/doc-settings').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.data.receipt.logo_path).toBe('builtin:champpower');
    expect(res.body.data.receipt.branch_text).toBe('สมุทรปราการ');
    expect(res.body.data.quotation.phone).toBe('093-824-5551');
  });

  test('manager saves the two documents separately', async () => {
    expect((await put(shopA, 'quotation', { company_name: 'Alpha Quote', title: 'ใบเสนอราคา A', accent_color: '#10B981', phone: '081' })).status).toBe(200);
    expect((await put(shopA, 'receipt', { company_name: 'Alpha Receipt', branch_text: 'Rama 2' })).status).toBe(200);
    const res = await get(shopA);
    expect(res.body.data.quotation).toMatchObject({ company_name: 'Alpha Quote', title: 'ใบเสนอราคา A', accent_color: '#10b981', phone: '081', saved: true });
    expect(res.body.data.receipt).toMatchObject({ company_name: 'Alpha Receipt', branch_text: 'Rama 2', accent_color: '' });
  });

  test('fields left out keep their value, null / empty clears them', async () => {
    await put(shopA, 'quotation', { address: 'addr 1' });
    expect((await get(shopA)).body.data.quotation).toMatchObject({ company_name: 'Alpha Quote', address: 'addr 1' });
    await put(shopA, 'quotation', { accent_color: '' });
    expect((await get(shopA)).body.data.quotation.accent_color).toBe('');
  });

  test('other branches never see the header', async () => {
    const res = await get(shopB);
    expect(res.body.data.quotation.company_name).toMatch(/^Test shop/);
    expect(res.body.data.quotation.address).toBe('');
  });

  test('rejects bad input', async () => {
    expect((await put(shopA, 'quotation', { accent_color: 'red' })).status).toBe(400);
    expect((await put(shopA, 'quotation', { accent_color: '#12345' })).status).toBe(400);
    expect((await put(shopA, 'quotation', { company_name: 'x'.repeat(121) })).status).toBe(400);
    expect((await put(shopA, 'quotation', { logo_width: 10 })).status).toBe(400);
    expect((await put(shopA, 'quotation', { logo_width: 'abc' })).status).toBe(400);
    expect((await put(shopA, 'invoice', { company_name: 'x' })).status).toBe(404);
    expect((await put(shopA, 'quotation', { logo_data_url: 'data:text/html;base64,PGI+' })).status).toBe(400);
    expect((await put(shopA, 'quotation', { logo_data_url: 'data:image/png;base64,AAAA' })).status).toBe(400);
  });

  test('only a manager and above may change it', async () => {
    expect((await put(shopA, 'quotation', { company_name: 'Hack' }, shopA.token)).status).toBe(403);
    expect((await get(shopA)).body.data.quotation.company_name).toBe('Alpha Quote');
  });

  test('logo upload is stored per shop, resized, and replaced / removed cleanly', async () => {
    const first = await put(shopA, 'receipt', { logo_data_url: pngDataUrl, logo_width: 150 });
    expect(first.status).toBe(200);
    const { logo_path: logo1, logo_width } = (await get(shopA)).body.data.receipt;
    expect(logo1).toMatch(new RegExp(`^/uploads/shops/${shopA.shopId}/logo-receipt-.*\\.png$`));
    expect(logo_width).toBe(150);
    const file1 = path.join(UPLOADS_DIR, logo1.slice('/uploads/'.length));
    expect(fs.existsSync(file1)).toBe(true);
    expect((await sharp(file1).metadata()).width).toBeLessThanOrEqual(800);

    await put(shopA, 'receipt', { logo_data_url: pngDataUrl });
    const logo2 = (await get(shopA)).body.data.receipt.logo_path;
    expect(logo2).not.toBe(logo1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fs.existsSync(file1)).toBe(false); // the replaced file is gone

    await put(shopA, 'receipt', { remove_logo: true });
    expect((await get(shopA)).body.data.receipt.logo_path).toBe('');
    // the quotation logo of the same shop is independent
    expect((await get(shopA)).body.data.quotation.logo_path).toBe('');
  });

  test('the logo of the other document can be copied on the server and stays independent', async () => {
    await put(shopA, 'receipt', { logo_data_url: pngDataUrl });
    const source = (await get(shopA)).body.data.receipt.logo_path;
    expect((await put(shopA, 'quotation', { copy_logo_from: 'receipt' })).status).toBe(200);
    const copy = (await get(shopA)).body.data.quotation.logo_path;
    expect(copy).toMatch(/logo-quotation-.*\.png$/);
    expect(copy).not.toBe(source);
    expect(fs.existsSync(path.join(UPLOADS_DIR, copy.slice('/uploads/'.length)))).toBe(true);
    // removing the source keeps the copy
    await put(shopA, 'receipt', { remove_logo: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fs.existsSync(path.join(UPLOADS_DIR, copy.slice('/uploads/'.length)))).toBe(true);
    expect((await put(shopA, 'quotation', { copy_logo_from: 'quotation' })).status).toBe(400);
    expect((await put(shopA, 'quotation', { copy_logo_from: 'nope' })).status).toBe(400);
    // copying from a document without a logo clears the logo
    await put(shopA, 'quotation', { copy_logo_from: 'receipt' });
    expect((await get(shopA)).body.data.quotation.logo_path).toBe('');
  });

  test('line breaks typed in the address are kept (trimmed, empty lines dropped); other fields stay on one line', async () => {
    const res = await request(app).put('/api/doc-settings/quotation').set(as(shopA.managerToken)).send({
      address: '  99/9 ถนนตัวอย่าง  \r\n\r\n  ต.ตัวอย่าง อ.เมือง\n  จ.สมุทรปราการ 10270 ',
      company_name: 'ชื่อ\nสอง',
    });
    expect(res.status).toBe(200);
    const header = (await request(app).get('/api/doc-settings').set(as(shopA.managerToken))).body.data.quotation;
    expect(header.address).toBe('99/9 ถนนตัวอย่าง\nต.ตัวอย่าง อ.เมือง\nจ.สมุทรปราการ 10270');
    expect(header.company_name).toBe('ชื่อ สอง');
  });
});
