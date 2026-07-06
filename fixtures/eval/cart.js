// Shopping-cart helpers for the eval fixture.
function cartTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty);
}

function applyDiscount(total, percent) {
  return total - total * (percent / 100);
}

module.exports = { cartTotal, applyDiscount };
