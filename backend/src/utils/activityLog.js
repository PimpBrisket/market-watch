function appendActivityEntry(existingEntries, entry, limit) {
  const next = [entry, ...(existingEntries || [])];
  return next.slice(0, Math.max(1, limit || 40));
}

module.exports = {
  appendActivityEntry
};
