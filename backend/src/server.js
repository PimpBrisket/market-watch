const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });
require("dotenv").config();

const { createConfig } = require("./config");
const logger = require("./utils/logger");
const { JsonStore } = require("./storage/jsonStore");
const { WatchRepository } = require("./repositories/watchRepository");
const { Weav3rClient } = require("./clients/weav3rClient");
const { WatchRunner } = require("./services/watchRunner");
const { ItemCatalog } = require("./services/itemCatalog");
const { createApp } = require("./app");
const { getNetworkDiagnostics } = require("./utils/networkDiagnostics");

async function main() {
  const config = createConfig();
  const store = new JsonStore(config.storeFile);
  const itemCatalog = new ItemCatalog({
    catalogFile: config.itemCatalogFile
  });
  const repository = new WatchRepository({
    store,
    seedFile: config.seedFile,
    slotLimit: config.slotLimit,
    itemCatalog,
    defaultSettings: {
      alertCooldownMs: config.alertCooldownMs,
      snapshotGroupingWindowMs: config.snapshotGroupingWindowMs,
      activityLogLimit: config.activityLogLimit
    }
  });

  await repository.init();

  const weav3rClient = new Weav3rClient({
    baseUrl: config.weav3rBaseUrl,
    requestTimeoutMs: config.requestTimeoutMs
  });

  const runner = new WatchRunner({
    repository,
    weav3rClient,
    config,
    logger
  });

  const app = createApp({
    repository,
    runner,
    config
  });

  await runner.start();

  const server = app.listen(config.port, config.host, () => {
    const diagnostics = getNetworkDiagnostics(config);

    logger.info(`Backend listening on ${diagnostics.localhostBaseUrl}`, {
      host: config.host,
      port: config.port,
      storeFile: config.storeFile,
      itemCatalogFile: config.itemCatalogFile,
      itemCatalogCount: itemCatalog.getSummary().itemCount
    });
    logger.info(`Backend local status URL: ${diagnostics.localhostStatusUrl}`);
    logger.info(`Backend local health URL: ${diagnostics.localhostHealthUrl}`);

    if (config.host === "0.0.0.0") {
      if (diagnostics.lanBaseUrls.length) {
        diagnostics.lanBaseUrls.forEach((candidate) => {
          logger.info(`LAN access may be available at ${candidate.baseUrl}`, {
            interfaceName: candidate.interfaceName,
            statusUrl: candidate.statusUrl,
            healthUrl: candidate.healthUrl
          });
        });
      } else {
        logger.warn(
          "No non-local IPv4 addresses were detected. LAN access is unlikely until this machine has an active LAN address."
        );
      }
    } else {
      logger.warn(
        `Backend is configured to bind to ${config.host}. LAN devices usually require BACKEND_HOST=0.0.0.0.`
      );
    }

    logger.info(
      `TornPDA base URL should be ${
        diagnostics.preferredLanBaseUrl || diagnostics.localhostBaseUrl
      }`
    );
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      logger.error(
        `Port ${config.port} is already in use. Stop the other process or change BACKEND_PORT.`,
        { host: config.host, port: config.port }
      );
      process.exit(1);
      return;
    }

    logger.error("Server listen error", {
      message: error.message,
      code: error.code,
      host: config.host,
      port: config.port
    });
    process.exit(1);
  });

  function shutdown(signal) {
    logger.info("Shutting down", { signal });
    runner.stop();
    server.close(() => process.exit(0));
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error("Fatal startup error", { message: error.message, stack: error.stack });
  process.exit(1);
});
