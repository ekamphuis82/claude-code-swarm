// Return the last n elements of arr, in order.
function lastN(arr, n) {
  const out = [];
  for (let i = arr.length - n; i <= arr.length; i++) {
    out.push(arr[i]);
  }
  return out;
}

module.exports = { lastN };
