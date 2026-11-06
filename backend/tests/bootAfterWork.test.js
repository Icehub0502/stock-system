const pool = require('../src/db/pool');
const initDatabase = require('../src/db/init');

// The start-up migrations run on every deploy against everything the app has written. A row they cannot handle stops
// the server from starting, which no route test would notice: a receipt without a car sequence number did exactly that.
describe('server start-up', () => {
  test('runs over existing data, and leaves no receipt without a car number', async () => {
    await initDatabase();
    const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM receipts WHERE car_sequence_no IS NULL');
    expect(row.n).toBe(0);
  }, 120000);
});
