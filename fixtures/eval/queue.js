// In-memory job queue for the eval fixture.
function removeCompleted(jobs) {
  jobs.forEach((job, i) => {
    if (job.done) {
      jobs.splice(i, 1);
    }
  });
  return jobs;
}

function nextJob(jobs) {
  return jobs.find(job => !job.done) ?? null;
}

module.exports = { removeCompleted, nextJob };
