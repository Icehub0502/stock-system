// Role levels: technician < office < manager < owner < dev  (see middleware/auth.js)
//
// users.role used to be ENUM('office','technician'). The first time the new ENUM is applied:
//   - 'ice' (shop 1) becomes 'dev' — the platform administrator, who can act inside any shop
//   - every other existing 'office' user of shop 1 becomes 'manager', so nobody loses a page or
//     a button on the day of the change; the owner lowers people to 'office' afterwards from the
//     users page when they want the stricter rules
// Idempotent: the data moves only happen when the ENUM did not yet contain 'manager'.

const ROLES = ['technician', 'office', 'manager', 'owner', 'dev'];

async function migrateRoles(conn) {
  const [cols] = await conn.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
  );
  if (!cols[0]) return;
  if (cols[0].t.includes("'manager'")) return;

  const enumList = ROLES.map((r) => `'${r}'`).join(',');
  await conn.query(`ALTER TABLE users MODIFY role ENUM(${enumList}) NOT NULL`);
  const [dev] = await conn.query("UPDATE users SET role = 'dev' WHERE shop_id = 1 AND username = 'ice'");
  const [mgr] = await conn.query("UPDATE users SET role = 'manager' WHERE shop_id = 1 AND role = 'office'");
  console.log(`[roles] users.role extended; ${dev.affectedRows} dev, ${mgr.affectedRows} office → manager`);
}

module.exports = { migrateRoles, ROLES };
