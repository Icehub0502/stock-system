require('dotenv').config();
const mysql = require('mysql2/promise');
(async ()=>{
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'champpower-stock2'
  });
  try{
    const [create] = await conn.query("SHOW CREATE TABLE receipt_items");
    console.log('Before:\n', create[0]['Create Table']);
    try{
      await conn.query("ALTER TABLE receipt_items MODIFY COLUMN service_item_id BIGINT UNSIGNED DEFAULT NULL");
      console.log('Modified column to allow NULL');
    }catch(e){ console.error('Modify column error', e.message); }
    try{
      await conn.query("ALTER TABLE receipt_items DROP FOREIGN KEY fk_receipt_item_service");
      console.log('Dropped FK fk_receipt_item_service');
    }catch(e){ console.log('Drop FK may not exist:', e.message); }
    try{
      await conn.query("ALTER TABLE receipt_items ADD CONSTRAINT fk_receipt_item_service FOREIGN KEY (service_item_id) REFERENCES service_items(id) ON DELETE SET NULL");
      console.log('Added FK fk_receipt_item_service ON DELETE SET NULL');
    }catch(e){ console.error('Add FK error', e.message); }
    const [after] = await conn.query("SHOW CREATE TABLE receipt_items");
    console.log('\nAfter:\n', after[0]['Create Table']);
  }finally{
    await conn.end();
  }
})();
