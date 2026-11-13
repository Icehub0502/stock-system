const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { authenticate, requireManager } = require("../middleware/auth");
const { emitProductCostEvent } = require("../realtime");

router.use(authenticate);
router.use(requireManager);

// ============================================================
// ฟังก์ชันแยกหมวดหมู่จาก description
// ============================================================
function detectCategory(description = "") {
  const desc = description.toLowerCase();

  if (desc.includes("แร็คมือสอง") || desc.includes("มือสอง")) return "แร็คมือสอง";
  if (desc.includes("แร็คบิวใหม่") || desc.includes("บิวใหม่")) return "แร็คบิวใหม่";
  if (desc.includes("แร็คใหม่") || desc.includes("แร็ค oem")) return "แร็คใหม่ OEM";
  if (desc.includes("ปีกนก")) return "ปีกนก";
  if (desc.includes("ยางกันฝุ่น") || desc.includes("ยางกันกระแทก")) return "ยางกันฝุ่น/กันกระแทก";
  if (desc.includes("ยางกันโคลง")) return "ยางกันโคลง";
  if (desc.includes("สกรูกันโคลง")) return "สกรูกันโคลง";
  if (desc.includes("ลูกหมากแร็ค")) return "ลูกหมากแร็ค";
  if (desc.includes("ลูกหมากคันชัก")) return "ลูกหมากคันชัก";
  if (desc.includes("ลูกหมากกันโคลง")) return "ลูกหมากกันโคลง";
  if (desc.includes("ลูกหมากบน")) return "ลูกหมากบน";
  if (desc.includes("ลูกหมากล่าง")) return "ลูกหมากล่าง";
  if (desc.includes("ลูกหมาก")) return "ลูกหมาก";
  if (desc.includes("บูช")) return "บูช";

  return "อื่นๆ";
}

// ============================================================
// ฟังก์ชันแยกยี่ห้อรถจาก description
// ============================================================
function detectBrand(description = "") {
  const desc = description.toUpperCase();

  const brands = [
    "TOYOTA",
    "HONDA",
    "NISSAN",
    "ISUZU",
    "MITSUBISHI",
    "MAZDA",
    "FORD",
    "CHEVROLET",
    "SUZUKI",
    "SUBARU",
    "BMW",
    "BENZ",
    "VOLKSWAGEN",
    "LEXUS",
    "HYUNDAI",
    "KIA",
    "VOLVO",
    "MG",
    "PROTON",
    "HAVAL",
    "RANGE ROVER"
  ];

  for (const b of brands) {
    if (desc.includes(b)) return b;
  }

  return "อื่นๆ";
}

// ============================================================
// GET /api/product-costs
// ============================================================
router.get("/", async (req, res) => {
  try {
    const { search = "", category = "", car_brand = "" } = req.query;

    let sql = `
      SELECT id, parts, description, brand, price
      FROM products
      WHERE shop_id = ?
    `;

    const params = [req.shopId];

    if (search) {
      sql += " AND (parts LIKE ? OR description LIKE ? OR brand LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    sql += " ORDER BY id ASC";
    // ProductCostPage ทำ pagination/นับจำนวนรวมฝั่ง client จากผลลัพธ์ชุดเต็ม (ดู
    // pagedProducts/fetchTotalCount) ตัด LIMIT ต่ำ ๆ ตรงนี้จะทำให้หน้าถัดไป/ยอดรวม
    // ผิดทันที — ใส่เพดานสูง (5000) กันดึงทั้งตารางไม่จำกัดแทน (แคตาล็อกสินค้าร้านนี้
    // ยังห่างไกลจากจำนวนนี้มาก) ถ้าโตเกินนี้จริงต้องทำ pagination จริงจังฝั่ง backend
    // (limit/offset) แทน ไม่ใช่ตัด LIMIT ต่ำ ๆ ที่นี่
    sql += " LIMIT 5000";

    const [rows] = await pool.query(sql, params);

    let result = rows.map((r) => ({
      ...r,
      category: detectCategory(r.description),
      car_brand: detectBrand(r.description)
    }));

    if (category) {
      result = result.filter((r) => r.category === category);
    }

    if (car_brand) {
      result = result.filter((r) => r.car_brand === car_brand);
    }

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "โหลดรายการต้นทุนสินค้าไม่สำเร็จ"
    });
  }
});

// ============================================================
// GET /api/product-costs/categories
// ============================================================
router.get("/categories", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT description, price FROM products WHERE shop_id = ?",
      [req.shopId]
    );

    const category_counts = {};
    let total_value = 0;
    for (const r of rows) {
      const cat = detectCategory(r.description);
      category_counts[cat] = (category_counts[cat] || 0) + 1;
      if (r.price != null) total_value += Number(r.price);
    }

    const categories = Object.keys(category_counts).sort();

    const car_brands = [
      ...new Set(rows.map((r) => detectBrand(r.description)))
    ].sort();

    res.json({
      success: true,
      categories,
      car_brands,
      category_counts,
      total_value,
      total_products: rows.length
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "โหลดข้อมูลหมวดหมู่ไม่สำเร็จ"
    });
  }
});

// ============================================================
// GET /api/product-costs/received
// What stock items cost according to the receive bills of this branch (read-only):
// the weighted average kept on the item, plus the latest bill line that had a cost.
// Lists active items that have a cost or were ever received.
// ============================================================
router.get("/received", async (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const params = [req.shopId, req.shopId];
    let searchSql = "";
    if (search) {
      const like = `%${search}%`;
      searchSql = " AND (i.oem_code LIKE ? OR i.description LIKE ? OR c.name LIKE ?)";
      params.push(like, like, like);
    }

    const [items] = await pool.query(
      `SELECT i.id, i.oem_code, i.description, i.stock_qty, i.avg_cost, i.manual_cost, c.name AS category_name,
              COALESCE(r.lines_total, 0) AS lines_total, COALESCE(r.lines_with_cost, 0) AS lines_with_cost,
              DATE_FORMAT(r.last_received, '%Y-%m-%d') AS last_received
       FROM stock_items i
       JOIN stock_categories c ON c.id = i.category_id
       LEFT JOIN (
         SELECT l.item_id, COUNT(*) AS lines_total, SUM(l.unit_cost IS NOT NULL) AS lines_with_cost,
                MAX(COALESCE(s.bill_date, DATE(s.created_at))) AS last_received
         FROM stock_receive_lines l JOIN receipt_sessions s ON s.id = l.receipt_session_id
         WHERE s.shop_id = ? AND l.applied_at IS NOT NULL AND l.voided_at IS NULL
         GROUP BY l.item_id
       ) r ON r.item_id = i.id
       WHERE i.shop_id = ? AND i.is_active = 1 AND (r.item_id IS NOT NULL OR i.avg_cost IS NOT NULL)${searchSql}
       ORDER BY c.name, i.description
       LIMIT 3000`,
      params
    );

    // latest line with a cost per item (highest line id = entered last)
    const [lastLines] = await pool.query(
      `SELECT l.item_id, l.unit_cost, s.supplier_name, DATE_FORMAT(COALESCE(s.bill_date, DATE(s.created_at)), '%Y-%m-%d') AS bill_date
       FROM stock_receive_lines l JOIN receipt_sessions s ON s.id = l.receipt_session_id
       WHERE l.id IN (
         SELECT MAX(l2.id) FROM stock_receive_lines l2 JOIN receipt_sessions s2 ON s2.id = l2.receipt_session_id
         WHERE s2.shop_id = ? AND l2.applied_at IS NOT NULL AND l2.voided_at IS NULL AND l2.unit_cost IS NOT NULL
         GROUP BY l2.item_id
       )`,
      [req.shopId]
    );
    const lastByItem = new Map(lastLines.map((l) => [l.item_id, l]));

    const data = items.map((i) => {
      const last = lastByItem.get(i.id);
      const withCost = Number(i.lines_with_cost) || 0;
      return {
        id: i.id,
        oem_code: i.oem_code,
        description: i.description,
        category_name: i.category_name,
        stock_qty: Number(i.stock_qty) || 0,
        avg_cost: i.avg_cost == null ? null : Number(i.avg_cost),
        // where avg_cost came from: receive bills, a cost typed by hand, or nothing yet
        cost_source: withCost > 0 ? "bill" : i.avg_cost != null ? "manual" : null,
        last_cost: last ? Number(last.unit_cost) : null,
        last_supplier: last ? last.supplier_name : null,
        last_cost_date: last ? last.bill_date : null,
        last_received: i.last_received,
        lines_total: Number(i.lines_total) || 0,
        lines_with_cost: withCost
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "โหลดต้นทุนจากบิลรับเข้าไม่สำเร็จ" });
  }
});

// ============================================================
// GET /api/product-costs/received/:itemId/lines
// Every receive bill line of one item in this branch, newest first (read-only)
// ============================================================
router.get("/received/:itemId/lines", async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ success: false, message: "รหัสสินค้าไม่ถูกต้อง" });
  }
  try {
    const [[item]] = await pool.query(
      "SELECT id FROM stock_items WHERE id = ? AND shop_id = ?",
      [itemId, req.shopId]
    );
    if (!item) return res.status(404).json({ success: false, message: "ไม่พบสินค้า" });

    const [lines] = await pool.query(
      `SELECT l.id, l.qty, l.position, l.unit_cost, s.id AS session_id, s.invoice_no, s.supplier_name,
              DATE_FORMAT(COALESCE(s.bill_date, DATE(s.created_at)), '%Y-%m-%d') AS bill_date
       FROM stock_receive_lines l JOIN receipt_sessions s ON s.id = l.receipt_session_id
       WHERE l.item_id = ? AND s.shop_id = ? AND l.applied_at IS NOT NULL AND l.voided_at IS NULL
       ORDER BY COALESCE(s.bill_date, DATE(s.created_at)) DESC, l.id DESC
       LIMIT 200`,
      [itemId, req.shopId]
    );
    res.json({
      success: true,
      data: lines.map((l) => ({ ...l, unit_cost: l.unit_cost == null ? null : Number(l.unit_cost) }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "โหลดประวัติราคาไม่สำเร็จ" });
  }
});

// ============================================================
// POST /api/product-costs
// ============================================================
router.post("/", async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: "ไม่มีข้อมูลที่จะเพิ่ม"
    });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const inserted = [];

    for (const item of items) {
      const { parts, description, brand, price } = item;

      if (!parts || !description) continue;

      const [result] = await conn.query(
        `INSERT INTO products
        (shop_id, parts, description, brand, price)
        VALUES (?, ?, ?, ?, ?)`,
        [
          req.shopId,
          parts.trim(),
          description.trim(),
          brand?.trim() || null,
          price || null
        ]
      );

      inserted.push(result.insertId);
    }

    await conn.commit();

    emitProductCostEvent('product-cost:created', { shopId: req.shopId, productId: inserted[0] ?? null, actorId: req.user.id });

    res.json({
      success: true,
      message: `เพิ่ม ${inserted.length} รายการสำเร็จ`,
      ids: inserted
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);

    res.status(500).json({
      success: false,
      message: "เพิ่มรายการต้นทุนสินค้าไม่สำเร็จ"
    });
  } finally {
    if (conn) conn.release();
  }
});

// ============================================================
// PUT /api/product-costs/:id
// ============================================================
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { parts, description, brand, price } = req.body;

    await pool.query(
      `UPDATE products
       SET parts=?, description=?, brand=?, price=?
       WHERE id=? AND shop_id=?`,
      [
        parts?.trim(),
        description?.trim(),
        brand?.trim() || null,
        price || null,
        id,
        req.shopId
      ]
    );

    emitProductCostEvent('product-cost:updated', { shopId: req.shopId, productId: Number(req.params.id), actorId: req.user.id });

    res.json({
      success: true,
      message: "แก้ไขสำเร็จ"
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "แก้ไขรายการต้นทุนสินค้าไม่สำเร็จ"
    });
  }
});

// ============================================================
// DELETE /api/product-costs/:id
// ============================================================
router.delete("/:id", async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM products WHERE id=? AND shop_id=?",
      [req.params.id, req.shopId]
    );

    emitProductCostEvent('product-cost:deleted', { shopId: req.shopId, productId: Number(req.params.id), actorId: req.user.id });

    res.json({
      success: true,
      message: "ลบสำเร็จ"
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "ลบรายการต้นทุนสินค้าไม่สำเร็จ"
    });
  }
});

// ============================================================
// DELETE หลายรายการ
// ============================================================
router.delete("/", async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ไม่มี id"
      });
    }

    await pool.query(
      "DELETE FROM products WHERE shop_id = ? AND id IN (?)",
      [req.shopId, ids]
    );

    emitProductCostEvent('product-cost:deleted', { shopId: req.shopId, productId: null, actorId: req.user.id });

    res.json({
      success: true,
      message: `ลบ ${ids.length} รายการสำเร็จ`
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "ลบรายการต้นทุนสินค้าไม่สำเร็จ"
    });
  }
});

module.exports = router;