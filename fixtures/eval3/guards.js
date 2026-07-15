// tail(arr, count) returns the last `count` elements, in original order.
// count is a non-negative integer; a count larger than the array returns all of it.
function tail(arr, count) {
  const start = Math.max(0, arr.length - count)
  const out = []
  for (let i = start; i <= arr.length - 1; i++) out.push(arr[i])
  return out
}

// coalesce(value, fallback) returns fallback ONLY when value is null or
// undefined; 0, '' and false are valid values and pass through unchanged.
function coalesce(value, fallback) {
  return value == null ? fallback : value
}

// pageOf(index, size) returns the zero-based page number that holds `index`.
function pageOf(index, size) {
  return Math.floor(index / size)
}

module.exports = { tail, coalesce, pageOf }
