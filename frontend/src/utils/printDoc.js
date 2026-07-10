export const COMPANY = {
  legalName: 'บริษัท เจพีเอ็ม โซลูชั่น จำกัด',
  brandName: 'แชมป์เพาเวอร์ สมุทรปราการ',
  address: 'เลขที่ 784 หมู่ 4 ซอยแพรกษา 12 ตำบลแพรกษา อำเภอเมืองสมุทรปราการ จังหวัดสมุทรปราการ 10280',
  taxId: '0115569004059 (สำนักงานใหญ่)',
  phone: '093-824-5551',
  line: '@Champ5',
  branch: 'สาขาสมุทรปราการ',
};

export const amountToWords = (amount) => {
  const units = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const positions = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  if (amount === 0) return 'ศูนย์บาทถ้วน';

  const integerPart = Math.floor(amount);
  const baht = integerPart.toString().split('').reverse();
  const words = [];

  for (let i = 0; i < baht.length; i += 1) {
    const digit = Number(baht[i]);
    const pos = i % 6;
    if (digit === 0) {
      if (pos === 0 && i > 0) words.unshift('ล้าน');
      continue;
    }

    if (pos === 0 && i > 0) {
      if (digit === 1) words.unshift('หนึ่ง');
      else words.unshift(units[digit]);
      words.unshift('ล้าน');
      continue;
    }

    if (pos === 1) {
      if (digit === 1) words.unshift('สิบ');
      else if (digit === 2) words.unshift('ยี่สิบ');
      else if (digit > 2) words.unshift(`${units[digit]}${positions[pos]}`);
      continue;
    }

    if (pos === 0 && digit === 1 && i > 0) {
      words.unshift('เอ็ด');
      continue;
    }

    words.unshift(`${units[digit]}${positions[pos]}`);
  }

  const satang = Math.round((amount - integerPart) * 100);
  let result = `${words.join('')}บาท`;
  if (satang === 0) {
    result += 'ถ้วน';
  } else {
    result += `${amountToWords(satang).replace('บาทถ้วน', '')}สตางค์`;
  }

  return result;
};
