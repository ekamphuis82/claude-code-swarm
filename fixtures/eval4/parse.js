// parseAll(values) turns a list of decimal digit strings into integers,
// e.g. ['7', '12', '3'] -> [7, 12, 3].
function parseAll(values) {
  return values.map(parseInt)
}

module.exports = { parseAll }
