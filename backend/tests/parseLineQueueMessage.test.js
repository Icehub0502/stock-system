const parseLineQueueMessage = require('../src/utils/parseLineQueueMessage');

describe('parseLineQueueMessage', () => {
  test('Pattern 1 (รับรถ) — ไม่มี รายการ: → items ว่าง', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว:4',
        'วันที่:15/07/26',
        'ชื่อลูกค้า:คุณแอน',
        'เบอโทร:084-140-0684',
        'ยี่ห้อรถ:Honda รุ่นรถ:CRV G2',
        'ทะเบียนรถ:6ขย1994',
        'อาการ:ช่วงล่างดัง',
      ].join('\n')
    );
    expect(parsed.queue_no).toBe('4');
    expect(parsed.customer_name).toBe('คุณแอน');
    expect(parsed.phone).toBe('0841400684');
    expect(parsed.brand).toBe('Honda');
    expect(parsed.model).toBe('CRV G2');
    expect(parsed.license_plate).toBe('6ขย1994');
    expect(parsed.symptom).toBe('ช่วงล่างดัง');
    expect(parsed.items).toEqual([]);
    expect(parsed.stated_total).toBeNull();
  });

  test('"วันที่:" ที่พิมพ์มาไม่ถูกใช้ — quotation_date เป็นวันนี้เสมอ', () => {
    const parsed = parseLineQueueMessage('คิว:1\nวันที่:01/01/20\nชื่อลูกค้า:คุณเอ');
    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(parsed.quotation_date).toBe(expected);
  });

  test('Pattern 2 (เสนอราคา) — รายการขึ้นต้นด้วย "-" ตัดเครื่องหมายออก และมีราคาให้ครบ', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว:4',
        'ชื่อลูกค้า:คุณแอน',
        'เบอโทร:084-140-0684',
        'ยี่ห้อรถ:Honda รุ่นรถ:CRV G2',
        'ทะเบียนรถ:6ขย1994',
        'อาการ:ช่วงล่างดัง',
        'รายการ:',
        ' - แร็ค OEM  5000',
        ' - ค่าแรง 2000',
        ' - ชุดโปรช่วงล่าง เก๋ง 6000',
        ' -  โช๊ค 4 ต้น รวมอุปกรณ์ 10000',
      ].join('\n')
    );
    expect(parsed.items).toEqual([
      { name: 'แร็ค OEM', price: 5000 },
      { name: 'ค่าแรง', price: 2000 },
      { name: 'ชุดโปรช่วงล่าง เก๋ง', price: 6000 },
      { name: 'โช๊ค 4 ต้น รวมอุปกรณ์', price: 10000 },
    ]);
    expect(parsed.stated_total).toBeNull();
  });

  test('มีบรรทัด "รวม" ในเซคชันรายการ → stated_total จับได้ ไม่ถูกตีเป็นรายการ', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว:4',
        'ชื่อลูกค้า:คุณแอน',
        'รายการ:',
        ' - แร็ค OEM  5000',
        ' - ค่าแรง 2000',
        'รวม 7000',
      ].join('\n')
    );
    expect(parsed.items).toEqual([
      { name: 'แร็ค OEM', price: 5000 },
      { name: 'ค่าแรง', price: 2000 },
    ]);
    expect(parsed.stated_total).toBe(7000);
  });

  test('ชื่อรายการกับราคาคนละบรรทัด (พิมพ์ "เพิ่มเติม ชื่อ..." แล้วราคาบรรทัดถัดไป) → รวมเป็นรายการเดียว', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว:4',
        'ชื่อลูกค้า:คุณแอน',
        'รายการ:',
        ' - แร็ค OEM  8000',
        'เพิ่มเติม รายการโช็ค 4ต้น',
        '15500',
        'กันโครงหลัง ยางหุ้มเพลาหัวในสองหัว',
        'รวม34000',
      ].join('\n')
    );
    expect(parsed.items).toEqual([
      { name: 'แร็ค OEM', price: 8000 },
      { name: 'รายการโช็ค 4ต้น', price: 15500 },
      { name: 'กันโครงหลัง ยางหุ้มเพลาหัวในสองหัว', price: null },
    ]);
    expect(parsed.stated_total).toBe(34000);
  });

  test('รายการไม่มีราคา (ให้ระบบไปหาราคาจากแคตาล็อกแทน) → price เป็น null', () => {
    const parsed = parseLineQueueMessage(
      'คิว:4\nชื่อลูกค้า:คุณอี\nรายการ:\nชุดโปรช่วงล่าง เก๋ง'
    );
    expect(parsed.items).toEqual([{ name: 'ชุดโปรช่วงล่าง เก๋ง', price: null }]);
  });

  test('โคลอนซ้ำ ("อาการ::ค่า") ยังอ่านค่าได้ถูกต้อง', () => {
    const parsed = parseLineQueueMessage('คิว:2\nชื่อลูกค้า:คุณซี\nอาการ::เช็คช่วงล่าง');
    expect(parsed.symptom).toBe('เช็คช่วงล่าง');
  });

  test('สะกด "เบอโทร" (ไม่มี ร์) ก็รองรับ', () => {
    const parsed = parseLineQueueMessage('คิว:3\nชื่อลูกค้า:คุณดี\nเบอโทร:0899999999');
    expect(parsed.phone).toBe('0899999999');
  });

  test('ข้อความไม่มี label "คิว" เลย → null (แชตทั่วไปในกลุ่ม)', () => {
    expect(parseLineQueueMessage('พรุ่งนี้ร้านเปิดกี่โมงครับ')).toBeNull();
    expect(parseLineQueueMessage('')).toBeNull();
    expect(parseLineQueueMessage(null)).toBeNull();
  });

  test('มี "คิว:" แต่ไม่มี "ชื่อลูกค้า:" → null (ข้อมูลไม่พอสร้างใบเสนอราคา)', () => {
    expect(parseLineQueueMessage('คิว:7\nอาการ:เช็คช่วงล่าง')).toBeNull();
  });

  test('คิวซ้ำ/เลขคิวเดิม — พาร์สได้ตามปกติ ไม่ปฏิเสธ (ร้านพิมพ์คิวสับสนกันเป็นปกติ)', () => {
    const first = parseLineQueueMessage('คิว:5\nชื่อลูกค้า:คุณหนึ่ง');
    const second = parseLineQueueMessage('คิว:5\nชื่อลูกค้า:คุณสอง');
    expect(first.queue_no).toBe('5');
    expect(second.queue_no).toBe('5');
  });
});
