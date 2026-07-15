const parseLineQueueMessage = require('../src/utils/parseLineQueueMessage');

describe('parseLineQueueMessage', () => {
  test('แยกข้อความรูปแบบ label:ค่า ครบทุกช่อง (ตัวอย่างของร้าน)', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว:1',
        'วันที่:17/07/26',
        'ชื่อลูกค้า:คุณB',
        'เบอร์โทร:081-555-9999',
        'ยี่ห้อรถ:Honda รุ่นรถ:Civic',
        'ทะเบียนรถ:3กอ5222',
        'อาการ:เช็คช่วงล่าง',
        'รายการ:',
        'แร็ค OEM 5000',
        'ค่าแรง 2000',
        'หมายเหตุ:',
        'ลูกค้ามัดจำ 2000 บาท',
      ].join('\n')
    );
    expect(parsed).toEqual({
      queue_no: '1',
      quotation_date: '2026-07-17',
      customer_name: 'คุณB',
      phone: '0815559999',
      brand: 'Honda',
      model: 'Civic',
      license_plate: '3กอ5222',
      symptom: 'เช็คช่วงล่าง',
      remark: 'ลูกค้ามัดจำ 2000 บาท',
      items: [
        { name: 'แร็ค OEM', price: 5000 },
        { name: 'ค่าแรง', price: 2000 },
      ],
    });
  });

  test('โคลอนซ้ำ ("อาการ::ค่า") ยังอ่านค่าได้ถูกต้อง', () => {
    const parsed = parseLineQueueMessage('คิว:2\nชื่อลูกค้า:คุณซี\nอาการ::เช็คช่วงล่าง');
    expect(parsed.symptom).toBe('เช็คช่วงล่าง');
  });

  test('สะกด "เบอโทร" (ไม่มี ร์) ก็รองรับ', () => {
    const parsed = parseLineQueueMessage('คิว:3\nชื่อลูกค้า:คุณดี\nเบอโทร:0899999999');
    expect(parsed.phone).toBe('0899999999');
  });

  test('รายการที่ไม่มีราคา (จะให้ระบบไปหาราคาจากแคตาล็อกแทน) → price เป็น null', () => {
    const parsed = parseLineQueueMessage(
      'คิว:4\nชื่อลูกค้า:คุณอี\nรายการ:\nชุดโปรช่วงล่าง เก๋ง'
    );
    expect(parsed.items).toEqual([{ name: 'ชุดโปรช่วงล่าง เก๋ง', price: null }]);
  });

  test('ไม่ใส่ "วันที่:" → ใช้วันนี้แทน', () => {
    const parsed = parseLineQueueMessage('คิว:5\nชื่อลูกค้า:คุณเอฟ');
    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(parsed.quotation_date).toBe(expected);
  });

  test('วันที่รูปแบบผิด → ใช้วันนี้แทน (ไม่ throw)', () => {
    const parsed = parseLineQueueMessage('คิว:6\nชื่อลูกค้า:คุณจี\nวันที่:ไม่ระบุ');
    expect(parsed.quotation_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('ข้อความไม่มี label "คิว" เลย → null (แชตทั่วไปในกลุ่ม)', () => {
    expect(parseLineQueueMessage('พรุ่งนี้ร้านเปิดกี่โมงครับ')).toBeNull();
    expect(parseLineQueueMessage('')).toBeNull();
    expect(parseLineQueueMessage(null)).toBeNull();
  });

  test('มี "คิว:" แต่ไม่มี "ชื่อลูกค้า:" → null (ข้อมูลไม่พอสร้างใบเสนอราคา)', () => {
    expect(parseLineQueueMessage('คิว:7\nอาการ:เช็คช่วงล่าง')).toBeNull();
  });

  test('ข้อความจริงของร้าน (คิว 9 คุณสุมาลีน) ในรูปแบบ label ใหม่', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว:9',
        'วันที่:15/07/26',
        'ชื่อลูกค้า:คุณสุมาลีน',
        'เบอร์โทร:086-309-0860',
        'ยี่ห้อรถ:Toyota รุ่นรถ:Vellfire',
        'ทะเบียนรถ:5กฒ63',
        'อาการ:เช็คช่วงล่าง',
        'รายการ:',
        'แร็ค 5500',
        'ค่าแรง 2000',
        'ชุดโปรช่วงล่าง เก๋ง',
        'ซ่อมคอ 2000',
        'หมายเหตุ:',
        'ลูกค้ามัดจำ 2000 บาท',
      ].join('\n')
    );
    expect(parsed.customer_name).toBe('คุณสุมาลีน');
    expect(parsed.phone).toBe('0863090860');
    expect(parsed.brand).toBe('Toyota');
    expect(parsed.model).toBe('Vellfire');
    expect(parsed.license_plate).toBe('5กฒ63');
    expect(parsed.items).toEqual([
      { name: 'แร็ค', price: 5500 },
      { name: 'ค่าแรง', price: 2000 },
      { name: 'ชุดโปรช่วงล่าง เก๋ง', price: null },
      { name: 'ซ่อมคอ', price: 2000 },
    ]);
    expect(parsed.remark).toBe('ลูกค้ามัดจำ 2000 บาท');
  });
});
