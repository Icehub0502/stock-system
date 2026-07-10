// Runs before the test framework is set up and before any test file (or
// anything it requires, like src/db/pool.js) touches process.env — this is
// what makes tests hit champpower-stock2-test instead of the real database.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.test') });
