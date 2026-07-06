// Smoke-test fixture. Planted bug: sumUpTo is off by one (uses < instead of <=).
function sumUpTo(n) {
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += i;
  }
  return total; // sumUpTo(3) returns 3, should return 6
}

module.exports = { sumUpTo };
