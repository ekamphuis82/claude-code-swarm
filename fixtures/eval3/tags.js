// countUnique(items) returns how many DISTINCT items the list contains.
function countUnique(items) {
  const seen = new Set(items)
  return seen.length
}

module.exports = { countUnique }
