// toSlugPart(title) lowercases a title and turns EVERY space into a dash,
// e.g. 'Release Notes For June' -> 'release-notes-for-june'.
function toSlugPart(title) {
  return title.toLowerCase().replace(' ', '-')
}

module.exports = { toSlugPart }
