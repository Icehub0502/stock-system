// How long a car has been under repair, from its status history. A car can go back and forth, so every stretch at
// "กำลังซ่อม" counts and the time at other steps does not. Clock time: a car left repairing overnight keeps counting.

// the DB returns DATETIME as a string; both sides of a difference are read the same way
const toMs = (value) => Date.parse(`${String(value).replace(' ', 'T')}Z`);

// history: the job's rows in time order, { status, changed_at }. now: the DB's NOW().
// Returns { repair_seconds: null, repair_running: false } for a car that never reached repairing.
function repairTimeFrom(history, now) {
  let totalMs = 0;
  let openedAt = null;
  let started = false;
  for (const row of history) {
    const at = toMs(row.changed_at);
    if (row.status === 'repairing') {
      started = true;
      if (openedAt === null) openedAt = at;
    } else if (openedAt !== null) {
      totalMs += Math.max(0, at - openedAt);
      openedAt = null;
    }
  }
  if (!started) return { repair_seconds: null, repair_running: false };
  const running = openedAt !== null;
  if (running) totalMs += Math.max(0, toMs(now) - openedAt);
  return { repair_seconds: Math.floor(totalMs / 1000), repair_running: running };
}

module.exports = { repairTimeFrom };
