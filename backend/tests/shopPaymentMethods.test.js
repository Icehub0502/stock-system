// Each branch has its own payment methods (banks): the LINE template lists them, and a closing message is read by them.
const {
  normalizePaymentMethod, parseSplitsFromText, resolveSplits, validatePaymentMethods, fillPaymentMethods, DEFAULT_PAYMENT_METHODS,
} = require('../src/utils/paymentMethods');
const parseLineQueueMessage = require('../src/utils/parseLineQueueMessage');

const KBANK_SHOP = ['กสิกร', 'เงินสด', 'บัตรเครดิต'];

describe('a branch payment method list', () => {
  test('a typed bank name finds the branch method whatever the branch called it', () => {
    expect(normalizePaymentMethod('กสิกร', KBANK_SHOP)).toBe('กสิกร');
    expect(normalizePaymentMethod('KBank', KBANK_SHOP)).toBe('กสิกร');
    expect(normalizePaymentMethod('ธนาคารกสิกรไทย', KBANK_SHOP)).toBe('กสิกร');
    expect(normalizePaymentMethod('kbank', ['ธนาคารกสิกรไทย', 'เงินสด'])).toBe('ธนาคารกสิกรไทย');
  });

  test('a bank the branch does not list stays as typed', () => {
    expect(normalizePaymentMethod('ออมสิน', KBANK_SHOP)).toBe('ออมสิน');
    expect(normalizePaymentMethod('kbank')).toBe('kbank');
  });

  test('the default list still reads as before', () => {
    expect(normalizePaymentMethod('gsb')).toBe('ออมสิน');
    expect(normalizePaymentMethod('บัตร')).toBe('บัตรเครดิต');
  });

  test('a payment split by the branch banks', () => {
    expect(parseSplitsFromText('เงินสด 500 + kbank 1500', KBANK_SHOP)).toEqual([
      { method: 'เงินสด', amount: 500 }, { method: 'กสิกร', amount: 1500 },
    ]);
    expect(parseSplitsFromText('เงินสด 500 + kbank 1500')).toEqual([]);
    expect(resolveSplits([{ method: 'กสิกร', amount: null }, { method: 'เงินสด', amount: 500 }], 2000, KBANK_SHOP).splits)
      .toEqual([{ method: 'กสิกร', amount: 1500 }, { method: 'เงินสด', amount: 500 }]);
    expect(resolveSplits([{ method: 'ออมสิน', amount: 1500 }, { method: 'เงินสด', amount: 500 }], 2000, KBANK_SHOP).error)
      .toMatch(/ออมสิน/);
  });

  test('names that would break the template or a split are refused', () => {
    expect(validatePaymentMethods(['กสิกร', ' เงินสด ']).methods).toEqual(['กสิกร', 'เงินสด']);
    expect(validatePaymentMethods([]).error).toBeTruthy();
    expect(validatePaymentMethods('กสิกร').error).toBeTruthy();
    expect(validatePaymentMethods(['ก/ข']).error).toBeTruthy();
    expect(validatePaymentMethods(['ธนาคาร 2']).error).toBeTruthy();
    expect(validatePaymentMethods(['เงินสดและโอน']).error).toBeTruthy();
    expect(validatePaymentMethods(['กสิกร', 'KBank']).error).toMatch(/ซ้ำ/);
    expect(validatePaymentMethods(['กสิกร', 'กสิกร']).error).toMatch(/ซ้ำ/);
    expect(validatePaymentMethods(Array(13).fill(0).map((_, i) => `ช่อง${'กขคงจฉชซฌญฎฏฐ'[i]}`)).error).toBeTruthy();
  });

  test('the template line lists the branch methods, also in a template written out by hand', () => {
    expect(fillPaymentMethods('ช่องทางการชำระ ({{payment_methods}}):', KBANK_SHOP)).toBe('ช่องทางการชำระ (กสิกร/เงินสด/บัตรเครดิต):');
    expect(fillPaymentMethods('ช่องทางการชำระ (ออมสิน/คลิก/JPM/เงินสด/บัตรเครดิต):', KBANK_SHOP))
      .toBe('ช่องทางการชำระ (กสิกร/เงินสด/บัตรเครดิต):');
    expect(fillPaymentMethods('ช่องทางการชำระ ({{payment_methods}}):', DEFAULT_PAYMENT_METHODS))
      .toBe('ช่องทางการชำระ (ออมสิน/คลิก/JPM/เงินสด/บัตรเครดิต):');
  });

  test('the parser reads the label with any branch list in brackets', () => {
    const parsed = parseLineQueueMessage([
      'คิว 3', 'ชื่อ:คุณเอ', 'รายการ:', 'ผ้าเบรก 1500', '<--สิ้นสุดรายการ-->',
      'ช่องทางการชำระ (กสิกร/เงินสด/บัตรเครดิต):กสิกร', 'ชำระเงินเรียบร้อย',
    ].join('\n'));
    expect(parsed.payment_method).toBe('กสิกร');
    expect(normalizePaymentMethod(parsed.payment_method, KBANK_SHOP)).toBe('กสิกร');
  });
});
