const path = require("path");
const {
  BACKEND_VERSION,
  MINIMUM_COMPATIBLE_SCRIPT_VERSION,
  MINIMUM_COMPATIBLE_BACKEND_VERSION
} = require("./version");

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createConfig() {
  const repoRoot = path.resolve(__dirname, "..", "..");

  return {
    repoRoot,
    host: process.env.BACKEND_HOST || "0.0.0.0",
    port: parseInteger(process.env.BACKEND_PORT, 3000),
    slotLimit: 6,
    pollIntervalMs: parseInteger(process.env.POLL_INTERVAL_MS, 10_000),
    requestTimeoutMs: parseInteger(process.env.REQUEST_TIMEOUT_MS, 8_000),
    alertCooldownMs: parseInteger(process.env.ALERT_COOLDOWN_MS, 120_000),
    snapshotGroupingWindowMs: parseInteger(
      process.env.SNAPSHOT_GROUPING_WINDOW_MS,
      30_000
    ),
    alertImprovementAmount: parseInteger(process.env.ALERT_IMPROVEMENT_AMOUNT, 100),
    staleAfterMs: parseInteger(process.env.STALE_AFTER_MS, 30_000),
    historyPointsLimit: parseInteger(process.env.HISTORY_POINTS_LIMIT, 8),
    eventLogLimit: parseInteger(process.env.EVENT_LOG_LIMIT, 25),
    activityLogLimit: parseInteger(process.env.ACTIVITY_LOG_LIMIT, 40),
    corsOrigin: process.env.CORS_ORIGIN || "*",
    weav3rBaseUrl: process.env.WEAV3R_BASE_URL || "https://weav3r.dev",
    backendVersion: BACKEND_VERSION,
    minimumCompatibleScriptVersion: MINIMUM_COMPATIBLE_SCRIPT_VERSION,
    minimumCompatibleBackendVersion: MINIMUM_COMPATIBLE_BACKEND_VERSION,
    storeFile: path.resolve(
      repoRoot,
      process.env.STORE_FILE || "backend/data/store.json"
    ),
    seedFile: path.resolve(repoRoot, "backend/data/store.sample.json"),
    itemCatalogFile: path.resolve(
      repoRoot,
      process.env.ITEM_CATALOG_FILE || "backend/data/item-catalog.json"
    ),
    tornMarketBaseUrl: "https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID="
  };
}

module.exports = {
  createConfig
};
