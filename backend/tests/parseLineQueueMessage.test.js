const parseLineQueueMessage = require('../src/utils/parseLineQueueMessage');

describe('parseLineQueueMessage', () => {
  describe('เลขคิว/วันที่บรรทัดที่สอง', () => {
    test('"คิว 2" อ่านเลขคิวได้ปกติ', () => {
      const parsed = parseLineQueueMessage('คิว 2\nชื่อ:คุณทดสอบ');
      expect(parsed.queue_no).toBe('2');
    });

    test('"คิวที่10" (คำว่า "ที่" แปะติดเลขคิว ไม่มีช่องว่าง) → อ่านเลขคิวได้ถูกต้อง', () => {
      const parsed = parseLineQueueMessage('คิวที่10\nชื่อ:คุณเอกชัย');
      expect(parsed.queue_no).toBe('10');
    });

    test('"คิว4" ติดกันไม่มีช่องว่างก็อ่านเลขคิวได้', () => {
      const parsed = parseLineQueueMessage('คิว4\nชื่อ:คุณแอน');
      expect(parsed.queue_no).toBe('4');
    });

    test('"คิว:2" (โคลอนติดคำว่าคิว) ก็อ่านได้', () => {
      const parsed = parseLineQueueMessage('คิว:2\nชื่อ:คุณบี');
      expect(parsed.queue_no).toBe('2');
    });

    test('"คิว 1 17/07/26" (มีวันที่ต่อท้ายเลขคิว) → queue_no ตัดแค่เลขคิว', () => {
      const parsed = parseLineQueueMessage('คิว 1 17/07/26\nชื่อ:คุณศิริลักษณ์');
      expect(parsed.queue_no).toBe('1');
    });

    test('บรรทัดวันที่เดี่ยว ๆ (dd/m/yy) ที่สอง ไม่ถูกใช้และไม่หลุดไปปนกับอาการ', () => {
      const parsed = parseLineQueueMessage(
        'คิวที่10\n16/7/69\nชื่อ:คุณเอกชัย\nอาการ:เลี้ยวติดตัวถัง'
      );
      const today = new Date();
      const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      expect(parsed.quotation_date).toBe(expected);
      expect(parsed.symptom).toBe('เลี้ยวติดตัวถัง');
      expect(parsed.symptom).not.toMatch(/69/);
    });

    test('label วันที่ ก็ถูกข้ามเหมือนกัน ไม่ปนกับอาการ', () => {
      const parsed = parseLineQueueMessage(
        'คิว 9\nวันที่:17/07/26\nชื่อ:คุณเทสไลน์\nอาการ:เช็คช่วงล่าง'
      );
      expect(parsed.symptom).toBe('เช็คช่วงล่าง');
    });
  });

  describe('label หัวบิล — ฟิลด์ทั้งหมดมาจาก label เท่านั้น (ไม่มีการเดาจากหน้าตาบรรทัดอีกต่อไป)', () => {
    test('label ครบทุกช่อง (โคลอนมีหรือไม่มีก็ได้)', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 1',
          'ชื่อลูกค้า:คุณบี',
          'เบอร์โทร:0812345678',
          'ยี่ห้อรถ:Honda รุ่นรถ:Civic',
          'ทะเบียนรถ:3กอ5222',
          'สีรถ:ดำ',
          'เลขไมล์:120000',
          'อาการ:เช็คช่วงล่าง',
        ].join('\n')
      );
      expect(parsed.customer_name).toBe('คุณบี');
      expect(parsed.phone).toBe('081-234-5678');
      expect(parsed.brand).toBe('Honda');
      expect(parsed.model).toBe('Civic');
      expect(parsed.license_plate).toBe('3กอ5222');
      expect(parsed.color).toBe('ดำ');
      expect(parsed.mileage).toBe(120000);
      expect(parsed.symptom).toBe('เช็คช่วงล่าง');
    });

    test('เลขไมค์ สะกดแบบที่ร้านพิมพ์จริง ก็ใช้ได้เหมือน เลขไมล์', () => {
      const parsed = parseLineQueueMessage('คิว:6\nชื่อลูกค้า:คุณทดสอบแปด\nเลขไมค์:120000');
      expect(parsed.mileage).toBe(120000);
    });

    test('label ยาวต้องตัดถูกก่อน label สั้นที่เป็นคำนำหน้า — ชื่อลูกค้า vs ชื่อ', () => {
      const parsed = parseLineQueueMessage('คิว 1\nชื่อลูกค้า:คุณเอ');
      expect(parsed.customer_name).toBe('คุณเอ');
    });

    test('label ยาวต้องตัดถูกก่อน label สั้นที่เป็นคำนำหน้า — เบอร์โทรศัพท์ vs เบอร์โทร', () => {
      const parsed = parseLineQueueMessage('คิว 1\nชื่อ:คุณบี\nเบอร์โทรศัพท์:0812345678');
      expect(parsed.phone).toBe('081-234-5678');
    });

    test('label ยาวต้องตัดถูกก่อน label สั้นที่เป็นคำนำหน้า — เบอโทรศัพท์ vs เบอโทร', () => {
      const parsed = parseLineQueueMessage('คิว 1\nชื่อ:คุณซี\nเบอโทรศัพท์:0898765432');
      expect(parsed.phone).toBe('089-876-5432');
    });

    test('บรรทัดที่ไม่ตรง label ที่รู้จักเลย ถูกข้ามเงียบ ๆ ไม่ถูกเดาเป็นชื่อ/อาการ', () => {
      const parsed = parseLineQueueMessage('คิว 1\nชื่อ:คุณดี\nสวัสดีครับ\nToyota Vios');
      expect(parsed.customer_name).toBe('คุณดี');
      expect(parsed.brand).toBeNull();
      expect(parsed.symptom).toBeNull();
    });
  });

  describe('เงื่อนไขคืน null', () => {
    test('ข้อความไม่ขึ้นต้นด้วย คิว → null (แชตทั่วไปในกลุ่ม)', () => {
      expect(parseLineQueueMessage('พรุ่งนี้ร้านเปิดกี่โมงครับ')).toBeNull();
      expect(parseLineQueueMessage('')).toBeNull();
      expect(parseLineQueueMessage(null)).toBeNull();
    });

    test('ขึ้นต้น คิว แต่ไม่มี label ชื่อลูกค้าเลย → null (ข้อมูลไม่พอสร้างใบเสนอราคา)', () => {
      expect(parseLineQueueMessage('คิว 7')).toBeNull();
    });

    test('ข้อความรูปแบบเก่า (ไม่มี label เลย พิมพ์ชื่อ/เบอร์/ทะเบียนแบบ freeform) → null (แพทเทินเก่าถูกถอดออกแล้ว)', () => {
      const parsed = parseLineQueueMessage(
        'คิว 2\nคุณนอก\n085-111-9565\nHonda Accord G8\n9กก4444\nเช็คช่วงล่าง'
      );
      expect(parsed).toBeNull();
    });
  });

  describe('รายการสินค้า — เริ่มนับเฉพาะหลัง รายการ: เท่านั้น', () => {
    test('บรรทัดลงท้ายด้วยราคาโดยไม่มี รายการ: นำหน้า → ไม่ถูกเก็บเป็นรายการ (ไม่มีการเริ่ม section อัตโนมัติอีกต่อไป)', () => {
      const parsed = parseLineQueueMessage('คิว 4\nชื่อ:คุณเอ\nแร็ค OEM 5000');
      expect(parsed.items).toEqual([]);
    });

    test('รายการ (ไม่มีโคลอนก็ได้) เริ่ม section รายการแบบระบุชัดเจน — บรรทัดขึ้นต้น - ตัดเครื่องหมายออก', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 4',
          'ชื่อ:คุณแอน',
          'อาการ:ช่วงล่างดัง',
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

    test('ชื่อรายการกับราคาคนละบรรทัด รวมเป็นรายการเดียว, มีบรรทัด รวม → stated_total', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว:4',
          'ชื่อ:คุณแอน',
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
      const parsed = parseLineQueueMessage('คิว 4\nชื่อ:คุณอี\nรายการ\nชุดโปรช่วงล่าง เก๋ง');
      expect(parsed.items).toEqual([{ name: 'ชุดโปรช่วงล่าง เก๋ง', price: null }]);
    });

    test('บรรทัดโปรโมทที่คัดลอกมาทั้งย่อหน้า ไม่ถูกตีเป็นรายการ ไปอยู่ในหมายเหตุแทน', () => {
      const blob = 'ชุดโปร ช่วงล่าง                                   สินค้าประกัน 1 ปี 10000กิโล                             รายการสินค้าที่จะได้🛠️                              -ปีกนกล่าง -ลูกหมากปีกนก -ลูกหมากปลาย-ลูกหมากกันโครงหน้า -ยางรัดกันโครงหน้า -                                 ราคารวมค่าแรงติดตั้ง รวมตั้งศูนย์7500';
      const parsed = parseLineQueueMessage(
        ['คิวที่10', 'ชื่อ:คุณเอกชัย', 'อาการ:เลี้ยวติดตัวถัง', 'รายการ:', 'แร็ค OEM 5000', blob, 'ซ่อมคอ 2000'].join('\n')
      );
      expect(parsed.items).toEqual([
        { name: 'แร็ค OEM', price: 5000 },
        { name: 'ซ่อมคอ', price: 2000 },
      ]);
      expect(parsed.remark).toBe(blob);
    });

    test('รายการมีเลขลำดับนำหน้า ตัดเลข+จุดออก, บรรทัดคำนวณตัดส่วนคำนวณออกเหลือแค่ชื่อ+ยอดรวม', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 12',
          'ชื่อ:คุณทดสอบหนึ่ง',
          'อาการ: พวงมาลัยแข็ง',
          'รายการ:',
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

    test('รายการ ราคา*จำนวน แยกราคาต่อหน่วย+จำนวน, สลับข้างก็ได้', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว4',
          'ชื่อ:คุณทดสอบสิบเอ็ด',
          'รายการ:',
          'แร็คใหม่ 4000',
          'ค่าแรง2000',
          'ชุดโปรช่วงล่างเก๋ง 6500',
          'ลูกปืนล้อหน้า L+R 1700*2 3,400',
        ].join('\n')
      );
      expect(parsed.items).toEqual([
        { name: 'แร็คใหม่', price: 4000 },
        { name: 'ค่าแรง', price: 2000 },
        { name: 'ชุดโปรช่วงล่างเก๋ง', price: 6500 },
        { name: 'ลูกปืนล้อหน้า L+R', price: 3400, quantity: 2, unit_price: 1700 },
      ]);
    });

    test('จำนวน*ราคา สลับข้าง / ไม่มียอดรวมต่อท้าย / ยอดรวมไม่ตรงแต่หารลงตัว → ใช้ยอดรวมเป็นหลัก', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 5',
          'ชื่อ:คุณทดสอบสิบสอง',
          'รายการ:',
          'โช้คหน้า 2*1700',
          'ผ้าเบรค 2*950 1,900',
          'หัวเทียน 4*250 1,200',
        ].join('\n')
      );
      expect(parsed.items).toEqual([
        { name: 'โช้คหน้า', price: 3400, quantity: 2, unit_price: 1700 },
        { name: 'ผ้าเบรค', price: 1900, quantity: 2, unit_price: 950 },
        { name: 'หัวเทียน', price: 1200, quantity: 4, unit_price: 300 },
      ]);
    });

    test('ลูกค้าอนุมัติ ท้ายรายการ (ไม่มียอดรวม) → ไม่ถูกเอาไปอยู่ในรายการ', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 11',
          'ชื่อ:คุณทดสอบสอง',
          'รายการ:',
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

    test('ลูกค้าอนุมัติ ท้ายรายการหลังบรรทัด รวม xxxx → ยังไม่ถูกเอาไปอยู่ในรายการ', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 12',
          'ชื่อ:คุณทดสอบหนึ่ง',
          'อาการ: พวงมาลัยแข็ง',
          'รายการ:',
          'ปั้มเพาเวอร์ 6800',
          'รวม 14,100฿',
          '',
          'ลูกค้าอนุมัติ',
        ].join('\n')
      );
      expect(parsed.items).toEqual([{ name: 'ปั้มเพาเวอร์', price: 6800 }]);
      expect(parsed.stated_total).toBe(14100);
    });

    test('เพิ่มรายการ คั่นก่อนรายการเพิ่มเติม + ชำระเรียบร้อยครับ ท้ายข้อความ → ไม่ใช่รายการสินค้าทั้งคู่ แต่รายการจริงยังถูกสร้างตามปกติ และตั้ง paid_confirmed', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 12',
          'ชื่อ:คุณทดสอบหนึ่ง',
          'อาการ: พวงมาลัยแข็ง',
          'รายการ:',
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
      expect(parsed.paid_confirmed).toBe(true);
    });

    test('หมายเหตุ มัดจำ ท้ายรายการ (หลัง รวม xxxx) → ไม่ใช่รายการสินค้า ไปอยู่ในหมายเหตุแทน', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 11',
          'ชื่อ:คุณทดสอบสิบเอ็ด',
          'อาการ:แร๊ค โช๊ค ช่วงล่างรอเช็ค',
          'รายการ:',
          'แร็ค 4500',
          'ค่าแรง 2000',
          'ชุดโปรช่วงล่างเก๋ง 7500',
          'แท่นเครื่องแท้ 3 ตัว 7500',
          'โช๊ค SHOWA 4 ตัว รวมอุปกรณ์ 16500',
          'รวม 38,000',
          'หมายเหตุ มัดจำ 2000',
        ].join('\n')
      );
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

    test('หมายเหตุ ในรายการโดยไม่มีคำว่า มัดจำ → ยังไปอยู่ในหมายเหตุ ไม่ใช่รายการสินค้า', () => {
      const parsed = parseLineQueueMessage(
        ['คิว 13', 'ชื่อ:คุณทดสอบสิบสาม', 'รายการ', 'ค่าแรง 1000', 'หมายเหตุ นัดมาซ่อมอีกครั้งพรุ่งนี้'].join('\n')
      );
      expect(parsed.items).toEqual([{ name: 'ค่าแรง', price: 1000 }]);
      expect(parsed.remark).toBe('นัดมาซ่อมอีกครั้งพรุ่งนี้');
    });

    test('บรรทัด มัดจำ ในรายการโดยไม่มี label หมายเหตุ นำหน้า → ยังไปอยู่ในหมายเหตุ ไม่ใช่รายการสินค้า', () => {
      const parsed = parseLineQueueMessage(
        ['คิว 14', 'ชื่อ:คุณทดสอบสิบสี่', 'รายการ', 'ค่าแรง 1000', 'มัดจำ 1000'].join('\n')
      );
      expect(parsed.items).toEqual([{ name: 'ค่าแรง', price: 1000 }]);
      expect(parsed.remark).toBe('มัดจำ 1000');
    });

    test('หมายเหตุ: ก่อนเริ่มรายการสินค้า (ผ่าน OPTIONAL_LABELS หัวบิล) ยังทำงานเหมือนเดิม ไม่ถูกกระทบ', () => {
      const parsed = parseLineQueueMessage(
        ['คิว 15', 'ชื่อ:คุณทดสอบสิบห้า', 'หมายเหตุ:ลูกค้าขอเก็บชิ้นส่วนเก่าคืน', 'รายการ', 'ค่าแรง 1000'].join('\n')
      );
      expect(parsed.remark).toBe('ลูกค้าขอเก็บชิ้นส่วนเก่าคืน');
      expect(parsed.items).toEqual([{ name: 'ค่าแรง', price: 1000 }]);
    });

    test('รายการมีเครื่องหมาย - นำหน้าราคา (ส่วนลด) → ราคาติดลบ, บรรทัดหัวข้อขึ้นต้น - ปกติยังตัดหัวข้อได้เหมือนเดิม', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว4',
          'ชื่อ:คุณทดสอบสี่',
          'อาการ:เช็คโช๊ค,ช่วงล่าง',
          'รายการ:',
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

    test('ราคาติดลบบรรทัดเดี่ยว ๆ (ชื่อรายการบรรทัดก่อนหน้ายังไม่มีราคา) → ยังจับเป็นราคาติดลบได้', () => {
      const withPendingLine = parseLineQueueMessage(
        ['คิว 1', 'ชื่อ:คุณเอ', 'รายการ', 'ส่วนลด', '-1000', 'ค่าแรง 500'].join('\n')
      );
      expect(withPendingLine.items).toEqual([
        { name: 'ส่วนลด', price: -1000 },
        { name: 'ค่าแรง', price: 500 },
      ]);

      const bulletStillWorks = parseLineQueueMessage(
        ['คิว 2', 'ชื่อ:คุณบี', 'รายการ', '- แร็ค OEM 5000'].join('\n')
      );
      expect(bulletStillWorks.items).toEqual([{ name: 'แร็ค OEM', price: 5000 }]);
    });
  });

  describe('เทมเพลตใหม่ (ตอบกลับอัตโนมัติเมื่อพิมพ์ คิว เดี่ยว ๆ)', () => {
    test('round-trip เต็มรูปแบบ — ทุก label รวม alias ใหม่ + ส่วนชำระเงินแยกถูกฟิลด์ + paid_confirmed จากวลีท้ายข้อความ', () => {
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
          '',
          '<--ลูกค้าชำระเงิน-->',
          'ช่องทางการชำระ:เงินสด',
          'ลูกค้าชำระเงิน:5000',
          'ลูกค้าชำระเงินเรียบร้อย',
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
      expect(parsed.paid_confirmed).toBe(true);
      expect(parsed.remark).toBe('ลูกค้ารอรับรถ');
    });

    test('เทมเพลตว่างเปล่าทั้งหมด (ยังไม่กรอกอะไรเลย) → ทุก label ว่าง เป็น null ไม่ใช่ empty string และ paid_confirmed เป็น false', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 6',
          '18/07/69',
          'ชื่อ:คุณกรอกว่าง',
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
          '',
          '<--ลูกค้าชำระเงิน-->',
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
      expect(parsed.paid_confirmed).toBe(false);
      expect(parsed.remark).toBeNull();
    });

    test('end marker หยุดเก็บรายการทันที — บรรทัดหลัง marker ไม่ถูกตีเป็นรายการสินค้า', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 2',
          'ชื่อ:คุณดี',
          'รายการ:',
          'แร็ค OEM 5000',
          '<--สิ้นสุดรายการ-->',
          'ยอดที่ต้องชำระ:2000',
        ].join('\n')
      );
      expect(parsed.items).toEqual([{ name: 'แร็ค OEM', price: 5000 }]);
      expect(parsed.remaining_balance).toBe(2000);
    });

    test('เส้นแบ่งจัดหน้าที่สอง เป็นแค่ marker — label ฝั่งไหนของเส้นนี้ก็อ่านได้เหมือนกัน', () => {
      const beforeDivider = parseLineQueueMessage(
        [
          'คิว 2',
          'ชื่อ:คุณดี',
          'รายการ:',
          '<--สิ้นสุดรายการ-->',
          'ช่องทางการชำระ:เงินสด',
          '<--ลูกค้าชำระเงิน-->',
          'ยอดรวม:1000',
        ].join('\n')
      );
      expect(beforeDivider.payment_method).toBe('เงินสด');
      expect(beforeDivider.stated_total).toBe(1000);

      const afterDivider = parseLineQueueMessage(
        [
          'คิว 3',
          'ชื่อ:คุณอี',
          'รายการ:',
          '<--สิ้นสุดรายการ-->',
          '<--ลูกค้าชำระเงิน-->',
          'ยอดรวม:2000',
          'ช่องทางการชำระ:โอน',
        ].join('\n')
      );
      expect(afterDivider.stated_total).toBe(2000);
      expect(afterDivider.payment_method).toBe('โอน');
    });

    test('ช่องทางการชำระ QRcode/qrcode/QR → normalize เป็น QRCode เป๊ะ', () => {
      const variants = ['QRcode', 'qrcode', 'QR', 'qr code'];
      for (const variant of variants) {
        const parsed = parseLineQueueMessage(
          `คิว 3\nชื่อ:คุณอี\nรายการ:\n<--สิ้นสุดรายการ-->\nช่องทางการชำระ:${variant}`
        );
        expect(parsed.payment_method).toBe('QRCode');
      }
    });

    test('ช่องทางการชำระที่จำไม่ได้ → คงข้อความเดิมไว้', () => {
      const parsed = parseLineQueueMessage(
        'คิว 3\nชื่อ:คุณเอฟ\nรายการ:\n<--สิ้นสุดรายการ-->\nช่องทางการชำระ:เช็คธนาคาร'
      );
      expect(parsed.payment_method).toBe('เช็คธนาคาร');
    });

    test('ตัวเลขมี comma คั่นในส่วนชำระเงิน → parse ได้ถูกต้อง', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 4',
          'ชื่อ:คุณจี',
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

    test('ลูกค้าชำระเงิน: กรอกมา (มีค่า) แต่ไม่มีวลีแจ้งจ่ายเงินแล้ว → paid_confirmed ยังเป็น false', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 8',
          'ชื่อ:คุณเอช',
          'รายการ:',
          'ค่าแรง 2000',
          '<--สิ้นสุดรายการ-->',
          'ยอดรวม:2000',
          'ลูกค้าชำระเงิน:2000',
        ].join('\n')
      );
      expect(parsed).not.toBeNull();
      expect(parsed.paid_amount).toBe(2000);
      expect(parsed.paid_confirmed).toBe(false);
      expect(parsed.items).toEqual([{ name: 'ค่าแรง', price: 2000 }]);
    });
  });

  describe('วลีแจ้งจ่ายเงินแล้ว (paid_confirmed) — สัญญาณปิดบิลใหม่', () => {
    test.each([
      ['ชำระเงินเรียบร้อย'],
      ['จ่ายเงินเรียบร้อย'],
      ['ลูกค้าชำระเงินเรียบร้อย'],
      ['ลูกค้าชำระแล้ว'],
    ])('วลี %s บรรทัดสุดท้าย → paid_confirmed = true', (phrase) => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 1',
          'ชื่อ:คุณเอ',
          'รายการ:',
          'ค่าแรง 1000',
          '<--สิ้นสุดรายการ-->',
          'ยอดรวม:1000',
          'ช่องทางการชำระ:เงินสด',
          'ลูกค้าชำระเงิน:1000',
          phrase,
        ].join('\n')
      );
      expect(parsed.paid_confirmed).toBe(true);
    });

    test('วลีแจ้งจ่ายเงินแล้วไม่มีตัวเลขยอดเงินเลย → paid_confirmed = true', () => {
      const parsed = parseLineQueueMessage(
        ['คิว 2', 'ชื่อ:คุณบี', 'รายการ:', 'ค่าแรง 1000', '<--สิ้นสุดรายการ-->', 'ชำระเงินเรียบร้อย'].join('\n')
      );
      expect(parsed.paid_confirmed).toBe(true);
      expect(parsed.paid_amount).toBeNull();
      expect(parsed.stated_total).toBeNull();
    });

    test('วลีอยู่ในรายการสินค้า (ก่อนถึงส่วนชำระเงิน) → ยังตั้ง paid_confirmed ได้ และไม่ถูกเก็บเป็นรายการ', () => {
      const parsed = parseLineQueueMessage(
        ['คิว 3', 'ชื่อ:คุณซี', 'รายการ:', 'ค่าแรง 1000', 'ชำระเงินเรียบร้อย', '<--สิ้นสุดรายการ-->'].join('\n')
      );
      expect(parsed.paid_confirmed).toBe(true);
      expect(parsed.items).toEqual([{ name: 'ค่าแรง', price: 1000 }]);
    });

    test('วลีอยู่ก่อนเส้นแบ่งที่สอง → ยังตั้ง paid_confirmed ได้', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 4',
          'ชื่อ:คุณดี',
          'รายการ:',
          'ค่าแรง 1000',
          '<--สิ้นสุดรายการ-->',
          'ยอดรวม:1000',
          'จ่ายเงินเรียบร้อย',
          '<--ลูกค้าชำระเงิน-->',
          'ช่องทางการชำระ:เงินสด',
        ].join('\n')
      );
      expect(parsed.paid_confirmed).toBe(true);
    });

    test('วลีอยู่หลังเส้นแบ่งที่สอง (ตำแหน่งตามเทมเพลตจริง) → ยังตั้ง paid_confirmed ได้', () => {
      const parsed = parseLineQueueMessage(
        [
          'คิว 5',
          'ชื่อ:คุณอี',
          'รายการ:',
          'ค่าแรง 1000',
          '<--สิ้นสุดรายการ-->',
          'ยอดรวม:1000',
          '<--ลูกค้าชำระเงิน-->',
          'ช่องทางการชำระ:เงินสด',
          'ลูกค้าชำระเงิน:1000',
          'ลูกค้าชำระแล้ว',
        ].join('\n')
      );
      expect(parsed.paid_confirmed).toBe(true);
    });
  });
});
