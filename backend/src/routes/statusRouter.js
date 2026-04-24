const express = require("express");
const { getNetworkDiagnostics } = require("../utils/networkDiagnostics");
const { BACKEND_VERSION, MINIMUM_COMPATIBLE_SCRIPT_VERSION } = require("../version");

function createStatusRouter({ repository, runner, config }) {
  const router = express.Router();

  router.get("/status", (request, response) => {
    const network = getNetworkDiagnostics(config);
    const requestHost = request.get("host") || `${config.host}:${config.port}`;
    const scheme = request.protocol || "http";
    const detectedBaseUrl = `${scheme}://${requestHost}`;

    response.json({
      service: "tornpda-market-watcher",
      generatedAt: new Date().toISOString(),
      api: {
        slotLimit: config.slotLimit,
        detectedBaseUrl,
        expectedBaseUrlInput: detectedBaseUrl,
        exampleBaseUrl: network.preferredLanBaseUrl || `http://YOUR-LAN-IP:${config.port}`,
        endpoints: {
          root: "/",
          health: "/health",
          status: "/api/status",
          slots: "/api/slots",
          startWatching: "/api/watching/start",
          stopWatching: "/api/watching/stop",
          slot: "/api/slot/:slotNumber",
          addToSlot: "/api/slot/:slotNumber/watch",
          updateSlot: "/api/slot/:slotNumber",
          clearSlot: "/api/slot/:slotNumber"
        },
        instructions: {
          enterBaseOnly:
            `Enter the backend base URL only, for example ${
              network.preferredLanBaseUrl || `http://YOUR-LAN-IP:${config.port}`
            }`,
          doNotEnterEndpointPath:
            "Do not enter /api/status, /api/slots, or /api/watches in TornPDA"
        }
      },
      network,
      config: {
        backendVersion: config.backendVersion,
        host: config.host,
        port: config.port,
        slotLimit: config.slotLimit,
        pollIntervalMs: config.pollIntervalMs,
        requestTimeoutMs: config.requestTimeoutMs,
        alertCooldownMs: config.alertCooldownMs,
        snapshotGroupingWindowMs: config.snapshotGroupingWindowMs,
        alertImprovementAmount: config.alertImprovementAmount,
        staleAfterMs: config.staleAfterMs,
        activityLogLimit: config.activityLogLimit
      },
      versions: {
        backendVersion: BACKEND_VERSION,
        minimumCompatibleScriptVersion: MINIMUM_COMPATIBLE_SCRIPT_VERSION
      },
      settings: repository.getSettingsSummary(),
      session: repository.getSessionSummary(),
      activityLog: repository.getActivityLog(),
      itemCatalog: repository.itemCatalog.getSummary(),
      status: {
        ...repository.getStatusSummary(),
        ...runner.getRuntimeSummary()
      }
    });
  });

  return router;
}

module.exports = {
  createStatusRouter
};
