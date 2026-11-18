// Serializes document-number generation per shop and document type.
//
// The generators read "SELECT MAX(...) ... WHERE no LIKE 'IV<today>%' FOR UPDATE" and then INSERT the next
// number. When no document exists yet for that day, the range is empty, so FOR UPDATE can only lock the next
// index record after it. Two concurrent transactions then deadlock: A holds that next-key lock, B queues for it,
// and A's INSERT into the gap in front of that record has to wait behind B's queued lock (ER_LOCK_DEADLOCK on
// the first document of every day). Taking an exclusive lock on one fixed row first makes those transactions
// run one after another, so the MAX read and the INSERT never overlap.
//
// INSERT ... ON DUPLICATE KEY UPDATE takes the exclusive record lock directly (no shared lock to upgrade, which
// would deadlock again) and creates the row the first time a shop numbers this document type. The lock is held
// until the caller's transaction commits or rolls back, so call it on the transaction's connection, right
// before reading the MAX. doc_number_locks has no foreign key to shops on purpose: the FK check would also lock
// the shop row, which warrantyRegister.routes.js locks FOR UPDATE.
//
// Lock order: a transaction that numbers several documents takes them as quotation → job → receipt (LINE bot,
// promoting a job's draft and billing it). Keep that order in new code, or two transactions can deadlock on
// these rows instead. Claim numbers are never taken together with another type.
async function lockDocNumbers(conn, shopId, docType) {
  await conn.execute(
    'INSERT INTO doc_number_locks (shop_id, doc_type) VALUES (?, ?) ON DUPLICATE KEY UPDATE doc_type = doc_type',
    [shopId, docType]
  );
}

module.exports = { lockDocNumbers };
