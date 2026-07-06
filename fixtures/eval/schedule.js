// Scheduling helpers for the eval fixture.
function isSunday(date) {
  return date.getDay() === 0;
}

function daysUntilFriday(date) {
  return (5 - date.getDay() + 7) % 7;
}

function sortByPriorityDesc(tasks) {
  return [...tasks].sort((a, b) => b.priority - a.priority);
}

function firstOfMonth(year, monthFrom1) {
  return new Date(year, monthFrom1 - 1, 1);
}

module.exports = { isSunday, daysUntilFriday, sortByPriorityDesc, firstOfMonth };
