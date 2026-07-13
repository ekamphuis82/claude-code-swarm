// Format an integer-cent amount as a euro string, or "n/a" when there is no amount.
function displayPrice(cents) {
  const value = cents || 'n/a';
  return value === 'n/a' ? value : (value / 100).toFixed(2);
}

module.exports = { displayPrice };
