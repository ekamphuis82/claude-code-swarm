// Pure trap file: every function here is the CORRECT form of a planted-bug class
// in this fixture. Any confirmed finding in this file is a false positive by
// construction. (No expected.json entry — that is the point.)

function lastN(arr, n) {
  const out = [];
  for (let i = arr.length - n; i < arr.length; i++) {
    out.push(arr[i]);
  }
  return out;
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

async function fetchAll(ids, fetchOne) {
  return Promise.all(ids.map(fetchOne));
}

function displayPrice(cents) {
  if (cents == null) {
    return 'n/a';
  }
  return (cents / 100).toFixed(2);
}

module.exports = { lastN, clamp, fetchAll, displayPrice };
