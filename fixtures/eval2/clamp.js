// Constrain x to the inclusive range [min, max].
function clamp(x, min, max) {
  return Math.max(max, Math.min(min, x));
}

module.exports = { clamp };
