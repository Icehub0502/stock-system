const parseLineQueueMessage = require('../src/utils/parseLineQueueMessage');

describe('parseLineQueueMessage', () => {
  test('แยกข้อความรูปแบบมาตรฐานของร้านครบทุกช่อง', () => {
    const parsed = parseLineQueueMessage(
      'คิว 1\nคุณพงศ์\n089-485-1623\nToyota Yaris\n9กธ7833\nเช็คช่วงล่าง'
    );
    expect(parsed).toEqual({
      queue_no: '1',
      customer_name: 'คุณพงศ์',
      phone: '0894851623',
      brand: 'Toyota',
      model: 'Yaris',
      license_plate: '9กธ7833',
      symptom: 'เช็คช่วงล่าง',
    });
  });

  test('สลับลำดับบรรทัดได้ (จำแนกจากหน้าตา ไม่ใช่ตำแหน่ง)', () => {
    const parsed = parseLineQueueMessage(
      'คิว 12\n9กธ7833\nToyota Yaris\nคุณพงศ์\n0894851623'
    );
    expect(parsed.queue_no).toBe('12');
    expect(parsed.customer_name).toBe('คุณพงศ์');
    expect(parsed.phone).toBe('0894851623');
    expect(parsed.license_plate).toBe('9กธ7833');
    expect(parsed.symptom).toBeNull();
  });

  test('ทะเบียนไม่มีเลขนำ (ฮย3371) และรุ่นรถมีคำไทยต่อท้าย', () => {
    const parsed = parseLineQueueMessage(
      'คิว 3\nคุณช้าง\nToyota Commuter หลังคาสูง\nฮย3371'
    );
    expect(parsed.license_plate).toBe('ฮย3371');
    expect(parsed.brand).toBe('Toyota');
    expect(parsed.model).toBe('Commuter หลังคาสูง');
  });

  test('ชื่อไม่ขึ้นต้นด้วย "คุณ" → ใช้บรรทัดแรกที่จำแนกไม่ได้เป็นชื่อ ที่เหลือเป็นอาการ', () => {
    const parsed = parseLineQueueMessage(
      'คิว 5\nพี่ต้น\nHonda City\nพวงมาลัยสั่น เข้าโค้งมีเสียง'
    );
    expect(parsed.customer_name).toBe('พี่ต้น');
    expect(parsed.symptom).toBe('พวงมาลัยสั่น เข้าโค้งมีเสียง');
  });

  test('ข้อความแชตทั่วไปที่ไม่ขึ้นต้น "คิว" → null', () => {
    expect(parseLineQueueMessage('พรุ่งนี้ร้านเปิดกี่โมงครับ')).toBeNull();
    expect(parseLineQueueMessage('')).toBeNull();
    expect(parseLineQueueMessage(null)).toBeNull();
  });

  test('มีแต่บรรทัด "คิว" ไม่มีชื่อลูกค้า → null (ข้อมูลไม่พอสร้างใบเสนอราคา)', () => {
    expect(parseLineQueueMessage('คิว 7')).toBeNull();
  });
});
