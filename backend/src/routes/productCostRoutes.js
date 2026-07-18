const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { authenticate, requireRole } = require("../middleware/auth");

router.use(authenticate);
router.use(requireRole("office"));

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
      WHERE 1=1
    `;

    const params = [];

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
      "SELECT description, price FROM products"
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
        (parts, description, brand, price)
        VALUES (?, ?, ?, ?)`,
        [
          parts.trim(),
          description.trim(),
          brand?.trim() || null,
          price || null
        ]
      );

      inserted.push(result.insertId);
    }

    await conn.commit();

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
       WHERE id=?`,
      [
        parts?.trim(),
        description?.trim(),
        brand?.trim() || null,
        price || null,
        id
      ]
    );

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
      "DELETE FROM products WHERE id=?",
      [req.params.id]
    );

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
      "DELETE FROM products WHERE id IN (?)",
      [ids]
    );

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