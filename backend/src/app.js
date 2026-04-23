const express = require("express");
const cors = require("cors");
const { createWatchesRouter } = require("./routes/watchesRouter");
const { createStatusRouter } = require("./routes/statusRouter");
const { getNetworkDiagnostics } = require("./utils/networkDiagnostics");

function createApp({ repository, runner, config }) {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigin
    })
  );
  app.use(express.json());

  app.get("/", (request, response) => {
    const diagnostics = getNetworkDiagnostics(config);
    const lines = [
      `TornPDA Market Watcher backend is running. Version ${config.backendVersion}.`,
      `Local test URL: ${diagnostics.localhostStatusUrl}`,
      diagnostics.preferredLanStatusUrl
        ? `LAN test URL: ${diagnostics.preferredLanStatusUrl}`
        : "LAN test URL: no non-local IPv4 address detected on this machine yet.",
      "TornPDA base URL format: http://YOUR-PC-IP:3000",
      "Do not enter /api/status in TornPDA. The script appends the endpoint path internally.",
      "Plain health endpoint: /health",
      "Alert settings endpoint: /api/settings",
      "Item resolve endpoint: /api/items/resolve?q=Empty%20Box"
    ];

    response.type("text/plain").send(`${lines.join("\n")}\n`);
  });

  app.get("/health", (request, response) => {
    response
      .type("text/plain")
      .send("ok - tornpda-market-watcher backend is running\n");
  });

  app.use("/api", createWatchesRouter({ repository, runner, config }));
  app.use("/api", createStatusRouter({ repository, config }));

  return app;
}

module.exports = {
  createApp
};
