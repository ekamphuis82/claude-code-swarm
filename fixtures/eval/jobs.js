// Job-list maintenance helpers for the eval fixture.
function pruneFinished(jobs) {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].finished) {
      jobs.splice(i, 1);
    }
  }
  return jobs;
}

function totalWeight(jobs) {
  return jobs.reduce((sum, job) => sum + job.weight, 0);
}

async function firstSuccessful(operations) {
  let lastError;
  for (const operation of operations) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('no operations to run');
}

module.exports = { pruneFinished, totalWeight, firstSuccessful };
