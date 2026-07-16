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

  test('คิวซ้ำ/เลขคิวเดิม — พาร์สได้ตามปกติ ไม่ปฏิเสธ (ร้านพิมพ์คิวสับสนกันเป็นปกติ)', () => {
    const first = parseLineQueueMessage('คิว 5\nคุณหนึ่ง');
    const second = parseLineQueueMessage('คิว 5\nคุณสอง');
    expect(first.queue_no).toBe('5');
    expect(second.queue_no).toBe('5');
  });
});
