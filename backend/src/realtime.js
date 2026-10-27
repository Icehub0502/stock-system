// Socket.io realtime layer for the vehicle check-in queue / job board.
// Kept as a thin, optional add-on: if initRealtime is never called (e.g. in
// tests via createApp() directly, or CLI scripts), emitJobEvent is a no-op —
// nothing here should ever be required for the HTTP API to function.
const { Server } = require('socket.io');
// ดึง isAllowedOrigin จาก corsOrigins.js โดยตรง (ไม่ใช่จาก app.js) เพราะ app.js ->
// jobs.routes.js -> realtime.js ถ้า realtime.js require('./app') กลับไปจะเกิด
// circular require และ app.js reassign module.exports ทั้งก้อนตอนท้ายไฟล์ ทำให้
// reference ที่ realtime.js ถืออยู่ไม่ใช่ตัวที่ export จริง (isAllowedOrigin เป็น
// undefined ตลอดแม้เรียกตอน runtime) corsOrigins.js ไม่พึ่ง app.js เลยจึงตัดวงจรนี้
const { isAllowedOrigin } = require('./corsOrigins');
const { verifyToken } = require('./middleware/auth');
const pool = require('./db/pool');

let io = null;

function initRealtime(httpServers) {
  io = new Server({
    cors: {
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
      credentials: true,
    },
  });

  httpServers.forEach((srv) => io.attach(srv));

  // /rt — authenticated namespace for staff (job board / queue UI). Requires
  // a valid JWT in the handshake, same token used for the REST API.
  io.of('/rt').use((socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyToken(token);
      socket.data.user = payload;
      next();
    } catch (err) {
      next(new Error('unauthorized'));
    }
  });

  // /board — สาธารณะ ไม่ต้องล็อกอิน (มิเรอร์ GET /api/board ที่เปิดสาธารณะสำหรับจอ
  // TV ห้องรับรอง) ‼️ ห้าม emit ฟิลด์งาน/ข้อมูลลูกค้าใด ๆ บน namespace นี้เด็ดขาด —
  // ส่งได้แค่สัญญาณ "มีการเปลี่ยนแปลง" (payload มีแค่ jobDate) ให้ฝั่งบอร์ดไปเรียก
  // GET /api/board เอง ซึ่งคัดกรองคอลัมน์ต้องห้ามที่ระดับ SQL อยู่แล้ว (ดู
  // board.routes.js) — ดู emitJobEvent ด้านล่างสำหรับ payload ที่อนุญาต
  io.of('/board');

  // Join office-role staff into a dedicated room so quotation/receipt events
  // (office-only) don't fan out to every /rt client (e.g. job-board kiosks).
  // Registered as its own connection listener (not inside the auth
  // middleware above) so it re-runs correctly on every reconnect.
  // ทุกห้องมีรหัสร้านต่อท้าย (shop:1, office:1 ...) เพื่อไม่ให้ event ของร้านหนึ่งไปถึงอีกร้าน
  io.of('/rt').on('connection', (socket) => {
    const shopId = Number(socket.data.user?.shop_id) || 1;
    socket.join(`shop:${shopId}`);
    if (socket.data.user?.role === 'office') socket.join(`office:${shopId}`);
  });

  // จอบอร์ดสาธารณะ: เลือกร้านด้วย ?shop=<รหัสร้าน> ตอนเชื่อมต่อ (ไม่ใส่ = ร้านที่ 1)
  io.of('/board').on('connection', async (socket) => {
    try {
      const code = String(socket.handshake.query?.shop ?? '').trim().toLowerCase();
      let shopId = 1;
      if (code) {
        const [rows] = await pool.query("SELECT id FROM shops WHERE code = ? AND status = 'active'", [code]);
        shopId = rows[0]?.id;
      }
      if (shopId) socket.join(`shop:${shopId}`);
    } catch (err) {
      console.error(err);
    }
  });

  return io;
}

// shopId บังคับ: ไม่มีรหัสร้านจะไม่ส่งให้ใครเลย (ดีกว่าปล่อยให้หลุดไปทุกร้าน)
function emitStaffEvent(event, payload, { room, shopId } = {}) {
  if (!io) return;
  if (!shopId) {
    console.error(`realtime: event ${event} dropped — no shopId`);
    return;
  }
  try {
    io.of('/rt').to(room ? `${room}:${shopId}` : `shop:${shopId}`).emit(event, payload);
  } catch (err) {
    console.error(err);
  }
}

function emitJobEvent(event, { shopId, jobId, jobDate, status, actorId }) {
  if (!io) return;
  emitStaffEvent(event, { jobId, jobDate, status, actorId }, { shopId });
  if (!shopId) return;
  try {
    io.of('/board').to(`shop:${shopId}`).emit('board:changed', { jobDate });
  } catch (err) {
    console.error(err);
  }
}

function emitQuotationEvent(event, { shopId, quotationId, status, actorId }) {
  emitStaffEvent(event, { quotationId, status, actorId }, { room: 'office', shopId });
}

function emitReceiptEvent(event, { shopId, receiptId, actorId }) {
  emitStaffEvent(event, { receiptId, actorId }, { room: 'office', shopId });
}

function emitStockEvent(event, { shopId, entityType, entityId, actorId }) {
  emitStaffEvent(event, { entityType, entityId, actorId }, { room: 'office', shopId });
}

function emitStockTxEvent(event, { shopId, txType, entityType, entityId, actorId }) {
  emitStaffEvent(event, { txType, entityType, entityId, actorId }, { room: 'office', shopId });
}

function emitProductCostEvent(event, { shopId, productId, actorId }) {
  emitStaffEvent(event, { productId, actorId }, { room: 'office', shopId });
}

function emitReceiptSessionEvent(event, { shopId, sessionId, actorId }) {
  emitStaffEvent(event, { sessionId, actorId }, { room: 'office', shopId });
}

module.exports = {
  initRealtime,
  emitJobEvent,
  emitQuotationEvent,
  emitReceiptEvent,
  emitStockEvent,
  emitStockTxEvent,
  emitProductCostEvent,
  emitReceiptSessionEvent,
};
