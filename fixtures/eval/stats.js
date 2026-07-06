// Score statistics for the eval fixture.
function sortScores(scores) {
  return [...scores].sort();
}

function median(sortedNumbers) {
  if (!sortedNumbers.length) return null;
  const mid = Math.floor(sortedNumbers.length / 2);
  return sortedNumbers.length % 2
    ? sortedNumbers[mid]
    : (sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2;
}

module.exports = { sortScores, median };
