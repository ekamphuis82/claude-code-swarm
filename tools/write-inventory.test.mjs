// Keeps docs/security.md "Where the plugin writes on disk" honest.
//
// WHY THIS SHAPE. Four writes once escaped that inventory and all four were
// PROSE-directed (skill markdown telling the model to write), not fs.* calls.
// A pattern scan for new prose writes was measured against this repo and is
// not viable: broad verb matching is ~74% noise, and a verb-near-path variant
// misses 3 of those 4 (verb and path sit on different wrapped lines; "append
// it there" names no path; "a private temp file" is not path-shaped). Open
// vocabulary defeats it — "jot the summary into notes.md" matches nothing.
//
// So this test does NOT try to discover new writes. A genuinely new write is
// caught by review (CONTRIBUTING carries the checklist line). What it does
// guarantee is that the DOCUMENTED set cannot silently drift: every known
// write must still exist at its source AND still be described in the
// inventory, and no new fs write call may appear unaccounted for.
//
// Accepted blind spots, all deliberate-evasion class rather than drift, and
// all delegated to review: a write shelled out through Bash; an aliased fs
// function (`const w = fs.writeFileSync; w(dest, …)`) — the alias definition
// has no call parens and the call site has no API name, so neither half
// matches; and subdirectories of the scanned dirs, which are not walked
// (none exist, and adding one changes the dev-gate glob anyway).
//
// Expected data is inline ON PURPOSE. A regenerable snapshot file is the
// rubber-stamp trap: someone regenerates it without reading. Changing these
// arrays means editing assertions next to the reason they exist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// --- A: no unaccounted fs write call in shipped code -------------------------

// Sync AND async/callback forms — a gate that only knows writeFileSync is
// bypassed by fs.promises.writeFile. Longest alternatives first so rmSync
// cannot be matched as bare rm.
const WRITE_API = /\b(writeFileSync|appendFileSync|copyFileSync|mkdirSync|renameSync|unlinkSync|rmSync|createWriteStream|writeFile|appendFile|copyFile|mkdir|rename|unlink|rm)\s*\(/g

// Reads the call's FIRST ARGUMENT as written — the destination. Keying on the
// API name alone was measurably too weak: retargeting a write to another file
// keeps the API multiset identical and slipped through silently, which is
// precisely the inventory-relevant edit. Stops at the first comma at argument
// depth, so path.join(runDir, 'x.json') survives intact.
//
// Text scan, not a parser: a comma INSIDE a string literal truncates the key
// (`writeFileSync("a,b.json"` keys as `writeFileSync("a`). Such a call fails
// the gate as an unknown key first, so it cannot slip past unnoticed — but if
// you ever whitelist a truncated key, know that two destinations sharing the
// prefix would then collide. No comma-bearing paths exist here today.
function firstArg (src, openParen) {
  let depth = 0
  for (let i = openParen; i < src.length; i++) {
    const c = src[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') { if (--depth === 0) return src.slice(openParen + 1, i).trim() }
    else if (c === ',' && depth === 1) return src.slice(openParen + 1, i).trim()
  }
  return src.slice(openParen + 1).trim()
}

// file -> every write it may perform, as `api(destination`. Not line numbers:
// a reflow or an unrelated edit above must not churn the gate. But adding,
// removing, switching or RETARGETING a write does fail it.
const ALLOWED_WRITES = {
  'tools/record-eval.js': [
    'appendFileSync(logPath',
    'mkdirSync(configDir',
    'writeFileSync(configPath',
  ],
  'runner/journal.js': ['appendFileSync(file'],
  'runner/run.js': [
    'copyFileSync(scriptPath',
    'mkdirSync(runDir',
    "writeFileSync(path.join(runDir, 'args.json')",
    "writeFileSync(path.join(runDir, 'result.json')",
  ],
}

const SCANNED_DIRS = ['hooks', 'workflows', 'tools', 'runner']

function scanWrites () {
  const found = {}
  for (const dir of SCANNED_DIRS) {
    // non-recursive: no shipped code sits in a subdirectory of these (a new
    // one would need a dev-gate glob change anyway, which is a review moment)
    for (const name of fs.readdirSync(path.join(ROOT, dir)).sort()) {
      // .mjs is shipped code too; only the test files themselves are exempt
      // (their writes go to mkdtemp sandboxes)
      if (!/\.m?js$/.test(name) || name.endsWith('.test.mjs')) continue
      const rel = `${dir}/${name}`
      const src = read(rel)
      const hits = []
      for (const m of src.matchAll(WRITE_API)) {
        hits.push(`${m[1]}(${firstArg(src, m.index + m[0].length - 1)}`)
      }
      if (hits.length) found[rel] = hits.sort()
    }
  }
  return found
}

test('A: shipped code writes exactly where the inventory says it does', () => {
  assert.deepEqual(scanWrites(), ALLOWED_WRITES,
    'a write call was added, removed or moved. Update docs/security.md ' +
    '"Where the plugin writes on disk" FIRST, then this list.')
})

test('A2: the hooks and the workflow scripts write nothing at all', () => {
  // security.md states this outright ("The hooks write nothing at all"), and
  // the workflow scripts run without filesystem access by design.
  const offenders = Object.keys(scanWrites()).filter(f => f.startsWith('hooks/') || f.startsWith('workflows/'))
  assert.deepEqual(offenders, [], 'security.md claims these never write')
})

// --- B: documented writes still exist, and are still documented --------------

const INVENTORY_HEADING = '## Where the plugin writes on disk'

function inventorySection () {
  const doc = read('docs/security.md')
  const start = doc.indexOf(INVENTORY_HEADING)
  assert.notEqual(start, -1, `docs/security.md lost its "${INVENTORY_HEADING}" section`)
  const rest = doc.slice(start + INVENTORY_HEADING.length)
  const end = rest.search(/\n## /) // subsections are ###, so this finds the next top-level heading
  return end === -1 ? rest : rest.slice(0, end)
}

// Each entry: a write that exists in the codebase, the exact token proving it
// is still there, and the substring the inventory must still carry for it.
// Both directions fail: delete the write and the source assert fires; delete
// the inventory entry and the doc assert fires.
const DOCUMENTED_WRITES = [
  {
    what: 'config file (setup writes it, record-eval updates one key)',
    token: 'codeswarm.json',
    sources: ['skills/swarm-setup/SKILL.md', 'tools/record-eval.js'],
    inventory: 'codeswarm.json',
  },
  {
    what: 'eval log',
    token: 'codeswarm-eval-log.jsonl',
    sources: ['tools/record-eval.js'],
    inventory: 'codeswarm-eval-log.jsonl',
  },
  {
    what: 'runner run-state dir, and the resume scratch copy pinned into it',
    token: 'codeswarm-runs',
    sources: ['runner/run.js', 'skills/swarm-resume/SKILL.md'],
    inventory: 'codeswarm-runs',
  },
  {
    what: 'onboard generates stack agents into the plugin clone',
    token: '${A.pluginDir}/agents/',
    sources: ['workflows/swarm-onboard.js'],
    inventory: 'agents/my-*.md',
  },
  {
    what: 'onboard generates convention skills into the plugin clone',
    token: '${A.pluginDir}/skills/',
    sources: ['workflows/swarm-onboard.js'],
    inventory: 'skills/my-*/',
  },
  {
    // no stable path token in the prose — anchor on the instruction itself
    what: 'issue-tracker auth header temp file (transient, secret-bearing)',
    token: 'write the header line to a private temp file',
    sources: ['skills/swarm-issues/SKILL.md'],
    inventory: 'auth header',
  },
  {
    what: 'build retrospect report, written into the TARGET repo',
    token: 'swarm-retrospect-',
    sources: ['skills/swarm-director/SKILL.md'],
    inventory: 'swarm-retrospect-',
  },
  {
    what: 'waiver append on user dismissal, in the TARGET repo',
    token: '.swarm-waivers.json',
    sources: ['skills/swarm-director/SKILL.md'],
    inventory: '.swarm-waivers.json',
  },
]

for (const w of DOCUMENTED_WRITES) {
  test(`B: ${w.what} — still written where the inventory says`, () => {
    for (const src of w.sources) {
      assert.ok(read(src).includes(w.token),
        `${src} no longer contains ${JSON.stringify(w.token)}. If the write is gone, ` +
        'remove its entry from docs/security.md and from this list too.')
    }
  })

  test(`B: ${w.what} — still described in the inventory`, () => {
    assert.ok(inventorySection().includes(w.inventory),
      `docs/security.md "Where the plugin writes on disk" no longer mentions ` +
      `${JSON.stringify(w.inventory)}, but the write still exists in ${w.sources.join(', ')}.`)
  })
}

// A write with no entry here is invisible to this gate — that is the known
// limit, and the reason CONTRIBUTING makes it a review item.
test('B: the inventory covers every documented write group', () => {
  assert.equal(DOCUMENTED_WRITES.length, 8,
    'adding a write means adding an entry here AND to docs/security.md; ' +
    'bump this count deliberately so the addition cannot be a silent one.')
})
