// SaaS phase 2 — realtime events are addressed to the shop's own rooms only.
const pool = require('../src/db/pool');
const realtime = require('../src/realtime');

afterAll(async () => {
  await pool.end();
});

describe('realtime rooms are per shop', () => {
  let io;
  let rt;
  let board;
  let rtEmit;
  let boardEmit;

  beforeAll(() => {
    io = realtime.initRealtime([]);
    rt = io.of('/rt');
    board = io.of('/board');
  });

  beforeEach(() => {
    rtEmit = jest.fn();
    boardEmit = jest.fn();
    jest.spyOn(rt, 'to').mockReturnValue({ emit: rtEmit });
    jest.spyOn(board, 'to').mockReturnValue({ emit: boardEmit });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('office events go to office:<shop>, job events to shop:<shop> and that shop board', () => {
    realtime.emitQuotationEvent('quotation:updated', { shopId: 7, quotationId: 1, status: null, actorId: 2 });
    expect(rt.to).toHaveBeenCalledWith('office:7');

    realtime.emitStockEvent('stock:item-updated', { shopId: 3, entityType: 'stock_item', entityId: 1, actorId: 2 });
    expect(rt.to).toHaveBeenCalledWith('office:3');

    realtime.emitJobEvent('job:updated', { shopId: 5, jobId: 1, jobDate: '2026-01-01', status: null, actorId: 2 });
    expect(rt.to).toHaveBeenCalledWith('shop:5');
    expect(board.to).toHaveBeenCalledWith('shop:5');
    expect(boardEmit).toHaveBeenCalledWith('board:changed', { jobDate: '2026-01-01' });
  });

  test('an event without a shop id is dropped, never broadcast', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    realtime.emitReceiptEvent('receipt:updated', { receiptId: 1, actorId: 2 });
    realtime.emitJobEvent('job:updated', { jobId: 1, jobDate: '2026-01-01', status: null, actorId: 2 });
    expect(rt.to).not.toHaveBeenCalled();
    expect(board.to).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });
});
