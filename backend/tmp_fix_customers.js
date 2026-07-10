const mysql = require('mysql2/promise');
require('dotenv').config();
(async ()=>{
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'champpower-stock2'
  });
  const db = process.env.DB_NAME || 'champpower-stock2';
  const [cols] = await conn.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='customers'", [db]);
  console.log('Before columns:', cols.map(r=>r.COLUMN_NAME));
  if(!cols.some(r=>r.COLUMN_NAME==='line_id')){
    console.log('Adding line_id column...');
    await conn.query("ALTER TABLE customers ADD COLUMN line_id VARCHAR(100) DEFAULT NULL");
    console.log('Added');
  } else {
    console.log('line_id already exists');
  }
  const [cols2] = await conn.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='customers'", [db]);
  console.log('After columns:', cols2.map(r=>r.COLUMN_NAME));
  await conn.end();
  process.exit(0);
})().catch(err=>{ console.error(err); process.exit(1); });
