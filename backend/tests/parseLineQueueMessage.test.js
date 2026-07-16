const parseLineQueueMessage = require('../src/utils/parseLineQueueMessage');

describe('parseLineQueueMessage', () => {
  test('รูปแบบจริงที่ร้านพิมพ์ (ไม่มีโคลอน/label เลย) — แยกครบทุกช่อง', () => {
    const parsed = parseLineQueueMessage(
      'คิว 2\nคุณนอก\n085-111-9565\nHonda Accord G8\n9กก4444\nเช็คช่วงล่าง'
    );
    expect(parsed.queue_no).toBe('2');
    expect(parsed.customer_name).toBe('คุณนอก');
    expect(parsed.phone).toBe('0851119565');
    expect(parsed.brand).toBe('Honda');
    expect(parsed.model).toBe('Accord G8');
    expect(parsed.license_plate).toBe('9กก4444');
    expect(parsed.symptom).toBe('เช็คช่วงล่าง');
    expect(parsed.items).toEqual([]);
  });

  test('"คิวที่10" (คำว่า "ที่" แปะติดเลขคิว ไม่มีช่องว่าง) → อ่านเลขคิวได้ถูกต้อง', () => {
    const parsed = parseLineQueueMessage('คิวที่10\nคุณ เอกชัย\n081-827-5255');
    expect(parsed.queue_no).toBe('10');
  });

  test('บรรทัดวันที่เดี่ยว ๆ (dd/m/yy) ไม่ถูกใช้และไม่หลุดไปปนกับอาการ', () => {
    const parsed = parseLineQueueMessage(
      'คิวที่10\n16/7/69\nคุณ เอกชัย\n081-827-5255\nToyota Harrier\nกว 6066\nอาการ เลี้ยวติดตัวถัง'
    );
    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(parsed.quotation_date).toBe(expected);
    expect(parsed.symptom).toBe('เลี้ยวติดตัวถัง');
    expect(parsed.symptom).not.toMatch(/69/);
  });

  test('ทะเบียนมีช่องว่างคั่นระหว่างตัวอักษรกับเลข ("กว 6066") ก็อ่านได้', () => {
    const parsed = parseLineQueueMessage('คิว 10\nคุณเอกชัย\nกว 6066');
    expect(parsed.license_plate).toBe('กว6066');
  });

  test('"คิว 1 17/07/26" (มีวันที่ต่อท้ายเลขคิว) → queue_no ตัดแค่เลขคิว, วันที่ไม่ถูกใช้', () => {
    const parsed = parseLineQueueMessage(
      'คิว 1 17/07/26\nคุณศิริลักษณ์\n092-241-9198\nHonda civic FC\n1ขพ2886\nที่งเปลี่ยนโช้คหลังมา มีอาการเสียงดังข้างหลัง'
    );
    expect(parsed.queue_no).toBe('1');
    expect(parsed.customer_name).toBe('คุณศิริลักษณ์');
    expect(parsed.brand).toBe('Honda');
    expect(parsed.model).toBe('civic FC');
    expect(parsed.license_plate).toBe('1ขพ2886');
    expect(parsed.symptom).toBe('ที่งเปลี่ยนโช้คหลังมา มีอาการเสียงดังข้างหลัง');
  });

  test('"คิว4" ติดกันไม่มีช่องว่างก็อ่านเลขคิวได้', () => {
    const parsed = parseLineQueueMessage('คิว4\nคุณแอน\n084-140-0684');
    expect(parsed.queue_no).toBe('4');
  });

  test('ทะเบียนไม่มีเลขนำ (ฮย3371) และรุ่นรถมีคำไทยต่อท้าย', () => {
    const parsed = parseLineQueueMessage('คิว 3\nคุณช้าง\nToyota Commuter หลังคาสูง\nฮย3371');
    expect(parsed.license_plate).toBe('ฮย3371');
    expect(parsed.brand).toBe('Toyota');
    expect(parsed.model).toBe('Commuter หลังคาสูง');
  });

  test('ชื่อไม่ขึ้นต้นด้วย "คุณ" → ใช้บรรทัดแรกที่จำแนกไม่ได้เป็นชื่อ ที่เหลือเป็นอาการ', () => {
    const parsed = parseLineQueueMessage('คิว 5\nพี่ต้น\nHonda City\nพวงมาลัยสั่น เข้าโค้งมีเสียง');
    expect(parsed.customer_name).toBe('พี่ต้น');
    expect(parsed.symptom).toBe('พวงมาลัยสั่น เข้าโค้งมีเสียง');
  });

  test('label ชัดเจนแบบมีโคลอน (เผื่อร้านพิมพ์บางครั้ง) ก็ยังใช้ได้ — 2 label บรรทัดเดียวกันตัดถูกจุด', () => {
    const parsed = parseLineQueueMessage(
      'คิว:1\nคุณบี\nยี่ห้อรถ:Honda รุ่นรถ:Civic\nทะเบียนรถ:3กอ5222\nอาการ:เช็คช่วงล่าง'
    );
    expect(parsed.brand).toBe('Honda');
    expect(parsed.model).toBe('Civic');
    expect(parsed.license_plate).toBe('3กอ5222');
    expect(parsed.symptom).toBe('เช็คช่วงล่าง');
  });

  test('รายการต่อท้ายข้อมูลหัวบิลได้เลย ไม่ต้องมี "รายการ:" นำหน้า (ของจริงที่ร้านพิมพ์)', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิวที่10',
        '16/7/69',
        'คุณ เอกชัย',
        '081-827-5255',
        'Toyota Harrier',
        'กว 6066',
        'อาการ เลี้ยวติดตัวถัง',
        'แร็ค OEM 5000',
        'ชุดโปรช่วงล่างเก๋ง 7500',
        'ซ่อมคอ 2000',
      ].join('\n')
    );
    expect(parsed.symptom).toBe('เลี้ยวติดตัวถัง');
    expect(parsed.items).toEqual([
      { name: 'แร็ค OEM', price: 5000 },
      { name: 'ชุดโปรช่วงล่างเก๋ง', price: 7500 },
      { name: 'ซ่อมคอ', price: 2000 },
    ]);
  });

  test('บรรทัดโปรโมทที่คัดลอกมาทั้งย่อหน้า (ยาว/ช่องว่างรัว/อิโมจิ) ไม่ถูกตีเป็นรายการ ไปอยู่ในหมายเหตุแทน', () => {
    const blob = 'ชุดโปร ช่วงล่าง                                   👍สินค้าประกัน 1 ปี 10000กิโล                             รายการสินค้าที่จะได้🛠️                              -ปีกนกล่าง -ลูกหมากปีกนก -ลูกหมากปลาย-ลูกหมากกันโครงหน้า -ยางรัดกันโครงหน้า -                                 ราคารวม🔧ค่าแรงติดตั้ง รวมตั้งศูนย์7500';
    const parsed = parseLineQueueMessage(
      ['คิวที่10', 'คุณ เอกชัย', '081-827-5255', 'อาการ เลี้ยวติดตัวถัง', 'แร็ค OEM 5000', blob, 'ซ่อมคอ 2000'].join('\n')
    );
    expect(parsed.items).toEqual([
      { name: 'แร็ค OEM', price: 5000 },
      { name: 'ซ่อมคอ', price: 2000 },
    ]);
    expect(parsed.remark).toBe(blob);
  });

  test('"รายการ" (ไม่มีโคลอนก็ได้) เริ่ม section รายการแบบระบุชัดเจน — บรรทัดขึ้นต้น "-" ตัดเครื่องหมายออก', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว 4',
        'คุณแอน',
        '084-140-0684',
        'Honda CRV G2',
        '6ขย1994',
        'อาการ ช่วงล่างดัง',
        'รายการ',
        ' - แร็ค OEM  5000',
        ' - ค่าแรง 2000',
        ' - ชุดโปรช่วงล่าง เก๋ง 6000',
      ].join('\n')
    );
    expect(parsed.symptom).toBe('ช่วงล่างดัง');
    expect(parsed.items).toEqual([
      { name: 'แร็ค OEM', price: 5000 },
      { name: 'ค่าแรง', price: 2000 },
      { name: 'ชุดโปรช่วงล่าง เก๋ง', price: 6000 },
    ]);
  });

  test('ชื่อรายการกับราคาคนละบรรทัด (พิมพ์ "เพิ่มเติม ชื่อ..." แล้วราคาบรรทัดถัดไป) → รวมเป็นรายการเดียว, มีบรรทัด "รวม" → stated_total', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว:4',
        'คุณแอน',
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
    const parsed = parseLineQueueMessage('คิว 4\nคุณอี\nรายการ\nชุดโปรช่วงล่าง เก๋ง');
    expect(parsed.items).toEqual([{ name: 'ชุดโปรช่วงล่าง เก๋ง', price: null }]);
  });

  test('ข้อความไม่ขึ้นต้นด้วย "คิว" → null (แชตทั่วไปในกลุ่ม)', () => {
    expect(parseLineQueueMessage('พรุ่งนี้ร้านเปิดกี่โมงครับ')).toBeNull();
    expect(parseLineQueueMessage('9กก4444\nเช็คช่วงล่าง')).toBeNull();
    expect(parseLineQueueMessage('')).toBeNull();
    expect(parseLineQueueMessage(null)).toBeNull();
  });

  test('ขึ้นต้น "คิว" แต่ไม่มีชื่อลูกค้าให้จับได้เลย → null (ข้อมูลไม่พอสร้างใบเสนอราคา)', () => {
    expect(parseLineQueueMessage('คิว 7')).toBeNull();
  });

  test('รายการมีเลขลำดับนำหน้า ("1." "2.") ตัดเลข+จุดออก, บรรทัดคำนวณ "700x2 =1,400" ตัดส่วนคำนวณออกเหลือแค่ชื่อ+ยอดรวม', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว 12',
        'คุณทดสอบหนึ่ง',
        '099-000-0001',
        'Isuzu D-max',
        '1กก1111',
        'อาการ: พวงมาลัยแข็ง',
        '',
        '1.ปั้มเพาเวอร์ รวมน้ำมัน + ค่าแรง 6,800',
        '2.น้ำมันเครื่อวาโอลีน 1,850',
        '3.กรองแท้ 350',
        '4.กรองอากาศแท้ 800',
        '5.กรองแอร์ 300',
        '6.กรองโซล่าแท้ 700',
        '7.น้ำยาหล่อเย็น 700x2 =1,400 ',
        '8.น้ำมันเฟืองท้าย 300x3=900 ',
        '9.ไล่น้ำมันเบรคทั้งระบบ 1,000',
        'รวม 14,100฿',
      ].join('\n')
    );
    expect(parsed.customer_name).toBe('คุณทดสอบหนึ่ง');
    expect(parsed.license_plate).toBe('1กก1111');
    expect(parsed.symptom).toBe('พวงมาลัยแข็ง');
    expect(parsed.items).toEqual([
      { name: 'ปั้มเพาเวอร์ รวมน้ำมัน + ค่าแรง', price: 6800 },
      { name: 'น้ำมันเครื่อวาโอลีน', price: 1850 },
      { name: 'กรองแท้', price: 350 },
      { name: 'กรองอากาศแท้', price: 800 },
      { name: 'กรองแอร์', price: 300 },
      { name: 'กรองโซล่าแท้', price: 700 },
      { name: 'น้ำยาหล่อเย็น', price: 1400 },
      { name: 'น้ำมันเฟืองท้าย', price: 900 },
      { name: 'ไล่น้ำมันเบรคทั้งระบบ', price: 1000 },
    ]);
    expect(parsed.stated_total).toBe(14100);
  });

  test('"ลูกค้าอนุมัติ" ท้ายรายการ (ไม่มียอดรวม) → ไม่ถูกเอาไปอยู่ในรายการ', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว 11 16/07/26',
        'คุณทดสอบสอง',
        '099-000-0002',
        'Toyota Revo',
        '2ขข2222',
        'แร๊คบิวท์ 5000',
        'ค่าแรง 2000',
        'ลูกหทากปลาย 555 1850',
        'ยางรัดกันโคลง 500',
        'ลูกค้าอนุมัติ',
      ].join('\n')
    );
    expect(parsed.items).toEqual([
      { name: 'แร๊คบิวท์', price: 5000 },
      { name: 'ค่าแรง', price: 2000 },
      { name: 'ลูกหทากปลาย 555', price: 1850 },
      { name: 'ยางรัดกันโคลง', price: 500 },
    ]);
  });

  test('"ลูกค้าอนุมัติ" ท้ายรายการหลังบรรทัด "รวม xxxx" → ยังไม่ถูกเอาไปอยู่ในรายการ', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว 12',
        'คุณทดสอบหนึ่ง',
        'อาการ: พวงมาลัยแข็ง',
        'ปั้มเพาเวอร์ 6800',
        'รวม 14,100฿',
        '',
        'ลูกค้าอนุมัติ',
      ].join('\n')
    );
    expect(parsed.items).toEqual([{ name: 'ปั้มเพาเวอร์', price: 6800 }]);
    expect(parsed.stated_total).toBe(14100);
  });

  test('ข้อความแจ้งชำระเงินแล้ว (ส่งข้อมูลคิวเดิมซ้ำพร้อมสรุปยอด/มัดจำ) → null ไม่จับข้อความนี้', () => {
    const msg = [
      'คิว 9 15/07/26',
      'คุณทดสอบสาม',
      '099-000-0003',
      'Toyota Vellfire',
      '3คค3333',
      'พวงมาลัยดัง และมีเสียงดังตอนสตาร์ทรถ',
      'แร็ค OEM 5,500',
      'ค่าแรง 2,000',
      'ชุดโปรช่วงล่าง 10,000',
      'ซ่อมคอ 2000',
      'ยอดรวม 19,500',
      'จ่ายมัดจำแล้ว 2000 บาท',
      '',
      'เหลือ 17,500',
      'ชำระเงินเรียบร้อยครับ',
    ].join('\n');
    expect(parseLineQueueMessage(msg)).toBeNull();
    expect(parseLineQueueMessage('คิว 5\nคุณหนึ่ง\nชำระเงินแล้วครับ')).toBeNull();
  });

  test('คิวซ้ำ/เลขคิวเดิม — พาร์สได้ตามปกติ ไม่ปฏิเสธ (ร้านพิมพ์คิวสับสนกันเป็นปกติ)', () => {
    const first = parseLineQueueMessage('คิว 5\nคุณหนึ่ง');
    const second = parseLineQueueMessage('คิว 5\nคุณสอง');
    expect(first.queue_no).toBe('5');
    expect(second.queue_no).toBe('5');
  });
});
