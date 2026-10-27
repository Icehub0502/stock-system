// SaaS phase 2: static check that every SQL statement touching a shop-owned table is filtered/stamped
// with shop_id. It is a safety net on top of the cross-shop tests in tests/tenantIsolation.test.js, not
// a SQL parser: it looks at every pool/conn .query/.execute call (and every other SQL-looking string)
// in src/routes and src/utils, and reports the ones that mention a shop-owned table but never mention
// shop_id.
//
//   node scripts/tenant-lint.js          → prints findings, exit code 1 when there are any
//
// Opt out for a statement that is safe for another reason (e.g. it only reaches rows through an id the
// code has just verified as belonging to the shop) by putting `tenant-ok: <reason>` in a comment on the
// line of the call or on the line above it.
const fs = require('fs');
const path = require('path');
const { SHOP_TABLES } = require('../src/db/tenantSchema');

const SRC = path.join(__dirname, '..', 'src');
const DIRS = ['routes', 'utils'];
const TABLE_RE = new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO)\\s+\`?(${SHOP_TABLES.join('|')})\`?(?=[\\s(,;)]|$)`, 'gi');
const CALL_RE = /\b(?:pool|conn|db)\s*\.\s*(?:query|execute)\s*\(/g;
const SQL_START_RE = /^\s*(?:\/\*.*?\*\/\s*)?(?:SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH)\b/i;

// index of the ")" matching the "(" at `open`, skipping strings, template literals and comments
function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'") {
      for (i += 1; i < src.length && src[i] !== c; i += 1) if (src[i] === '\\') i += 1;
    } else if (c === '`') {
      for (i += 1; i < src.length && src[i] !== '`'; i += 1) {
        if (src[i] === '\\') i += 1;
        else if (src[i] === '$' && src[i + 1] === '{') i = matchParen(src, i + 1);
      }
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2);
      if (i < 0) return src.length;
      i += 1;
    } else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return src.length;
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

function touchedTables(text) {
  const found = new Set();
  for (const m of text.matchAll(TABLE_RE)) found.add(m[1].toLowerCase());
  return [...found];
}

function lintFile(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const findings = [];
  const covered = []; // [start, end) ranges already checked as calls

  const optedOut = (line) => /tenant-ok/.test(lines[line - 1] || '') || /tenant-ok/.test(lines[line - 2] || '');

  for (const m of src.matchAll(CALL_RE)) {
    const open = m.index + m[0].length - 1;
    const end = matchParen(src, open);
    covered.push([m.index, end]);
    const text = src.slice(open, end + 1);
    const tables = touchedTables(text);
    const line = lineOf(src, m.index);
    if (tables.length > 0 && !/shop_id/.test(text) && !optedOut(line)) {
      findings.push({ file, line, tables });
    }
  }

  // SQL held in a variable first (let sql = `SELECT ...`; pool.query(sql, ...)): check the literal itself
  for (const m of src.matchAll(/(`(?:\\.|\$\{[^}]*\}|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")/g)) {
    if (covered.some(([a, b]) => m.index >= a && m.index <= b)) continue;
    const literal = m[0].slice(1, -1);
    if (!SQL_START_RE.test(literal)) continue;
    const tables = touchedTables(literal);
    const line = lineOf(src, m.index);
    if (tables.length > 0 && !/shop_id/.test(literal) && !optedOut(line)) {
      findings.push({ file, line, tables });
    }
  }
  return findings;
}

function lintAll() {
  const out = [];
  for (const dir of DIRS) {
    const full = path.join(SRC, dir);
    for (const f of fs.readdirSync(full).filter((x) => x.endsWith('.js')).sort()) {
      out.push(...lintFile(path.join(full, f)));
    }
  }
  return out;
}

if (require.main === module) {
  const findings = lintAll();
  for (const f of findings) {
    console.log(`${path.relative(path.join(__dirname, '..'), f.file)}:${f.line}  ${f.tables.join(', ')}`);
  }
  const byFile = {};
  for (const f of findings) byFile[path.basename(f.file)] = (byFile[path.basename(f.file)] || 0) + 1;
  console.log(`\n${findings.length} statement(s) without shop_id`, findings.length ? byFile : '');
  process.exit(findings.length ? 1 : 0);
}

module.exports = { lintAll };
