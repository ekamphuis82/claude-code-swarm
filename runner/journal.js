'use strict'
// JSONL journal for standalone-runner resume. One line per completed agent()
// call, keyed by (prompt+opts hash, occurrence) — completion order under
// concurrency does not matter, so replay is deterministic for an unchanged
// script+args. Null results are journaled for diagnostics but NEVER replayed:
// a failed agent gets a live second chance on resume.
const fs = require('fs')

function loadEntries (file) {
  let raw
  try { raw = fs.readFileSync(file, 'utf8') } catch { return [] }
  const entries = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { entries.push(JSON.parse(line)) } catch { /* torn tail line from a crash — ignore */ }
  }
  return entries
}

// file: append target; priorEntries: entries from the run being resumed
function createJournal (file, priorEntries = []) {
  const cache = new Map() // `${key}#${occ}` -> entry
  for (const e of priorEntries) {
    if (e && e.key != null && e.result !== null && e.result !== undefined) cache.set(`${e.key}#${e.occ}`, e)
  }
  return {
    lookup: (key, occ) => cache.get(`${key}#${occ}`) ?? null,
    append: entry => { fs.appendFileSync(file, JSON.stringify(entry) + '\n') },
    cachedCount: () => cache.size,
  }
}

module.exports = { createJournal, loadEntries }
