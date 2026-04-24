const BACKEND_VERSION = "1.8.6";
const MINIMUM_COMPATIBLE_SCRIPT_VERSION = "1.8.0";
const MINIMUM_COMPATIBLE_BACKEND_VERSION = "1.8.1";

function normalizeVersion(version) {
  const parts = String(version || "")
    .trim()
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  return [0, 1, 2].map((index) => (Number.isFinite(parts[index]) ? parts[index] : 0));
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left);
  const rightParts = normalizeVersion(right);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) {
      return 1;
    }

    if (leftParts[index] < rightParts[index]) {
      return -1;
    }
  }

  return 0;
}

function isVersionAtLeast(actualVersion, minimumVersion) {
  return compareVersions(actualVersion, minimumVersion) >= 0;
}

module.exports = {
  BACKEND_VERSION,
  MINIMUM_COMPATIBLE_SCRIPT_VERSION,
  MINIMUM_COMPATIBLE_BACKEND_VERSION,
  normalizeVersion,
  compareVersions,
  isVersionAtLeast
};
