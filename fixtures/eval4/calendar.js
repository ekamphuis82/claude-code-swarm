// sortDates(isoDates) returns a new array of 'YYYY-MM-DD' date strings in
// chronological order. Every entry is a zero-padded ISO-8601 calendar date.
function sortDates(isoDates) {
  return [...isoDates].sort()
}

// toInt(digits) parses a string of ASCII decimal digits, leading zeros allowed
// ('08' -> 8, '0042' -> 42).
function toInt(digits) {
  return parseInt(digits)
}

// daysInMonth(year, month) returns the number of days in a month.
// year is a four-digit year; month is 1-12 (1 = January).
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// hasName(names, name) reports whether the list contains the given string.
function hasName(names, name) {
  return !!~names.indexOf(name)
}

// range(n) returns [0, 1, ..., n - 1] for a non-negative integer n.
function range(n) {
  return Array(n).fill().map((_, i) => i)
}

module.exports = { sortDates, toInt, daysInMonth, hasName, range }
