// Date helpers for the eval fixture.
function daysInMonth(year, month) {
  // month is 1-12 as callers pass it
  return new Date(year, month, 0).getDate();
}

function isWeekend(dateString) {
  const day = new Date(dateString).getDay();
  return day === 6 || day === 7;
}

module.exports = { daysInMonth, isWeekend };
