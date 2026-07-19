const parseLineQueueMessage = require('../src/utils/parseLineQueueMessage');

describe('parseLineQueueMessage', () => {
  test('รูปแบบจริงที่ร้านพิมพ์ (ไม่มีโคลอน/label เลย) — แยกครบทุกช่อง', () => {
    const parsed = parseLineQueueMessage(
      'คิว 2\nคุณนอก\n085-111-9565\nHonda Accord G8\n9กก4444\nเช็คช่วงล่าง'
    );
    expect(parsed.queue_no).toBe('2');
    expect(parsed.customer_name).toBe('คุณนอก');
    expect(parsed.phone).toBe('085-111-9565');
    expect(parsed.brand).toBe('Honda');
    expect(parsed.model).toBe('Accord G8');
    expect(parsed.license_plate).toBe('9กก4444');
    expect(parsed.symptom).toBe('เช็คช่วงล่าง');
    expect(parsed.items).toEqual([]);
  });

  test('pattern มีสีรถ + เลขไมล์ (บรรทัดเดี่ยว ไม่มี label) → แยกถูกช่อง อาการไม่หลุดไปเป็นรายการ', () => {
    const parsed = parseLineQueueMessage(
      'คิว4\n18/07/26\nคุณ ทดสอบหก\n099-000-0006\nToyota Altis 09\nทอง\n215170\nอาการ ขับมีเสียงดัง ก๊อกๆ'
    );
    expect(parsed.queue_no).toBe('4');
    expect(parsed.customer_name).toBe('คุณ ทดสอบหก');
    expect(parsed.phone).toBe('099-000-0006');
    expect(parsed.brand).toBe('Toyota');
    expect(parsed.model).toBe('Altis 09');
    expect(parsed.color).toBe('ทอง');
    expect(parsed.mileage).toBe(215170);
    expect(parsed.symptom).toBe('ขับมีเสียงดัง ก๊อกๆ');
    expect(parsed.items).toEqual([]);
  });

  test('สีแบบมีคำ "สี" นำหน้า / สีผสม ("สีขาวมุก") → ตัดคำว่า สี ออก', () => {
    const parsed = parseLineQueueMessage('คิว 5\nคุณทดสอบเจ็ด\nสีขาวมุก\n98,500');
    expect(parsed.color).toBe('ขาวมุก');
    expect(parsed.mileage).toBe(98500);
  });

  test('label ชัดเจน "เลขไมค์:" (สะกดแบบร้าน) และ "สีรถ:" ก็ใช้ได้', () => {
    const parsed = parseLineQueueMessage('คิว:6\nชื่อลูกค้า:คุณทดสอบแปด\nสีรถ:ดำ\nเลขไมค์:120000');
    expect(parsed.color).toBe('ดำ');
    expect(parsed.mileage).toBe(120000);
  });

  test('เลขไมล์ไม่กินราคาสินค้า — รายการยังแยกได้ปกติเมื่อมีทั้งไมล์และรายการ', () => {
    const parsed = parseLineQueueMessage(
      'คิว 7\nคุณทดสอบเก้า\n215170\nแร็ค OEM 5000\nซ่อมคอ 2000'
    );
    expect(parsed.mileage).toBe(215170);
    expect(parsed.items).toEqual([
      { name: 'แร็ค OEM', price: 5000 },
      { name: 'ซ่อมคอ', price: 2000 },
    ]);
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
      { name: 'น้ำยาหล่อเย็น', price: 1400, quantity: 2, unit_price: 700 },
      { name: 'น้ำมันเฟืองท้าย', price: 900, quantity: 3, unit_price: 300 },
      { name: 'ไล่น้ำมันเบรคทั้งระบบ', price: 1000 },
    ]);
    expect(parsed.stated_total).toBe(14100);
  });

  test('รายการ "ราคา*จำนวน" ("1700*2 3,400") → แยกราคาต่อหน่วย+จำนวน, สลับข้าง "2*1700" ก็ได้', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว4',
        '18/07/26',
        'คุณ ทดสอบสิบเอ็ด',
        '099-000-0011',
        'Toyota Altis 09',
        'ทอง',
        '215170',
        'แร็คใหม่ 4000',
        'ค่าแรง2000',
        'ชุดโปรช่วงล่างเก๋ง 6500',
        'ลูกปืนล้อหน้า L+R 1700*2 3,400',
      ].join('\n')
    );
    expect(parsed.color).toBe('ทอง');
    expect(parsed.mileage).toBe(215170);
    expect(parsed.items).toEqual([
      { name: 'แร็คใหม่', price: 4000 },
      { name: 'ค่าแรง', price: 2000 },
      { name: 'ชุดโปรช่วงล่างเก๋ง', price: 6500 },
      { name: 'ลูกปืนล้อหน้า L+R', price: 3400, quantity: 2, unit_price: 1700 },
    ]);
  });

  test('"จำนวน*ราคา" สลับข้าง / ไม่มียอดรวมต่อท้าย / ยอดรวมไม่ตรงแต่หารลงตัว → ใช้ยอดรวมเป็นหลัก', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว 5',
        'คุณทดสอบสิบสอง',
        'โช้คหน้า 2*1700',
        'ผ้าเบรค 2*950 1,900',
        'หัวเทียน 4*250 1,200', // 4*250=1000 แต่ยอดรวมพิมพ์ 1,200 → เชื่อยอดรวม (1200/4=300)
      ].join('\n')
    );
    expect(parsed.items).toEqual([
      { name: 'โช้คหน้า', price: 3400, quantity: 2, unit_price: 1700 },
      { name: 'ผ้าเบรค', price: 1900, quantity: 2, unit_price: 950 },
      { name: 'หัวเทียน', price: 1200, quantity: 4, unit_price: 300 },
    ]);
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

  test('"เพิ่มรายการ" คั่นก่อนรายการเพิ่มเติม + "ชำระเรียบร้อยครับ" ท้ายข้อความ (ไม่มีคำว่า "เงิน") → ไม่ใช่รายการสินค้าทั้งคู่ แต่รายการจริงยังถูกสร้างตามปกติ', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว 12',
        'คุณทดสอบหนึ่ง',
        'อาการ: พวงมาลัยแข็ง',
        '1.ปั้มเพาเวอร์ 6,800',
        '2.กรองแท้ 350',
        'เพิ่มรายการ',
        'ถ่ายน้ำมันเกียร์ทั้งระบบ 1450',
        'รวม 8,600฿',
        '',
        'ลูกค้าอนุมัติ',
        '',
        'ชำระเรียบร้อยครับ',
      ].join('\n')
    );
    expect(parsed.items).toEqual([
      { name: 'ปั้มเพาเวอร์', price: 6800 },
      { name: 'กรองแท้', price: 350 },
      { name: 'ถ่ายน้ำมันเกียร์ทั้งระบบ', price: 1450 },
    ]);
    expect(parsed.stated_total).toBe(8600);
  });

  test('ข้อความจริงของร้าน: "หมายเหตุ มัดจำ ..." ท้ายรายการ (หลัง "รวม xxxx") → ไม่ใช่รายการสินค้า (ไม่ใช่ item ที่ 6) ไปอยู่ในหมายเหตุแทน', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว 11 18/07',
        'คุณทดสอบสิบเอ็ด',
        '085-109-5665',
        'Honda HRV',
        '6กช1394',
        'ขาว',
        'แร๊ค โช๊ค ช่วงล่างรอเช็ค',
        'แร็ค 4500',
        'ค่าแรง 2000',
        'ชุดโปรช่วงล่างเก๋ง 7500',
        'แท่นเครื่องแท้ 3 ตัว 7500',
        'โช๊ค SHOWA 4 ตัว รวมอุปกรณ์ 16500',
        'รวม 38,000',
        'หมายเหตุ มัดจำ 2000',
      ].join('\n')
    );
    expect(parsed.queue_no).toBe('11');
    expect(parsed.phone).toBe('085-109-5665');
    expect(parsed.brand).toBe('Honda');
    expect(parsed.model).toBe('HRV');
    expect(parsed.license_plate).toBe('6กช1394');
    expect(parsed.color).toBe('ขาว');
    expect(parsed.symptom).toBe('แร๊ค โช๊ค ช่วงล่างรอเช็ค');
    expect(parsed.items).toEqual([
      { name: 'แร็ค', price: 4500 },
      { name: 'ค่าแรง', price: 2000 },
      { name: 'ชุดโปรช่วงล่างเก๋ง', price: 7500 },
      { name: 'แท่นเครื่องแท้ 3 ตัว', price: 7500 },
      { name: 'โช๊ค SHOWA 4 ตัว รวมอุปกรณ์', price: 16500 },
    ]);
    expect(parsed.stated_total).toBe(38000);
    expect(parsed.remark).toBe('มัดจำ 2000');
  });

  test('"หมายเหตุ ..." ในรายการโดยไม่มีคำว่า "มัดจำ" → ยังไปอยู่ในหมายเหตุ ไม่ใช่รายการสินค้า', () => {
    const parsed = parseLineQueueMessage(
      ['คิว 13', 'คุณทดสอบสิบสาม', 'รายการ', 'ค่าแรง 1000', 'หมายเหตุ นัดมาซ่อมอีกครั้งพรุ่งนี้'].join('\n')
    );
    expect(parsed.items).toEqual([{ name: 'ค่าแรง', price: 1000 }]);
    expect(parsed.remark).toBe('นัดมาซ่อมอีกครั้งพรุ่งนี้');
  });

  test('บรรทัด "มัดจำ ..." ในรายการโดยไม่มี label "หมายเหตุ" นำหน้า → ยังไปอยู่ในหมายเหตุ ไม่ใช่รายการสินค้า', () => {
    const parsed = parseLineQueueMessage(
      ['คิว 14', 'คุณทดสอบสิบสี่', 'รายการ', 'ค่าแรง 1000', 'มัดจำ 1000'].join('\n')
    );
    expect(parsed.items).toEqual([{ name: 'ค่าแรง', price: 1000 }]);
    expect(parsed.remark).toBe('มัดจำ 1000');
  });

  test('"หมายเหตุ" ก่อนเริ่มรายการสินค้า (ผ่าน OPTIONAL_LABELS เดิม) ยังทำงานเหมือนเดิม ไม่ถูกกระทบ', () => {
    const parsed = parseLineQueueMessage(
      ['คิว 15', 'คุณทดสอบสิบห้า', 'หมายเหตุ:ลูกค้าขอเก็บชิ้นส่วนเก่าคืน', 'รายการ', 'ค่าแรง 1000'].join('\n')
    );
    expect(parsed.remark).toBe('ลูกค้าขอเก็บชิ้นส่วนเก่าคืน');
    expect(parsed.items).toEqual([{ name: 'ค่าแรง', price: 1000 }]);
  });

  test('รายการมีเครื่องหมาย "-" นำหน้าราคา (ส่วนลด) → ราคาติดลบ, บรรทัดหัวข้อขึ้นต้น "-" ปกติยังตัดหัวข้อได้เหมือนเดิม', () => {
    const parsed = parseLineQueueMessage(
      [
        'คิว4',
        '17/7/69',
        'คุณทดสอบสี่',
        '099-000-0004',
        'Honda city',
        '4งง4444',
        'อาการ เช็คโช๊ค,ช่วงล่าง',
        'แรคไฟฟ้ายกเส้นรวมเทิร์น 6500',
        'ชุดโปรช่วงล่างเก๋ง 7000',
        'ยกครัช 9000',
        'โช๊คแท้ โชว่า4ต้นรวมค่าแรง+อุปกรณ์ 15000',
        'บู๊ทคานหลังรวมอัด 3500',
        'แท่นเครื่องแท้ 4 ตัว 9000',
        'แถมฟลัดชิ่งน้ำมันเบรค 4 ล้อ 0',
        'ส่วนลด -1000',
        'ผ้าเบรคหน้า ผ้าเบรคหลัง เจียรจาน 3000',
      ].join('\n')
    );
    expect(parsed.license_plate).toBe('4งง4444');
    expect(parsed.symptom).toBe('เช็คโช๊ค,ช่วงล่าง');
    expect(parsed.items).toEqual([
      { name: 'แรคไฟฟ้ายกเส้นรวมเทิร์น', price: 6500 },
      { name: 'ชุดโปรช่วงล่างเก๋ง', price: 7000 },
      { name: 'ยกครัช', price: 9000 },
      { name: 'โช๊คแท้ โชว่า4ต้นรวมค่าแรง+อุปกรณ์', price: 15000 },
      { name: 'บู๊ทคานหลังรวมอัด', price: 3500 },
      { name: 'แท่นเครื่องแท้ 4 ตัว', price: 9000 },
      { name: 'แถมฟลัดชิ่งน้ำมันเบรค 4 ล้อ', price: 0 },
      { name: 'ส่วนลด', price: -1000 },
      { name: 'ผ้าเบรคหน้า ผ้าเบรคหลัง เจียรจาน', price: 3000 },
    ]);
  });

  test('ราคาติดลบบรรทัดเดี่ยว ๆ (ชื่อรายการบรรทัดก่อนหน้ายังไม่มีราคา) → ยังจับเป็นราคาติดลบได้, ไม่ปนกับหัวข้อ "-" นำหน้าชื่อ', () => {
    const withPendingLine = parseLineQueueMessage(
      ['คิว 1', 'คุณเอ', 'รายการ', 'ส่วนลด', '-1000', 'ค่าแรง 500'].join('\n')
    );
    expect(withPendingLine.items).toEqual([
      { name: 'ส่วนลด', price: -1000 },
      { name: 'ค่าแรง', price: 500 },
    ]);

    const bulletStillWorks = parseLineQueueMessage(
      ['คิว 2', 'คุณบี', 'รายการ', '- แร็ค OEM 5000'].join('\n')
    );
    expect(bulletStillWorks.items).toEqual([{ name: 'แร็ค OEM', price: 5000 }]);
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

  describe('เทมเพลตใหม่ (ตอบกลับอัตโนมัติเมื่อพิมพ์ "คิว" เดี่ยว ๆ)', () => {
    test('round-trip เต็มรูปแบบ — ทุก label รวม alias ใหม่ + ส่วนชำระเงินแยกถูกฟิลด์', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 5',
          '18/07/69',
          'ชื่อ:คุณทดสอบเทมเพลต',
          'เบอโทรศัพท์:099-000-0099',
          'ยี่ห้อรถ:Toyota',
          'รุ่นรถ:Vios',
          'ทะเบียนรถ:1กก1234',
          'สีรถ:ขาว',
          'เลขไมค์:123456',
          'อาการ:เช็คช่วงล่าง',
          'รายการ:',
          'แร็ค OEM 5000',
          '',
          '<--สิ้นสุดรายการ-->',
          'ยอดรวม:5000',
          'หมายเหตุ:ลูกค้ารอรับรถ',
          'ยอดที่ต้องชำระ:0',
          'ช่องทางการชำระ:เงินสด',
          'ลูกค้าชำระเงิน:5000',
        ].join('\n')
      );
      expect(parsed.customer_name).toBe('คุณทดสอบเทมเพลต');
      expect(parsed.phone).toBe('099-000-0099');
      expect(parsed.brand).toBe('Toyota');
      expect(parsed.model).toBe('Vios');
      expect(parsed.license_plate).toBe('1กก1234');
      expect(parsed.color).toBe('ขาว');
      expect(parsed.mileage).toBe(123456);
      expect(parsed.symptom).toBe('เช็คช่วงล่าง');
      expect(parsed.items).toEqual([{ name: 'แร็ค OEM', price: 5000 }]);
      expect(parsed.stated_total).toBe(5000);
      expect(parsed.remaining_balance).toBe(0);
      expect(parsed.payment_method).toBe('เงินสด');
      expect(parsed.paid_amount).toBe(5000);
      expect(parsed.remark).toBe('ลูกค้ารอรับรถ');
    });

    test('เทมเพลตว่างเปล่าทั้งหมด (ยังไม่กรอกอะไรเลย) → ทุก label ว่าง เป็น null ไม่ใช่ ""', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 6',
          '18/07/69',
          'ชื่อ:คุณกรอกว่าง', // ต้องมีชื่อ ไม่งั้น parser คืน null ทั้งข้อความ
          'เบอโทรศัพท์:',
          'ยี่ห้อรถ:',
          'รุ่นรถ:',
          'ทะเบียนรถ:',
          'สีรถ:',
          'เลขไมค์:',
          'อาการ:',
          'รายการ:',
          '',
          '<--สิ้นสุดรายการ-->',
          'ยอดรวม:',
          'หมายเหตุ:',
          'ยอดที่ต้องชำระ:',
          'ช่องทางการชำระ:',
          'ลูกค้าชำระเงิน:',
        ].join('\n')
      );
      expect(parsed.phone).toBeNull();
      expect(parsed.brand).toBeNull();
      expect(parsed.model).toBeNull();
      expect(parsed.license_plate).toBeNull();
      expect(parsed.color).toBeNull();
      expect(parsed.mileage).toBeNull();
      expect(parsed.symptom).toBeNull();
      expect(parsed.items).toEqual([]);
      expect(parsed.stated_total).toBeNull();
      expect(parsed.remaining_balance).toBeNull();
      expect(parsed.payment_method).toBeNull();
      expect(parsed.paid_amount).toBeNull();
      expect(parsed.remark).toBeNull();
    });

    test('label ยาวต้องตัดถูกก่อน label สั้นที่เป็นคำนำหน้า — "ชื่อลูกค้า" vs "ชื่อ"', () => {
      const parsed = parseLineQueueMessage('คิว 1\nชื่อลูกค้า:คุณเอ');
      expect(parsed.customer_name).toBe('คุณเอ');
    });

    test('label ยาวต้องตัดถูกก่อน label สั้นที่เป็นคำนำหน้า — "เบอร์โทรศัพท์" vs "เบอร์โทร"', () => {
      const parsed = parseLineQueueMessage('คิว 1\nคุณบี\nเบอร์โทรศัพท์:0812345678');
      expect(parsed.phone).toBe('081-234-5678');
    });

    test('label ยาวต้องตัดถูกก่อน label สั้นที่เป็นคำนำหน้า — "เบอโทรศัพท์" vs "เบอโทร"', () => {
      const parsed = parseLineQueueMessage('คิว 1\nคุณซี\nเบอโทรศัพท์:0898765432');
      expect(parsed.phone).toBe('089-876-5432');
    });

    test('end marker หยุดเก็บรายการทันที — บรรทัดหลัง marker ไม่ถูกตีเป็นรายการสินค้า', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 2',
          'คุณดี',
          'รายการ:',
          'แร็ค OEM 5000',
          '<--สิ้นสุดรายการ-->',
          'ยอดที่ต้องชำระ:2000',
        ].join('\n')
      );
      expect(parsed.items).toEqual([{ name: 'แร็ค OEM', price: 5000 }]);
      expect(parsed.remaining_balance).toBe(2000);
    });

    test('ช่องทางการชำระ: "QRcode"/"qrcode"/"QR" → normalize เป็น "QRCode" เป๊ะ (ตรงกับ select ฝั่งหน้าเว็บ)', () => {
      const variants = ['QRcode', 'qrcode', 'QR', 'qr code'];
      for (const variant of variants) {
        const parsed = parseLineQueueMessage(
          `คิว 3\nคุณอี\nรายการ:\n<--สิ้นสุดรายการ-->\nช่องทางการชำระ:${variant}`
        );
        expect(parsed.payment_method).toBe('QRCode');
      }
    });

    test('ช่องทางการชำระที่จำไม่ได้ → คงข้อความเดิมไว้ (ให้หน้างานแก้เองในแอป)', () => {
      const parsed = parseLineQueueMessage(
        'คิว 3\nคุณเอฟ\nรายการ:\n<--สิ้นสุดรายการ-->\nช่องทางการชำระ:เช็คธนาคาร'
      );
      expect(parsed.payment_method).toBe('เช็คธนาคาร');
    });

    test('ตัวเลขมี comma คั่นในส่วนชำระเงิน → parse ได้ถูกต้อง', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 4',
          'คุณจี',
          'รายการ:',
          '<--สิ้นสุดรายการ-->',
          'ยอดรวม:34,000',
          'ยอดที่ต้องชำระ:2,000',
          'ลูกค้าชำระเงิน:32,000',
        ].join('\n')
      );
      expect(parsed.stated_total).toBe(34000);
      expect(parsed.remaining_balance).toBe(2000);
      expect(parsed.paid_amount).toBe(32000);
    });

    test('PAID_MESSAGE_RE ไม่จับ "ลูกค้าชำระเงิน:" ในเทมเพลต — ข้อความทั้งบิลยังถูกพาร์สปกติ ไม่ถูกทิ้งเหมือนข้อความ "ชำระเงินแล้ว"', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 8',
          'คุณเอช',
          'รายการ:',
          'ค่าแรง 2000',
          '<--สิ้นสุดรายการ-->',
          'ยอดรวม:2000',
          'ลูกค้าชำระเงิน:2000',
        ].join('\n')
      );
      expect(parsed).not.toBeNull();
      expect(parsed.paid_amount).toBe(2000);
      expect(parsed.items).toEqual([{ name: 'ค่าแรง', price: 2000 }]);
    });
  });
});
