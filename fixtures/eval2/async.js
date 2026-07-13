// Resolve fetchOne(id) for every id and return the collected results.
async function fetchAll(ids, fetchOne) {
  const results = [];
  ids.forEach(async (id) => {
    results.push(await fetchOne(id));
  });
  return results;
}

module.exports = { fetchAll };
