// Standard prices per vehicle generation: helpers shared by routes/modelPrices.routes.js and the quotation routes.
// See db/priceSchema.js for what the tables hold.
const pool = require('../db/pool');
const { normalizeName } = require('./normalizeName');
const { displayModelName } = require('./modelDisplay');

const MAX_PRICE = 99999999;

// The branch group (owner) a shop belongs to; prices are shared inside it. null when the shop has no group.
async function groupIdOf(shopId) {
  const [[row]] = await pool.query('SELECT group_id FROM shops WHERE id = ?', [shopId]);
  return row && row.group_id ? Number(row.group_id) : null;
}

// Items are matched by name, ignoring case, spaces and punctuation
function itemKey(name) {
  return normalizeName(name).slice(0, 255);
}

// a price as a number within range, or null when it is not one
function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 && price <= MAX_PRICE ? price : null;
}

function withDisplay(row) {
  return { ...row, display_name: displayModelName(row.model, row.year_range) };
}

// An approved vehicle generation by id, or null. Prices are only kept for approved ones.
async function approvedModel(id) {
  if (!id) return null;
  const [[row]] = await pool.query(
    "SELECT id, brand, model, year_range FROM vehicle_models WHERE id = ? AND status = 'approved'",
    [id]
  );
  return row ? withDisplay(row) : null;
}

// Remember the prices staff typed on a quotation, and link the customer's car to the chosen generation.
// Advisory data: it never throws and never blocks saving the quotation.
//   items: the quotation lines as sent by the form; a line may carry price_key_name (the name to remember the
//   price under, e.g. the set name on the first row of an expanded promo set) or skip_price_memory (a labour line
//   that was added from a standard price).
async function recordQuotationPrices({ shopId, quotationId, vehicleId, vehicleModelId, items }) {
  try {
    let model = await approvedModel(Number(vehicleModelId) || null);
    if (vehicleId) {
      if (model) {
        await pool.query('UPDATE vehicles SET vehicle_model_id = ? WHERE id = ? AND shop_id = ?', [model.id, vehicleId, shopId]);
      } else {
        const [[car]] = await pool.query('SELECT vehicle_model_id FROM vehicles WHERE id = ? AND shop_id = ?', [vehicleId, shopId]);
        model = await approvedModel(car ? car.vehicle_model_id : null);
      }
    }
    // an edited quotation replaces what it recorded before
    await pool.query("DELETE FROM price_observations WHERE source = 'quotation' AND source_id = ? AND shop_id = ?", [quotationId, shopId]);
    if (!model) return;
    const groupId = await groupIdOf(shopId);
    if (!groupId) return;

    const byKey = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      if (item.skip_price_memory) continue;
      const name = String(item.price_key_name || item.product_name || '').trim().slice(0, 255);
      const price = Number(item.unit_price);
      const qty = Number(item.quantity);
      const key = itemKey(name);
      if (!key || !(price > 0) || !(price <= MAX_PRICE) || !(qty > 0)) continue;
      byKey.set(key, [groupId, shopId, model.id, key, name, price, 'quotation', quotationId]);
    }
    if (byKey.size > 0) {
      await pool.query(
        'INSERT INTO price_observations (group_id, shop_id, vehicle_model_id, item_key, item_name, unit_price, source, source_id) VALUES ?',
        [[...byKey.values()]]
      );
    }
  } catch (err) {
    console.error('recording quotation prices failed:', err);
  }
}

module.exports = { MAX_PRICE, groupIdOf, itemKey, parsePrice, withDisplay, approvedModel, recordQuotationPrices };
