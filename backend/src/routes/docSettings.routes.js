// Print header of quotations, receipts and claim documents, and the branch code on the repair notice, set per branch
// (shop_doc_settings, see db/docSettingsSchema.js).
//   any signed-in user : read the header of their shop (the print templates need it)
//   manager+           : change it, upload / remove the logo
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pool = require('../db/pool');
const { authenticate, requireManager } = require('../middleware/auth');
const { UPLOADS_DIR, deleteUploadedFile } = require('../utils/photoStorage');
const { branchCodeFromName } = require('../utils/branchCode');

const router = express.Router();
router.use(authenticate);

const DOC_TYPES = ['quotation', 'receipt', 'claim', 'repair_notice'];
// the repair notice has its own fixed layout: only the branch code on it can be set, no company header or logo
const HEADER_DOC_TYPES = ['quotation', 'receipt', 'claim'];
const TEXT_LIMITS = {
  company_name: 120, address: 300, phone: 50, line_id: 50, tax_id: 60, branch_text: 60, title: 60,
};
const REPAIR_NOTICE_LIMITS = { branch_text: 8 };
const CLAIM_FIRST_SAVE_FIELDS = ['company_name', 'address', 'phone', 'line_id', 'tax_id', 'accent_color', 'logo_width'];
const LOGO_MIN_WIDTH = 60;
const LOGO_MAX_WIDTH = 200;
const LOGO_DEFAULT_WIDTH = 130;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_PIXELS = { width: 800, height: 400 };
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function serverError(res, err, message) {
  console.error(err);
  return res.status(500).json({ error: message });
}

function cleanText(value, keepLines = false) {
  // strip control characters; the column limits are applied by the caller
  const text = String(value ?? '');
  if (!keepLines) return text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  // multi-line field (the address): line breaks typed by the manager are kept, each line trimmed, empty lines dropped
  return text.replace(/\r\n?/g, '\n').split('\n')
    .map((line) => line.replace(/[\u0000-\u001f\u007f]/g, ' ').trim())
    .filter(Boolean).join('\n');
}

// What a shop without a saved row prints: its own name only, no address / logo of another shop
function defaultsFor(shopName) {
  return {
    company_name: shopName || '', address: '', phone: '', line_id: '', tax_id: '', branch_text: '',
    title: '', accent_color: '', logo_path: '', logo_width: LOGO_DEFAULT_WIDTH,
  };
}

function toPublic(row, shopName) {
  const base = defaultsFor(shopName);
  if (!row) return { ...base, saved: false };
  return {
    company_name: row.company_name ?? base.company_name,
    address: row.address ?? '',
    phone: row.phone ?? '',
    line_id: row.line_id ?? '',
    tax_id: row.tax_id ?? '',
    branch_text: row.branch_text ?? '',
    title: row.title ?? '',
    accent_color: row.accent_color ?? '',
    logo_path: row.logo_path ?? '',
    logo_width: row.logo_width || LOGO_DEFAULT_WIDTH,
    saved: true,
  };
}

// GET /doc-settings → { quotation: {...}, receipt: {...}, claim: {...}, repair_notice: {...}, shop: { code } }
router.get('/', async (req, res) => {
  try {
    const [[shop]] = await pool.query('SELECT name, code FROM shops WHERE id = ?', [req.shopId]);
    const [rows] = await pool.query(
      `SELECT doc_type, company_name, address, phone, line_id, tax_id, branch_text, title, accent_color, logo_path, logo_width
       FROM shop_doc_settings WHERE shop_id = ?`,
      [req.shopId]
    );
    const byType = new Map(rows.map((r) => [r.doc_type, r]));
    const shopName = shop ? shop.name : '';
    const data = {};
    for (const type of DOC_TYPES) data[type] = toPublic(byType.get(type), shopName);
    // until the branch saves a claim header of its own, the claim document prints the quotation's (not its title)
    if (!byType.has('claim')) data.claim = { ...data.quotation, title: '', saved: false };
    data.repair_notice.default_branch_text = branchCodeFromName(shopName);
    data.repair_notice.branch_text = data.repair_notice.branch_text || data.repair_notice.default_branch_text;
    // public pages (queue screen, tracking) are told the branch by this code in their link
    data.shop = { code: shop ? shop.code : '' };
    res.json({ success: true, data });
  } catch (err) {
    serverError(res, err, 'โหลดหัวกระดาษไม่สำเร็จ');
  }
});

// Validate an uploaded logo (data URI) and store a normalised PNG; returns the /uploads path
async function storeLogo(shopId, docType, dataUrl) {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw Object.assign(new Error('bad-type'), { userMessage: 'โลโก้ต้องเป็นไฟล์ PNG, JPG หรือ WEBP' });
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > LOGO_MAX_BYTES) {
    throw Object.assign(new Error('too-big'), { userMessage: 'ไฟล์โลโก้ใหญ่เกิน 2 MB' });
  }
  let png;
  try {
    // re-encoding also proves the bytes are a real image and drops any metadata
    png = await sharp(buffer).rotate()
      .resize({ ...LOGO_MAX_PIXELS, fit: 'inside', withoutEnlargement: true })
      .png().toBuffer();
  } catch (err) {
    throw Object.assign(err, { userMessage: 'อ่านไฟล์โลโก้ไม่ได้ ลองใช้ไฟล์รูปอื่น' });
  }
  const dir = path.join(UPLOADS_DIR, 'shops', String(shopId));
  await fs.promises.mkdir(dir, { recursive: true });
  const filename = `logo-${docType}-${crypto.randomUUID()}.png`;
  await fs.promises.writeFile(path.join(dir, filename), png);
  return `/uploads/shops/${shopId}/${filename}`;
}

// Duplicate an uploaded logo of this shop under a new name; returns the new /uploads path
async function copyLogoFile(shopId, docType, sourcePath) {
  const prefix = `/uploads/shops/${shopId}/`;
  if (!sourcePath.startsWith(prefix) || sourcePath.includes('..')) {
    throw new Error('logo path outside the shop folder');
  }
  const dir = path.join(UPLOADS_DIR, 'shops', String(shopId));
  const filename = `logo-${docType}-${crypto.randomUUID()}.png`;
  await fs.promises.copyFile(path.join(dir, path.basename(sourcePath)), path.join(dir, filename));
  return `${prefix}${filename}`;
}

// A copy of a logo for another document: the bundled logo is not a file, an uploaded one gets its own file
async function duplicateLogo(shopId, docType, sourceLogo) {
  if (!sourceLogo || sourceLogo.startsWith('builtin:')) return sourceLogo || null;
  return copyLogoFile(shopId, docType, sourceLogo);
}

// PUT /doc-settings/:docType { company_name, address, phone, line_id, tax_id, branch_text, title, accent_color,
//   logo_width, logo_data_url?, remove_logo?, copy_logo_from? }
// Fields left out keep their stored value. A logo_data_url replaces the logo; remove_logo clears it;
// copy_logo_from (another document type) duplicates that document's logo. repair_notice only takes branch_text.
router.put('/:docType', requireManager, async (req, res) => {
  const docType = req.params.docType;
  if (!DOC_TYPES.includes(docType)) return res.status(404).json({ error: 'ไม่พบประเภทเอกสาร' });
  const body = req.body || {};
  const isHeaderDoc = HEADER_DOC_TYPES.includes(docType);

  const values = {};
  for (const [field, limit] of Object.entries(isHeaderDoc ? TEXT_LIMITS : REPAIR_NOTICE_LIMITS)) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const text = cleanText(body[field], field === 'address');
    if (text.length > limit) return res.status(400).json({ error: `ข้อความยาวเกินไป (ไม่เกิน ${limit} ตัวอักษร)` });
    values[field] = (isHeaderDoc ? text : text.toUpperCase()) || null;
  }
  if (isHeaderDoc && Object.prototype.hasOwnProperty.call(body, 'accent_color')) {
    const color = String(body.accent_color || '').trim();
    if (color && !COLOR_RE.test(color)) return res.status(400).json({ error: 'สีต้องอยู่ในรูปแบบ #rrggbb' });
    values.accent_color = color ? color.toLowerCase() : null;
  }
  if (isHeaderDoc && Object.prototype.hasOwnProperty.call(body, 'logo_width')) {
    const width = Math.round(Number(body.logo_width));
    if (!Number.isFinite(width) || width < LOGO_MIN_WIDTH || width > LOGO_MAX_WIDTH) {
      return res.status(400).json({ error: `ขนาดโลโก้ต้องอยู่ระหว่าง ${LOGO_MIN_WIDTH}-${LOGO_MAX_WIDTH}` });
    }
    values.logo_width = width;
  }

  let newLogo = null;
  try {
    const [[existing]] = await pool.query(
      'SELECT logo_path FROM shop_doc_settings WHERE shop_id = ? AND doc_type = ?',
      [req.shopId, docType]
    );
    const oldLogo = existing ? existing.logo_path : null;

    // the quotation's header, which a claim document prints until its first save
    let quotationHeader = null;
    if (docType === 'claim') {
      [[quotationHeader]] = await pool.query(
        `SELECT ${CLAIM_FIRST_SAVE_FIELDS.join(', ')}, logo_path FROM shop_doc_settings WHERE shop_id = ? AND doc_type = 'quotation'`,
        [req.shopId]
      );
    }

    // each document owns its own file, so removing one logo never breaks the other
    const copyLogo = async (sourceLogo) => {
      values.logo_path = await duplicateLogo(req.shopId, docType, sourceLogo);
      if (values.logo_path && !values.logo_path.startsWith('builtin:')) newLogo = values.logo_path;
    };

    if (isHeaderDoc && body.logo_data_url) {
      try {
        newLogo = await storeLogo(req.shopId, docType, body.logo_data_url);
      } catch (err) {
        if (err.userMessage) return res.status(400).json({ error: err.userMessage });
        throw err;
      }
      values.logo_path = newLogo;
    } else if (isHeaderDoc && body.remove_logo) {
      values.logo_path = null;
    } else if (isHeaderDoc && body.copy_logo_from) {
      const from = String(body.copy_logo_from);
      if (!HEADER_DOC_TYPES.includes(from) || from === docType) return res.status(400).json({ error: 'ประเภทเอกสารต้นทางไม่ถูกต้อง' });
      const [[source]] = await pool.query(
        'SELECT logo_path FROM shop_doc_settings WHERE shop_id = ? AND doc_type = ?',
        [req.shopId, from]
      );
      // a claim header that was never saved is showing the quotation's logo
      const [[fallback]] = !source && from === 'claim'
        ? await pool.query("SELECT logo_path FROM shop_doc_settings WHERE shop_id = ? AND doc_type = 'quotation'", [req.shopId])
        : [[null]];
      await copyLogo((source || fallback || {}).logo_path);
    } else if (docType === 'claim' && !existing && quotationHeader) {
      await copyLogo(quotationHeader.logo_path);
    }

    // first save of a claim header: what the request leaves out stays as it has been printing
    if (docType === 'claim' && !existing && quotationHeader) {
      for (const field of CLAIM_FIRST_SAVE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(values, field)) values[field] = quotationHeader[field];
      }
    }

    const updatedBy = String(req.user.full_name || req.user.username || '').slice(0, 100) || null;
    const columns = Object.keys(values);
    const insertCols = ['shop_id', 'doc_type', ...columns, 'updated_by'];
    const placeholders = insertCols.map(() => '?').join(', ');
    const updates = [...columns, 'updated_by'].map((c) => `${c} = VALUES(${c})`).join(', ');
    await pool.query(
      `INSERT INTO shop_doc_settings (${insertCols.join(', ')}) VALUES (${placeholders})
       ON DUPLICATE KEY UPDATE ${updates}`,
      [req.shopId, docType, ...columns.map((c) => values[c]), updatedBy]
    );

    // the replaced logo file is no longer referenced (the bundled 'builtin:' logo is not a file)
    if ((newLogo || body.remove_logo) && oldLogo && oldLogo !== newLogo) deleteUploadedFile(oldLogo);
    res.json({ success: true });
  } catch (err) {
    if (newLogo) deleteUploadedFile(newLogo);
    serverError(res, err, 'บันทึกหัวกระดาษไม่สำเร็จ');
  }
});

module.exports = router;
