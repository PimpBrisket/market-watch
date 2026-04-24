const express = require("express");
const { formatSlotCollection, withLinks } = require("../services/tornPdaFormatter");
const {
  buildEmptySlotResult,
  buildIdleResult
} = require("../services/watchEvaluator");
const { createApiError } = require("../utils/apiError");
const { normalizeApiError } = require("../utils/apiError");

function buildSlotView(slot, repository, config) {
  if (!slot.occupied) {
    return buildEmptySlotResult({ slot });
  }

  const effectiveConfig = {
    ...config,
    ...repository.getSettings()
  };

  if (!repository.isWatchingActive()) {
    return buildIdleResult({
      watch: slot,
      previousResult: repository.getProcessed(slot.slotNumber),
      config: effectiveConfig
    });
  }

  return repository.getProcessed(slot.slotNumber) ||
    buildIdleResult({
      watch: slot,
      previousResult: null,
      config: effectiveConfig
    });
}

function buildCollectionPayload(repository, runner, config) {
  const status = {
    ...repository.getStatusSummary(),
    ...runner.getRuntimeSummary()
  };
  const slots = repository.listSlots().map((slot) => {
    return buildSlotView(slot, repository, config);
  });

  return formatSlotCollection({
    slots,
    status,
    settings: repository.getSettingsSummary(),
    activityLog: repository.getActivityLog(),
    versions: {
      backendVersion: config.backendVersion,
      minimumCompatibleScriptVersion: config.minimumCompatibleScriptVersion
    },
    tornMarketBaseUrl: config.tornMarketBaseUrl,
    staleAfterMs: config.staleAfterMs
  });
}

function sendApiError(response, error, fallbackStatus = 400) {
  const normalized = normalizeApiError(error, fallbackStatus);

  response.status(normalized.status).json({
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details || null
    }
  });
}

function createWatchesRouter({ repository, runner, config }) {
  const router = express.Router();

  router.get("/slots", (request, response) => {
    response.json({
      ok: true,
      ...buildCollectionPayload(repository, runner, config)
    });
  });

  router.get("/watches", (request, response) => {
    response.json({
      ok: true,
      ...buildCollectionPayload(repository, runner, config)
    });
  });

  router.get("/slot/:slotNumber", (request, response) => {
    try {
      const slot = repository.getSlot(request.params.slotNumber);
      const view = buildSlotView(slot, repository, config);

      response.json({
        ok: true,
        slot: withLinks(view, config.tornMarketBaseUrl, config.staleAfterMs)
      });
    } catch (error) {
      sendApiError(response, error, 404);
    }
  });

  router.get("/settings", (request, response) => {
    response.json({
      ok: true,
      settings: repository.getSettingsSummary()
    });
  });

  router.get("/backup/export", (request, response) => {
    response.json({
      ok: true,
      backup: repository.exportBackup()
    });
  });

  router.post("/backup/import", async (request, response) => {
    try {
      await repository.importBackup(request.body?.backup || {});
      response.json({
        ok: true,
        ...buildCollectionPayload(repository, runner, config)
      });
    } catch (error) {
      sendApiError(response, error, 400);
    }
  });

  async function saveSettings(request, response) {
    try {
      const settings = await repository.updateSettings(request.body || {});
      response.json({
        ok: true,
        settings
      });
    } catch (error) {
      sendApiError(response, error, 400);
    }
  }

  router.put("/settings", saveSettings);
  router.post("/settings", saveSettings);

  router.get("/watching", (request, response) => {
    response.json({
      ok: true,
      watching: runner.getRuntimeSummary(),
      status: {
        ...repository.getStatusSummary(),
        ...runner.getRuntimeSummary()
      }
    });
  });

  router.post("/watching/start", async (request, response) => {
    try {
      await runner.startWatching("api_start");
      response.json({
        ok: true,
        ...buildCollectionPayload(repository, runner, config)
      });
    } catch (error) {
      sendApiError(response, error, 500);
    }
  });

  router.post("/watching/stop", async (request, response) => {
    try {
      await runner.stopWatching("api_stop");
      response.json({
        ok: true,
        ...buildCollectionPayload(repository, runner, config)
      });
    } catch (error) {
      sendApiError(response, error, 500);
    }
  });

  router.get("/items/resolve", (request, response) => {
    try {
      const item = repository.itemCatalog.resolve({
        itemId: request.query.itemId ?? request.query.q ?? null,
        itemName: request.query.itemName ?? request.query.q ?? ""
      });

      response.json({
        ok: true,
        item,
        source: repository.itemCatalog.getSummary()
      });
    } catch (error) {
      sendApiError(response, error, 400);
    }
  });

  router.get("/items/search", (request, response) => {
    const query = String(request.query.q || "").trim();

    if (!query) {
      response.json({
        ok: true,
        items: [],
        source: repository.itemCatalog.getSummary()
      });
      return;
    }

    const matches = repository.itemCatalog
      .searchByName(query)
      .slice(0, 10)
      .map((item) => ({
        itemId: item.itemId,
        itemName: item.itemName
      }));

    response.json({
      ok: true,
      items: matches,
      source: repository.itemCatalog.getSummary()
    });
  });

  router.get("/watch/:itemId", (request, response) => {
    const slot = repository.getSlotByItemId(request.params.itemId);

    if (!slot) {
      sendApiError(
        response,
        {
          status: 404,
          code: "watch_not_found",
          message: "Watch result not found.",
          details: {
            itemId: request.params.itemId
          }
        },
        404
      );
      return;
    }

    const view = buildSlotView(slot, repository, config);

    response.json({
      ok: true,
      slot: withLinks(view, config.tornMarketBaseUrl, config.staleAfterMs),
      watch: withLinks(view, config.tornMarketBaseUrl, config.staleAfterMs)
    });
  });

  router.post("/slot/:slotNumber/watch", async (request, response) => {
    try {
      const created = await repository.createWatchInSlot(
        request.params.slotNumber,
        request.body || {}
      );
      const refreshed = await runner.refreshSlot(created.slotNumber);

      response.status(201).json({
        ok: true,
        slot: withLinks(refreshed, config.tornMarketBaseUrl, config.staleAfterMs)
      });
    } catch (error) {
      sendApiError(response, error, 400);
    }
  });

  async function updateSlot(request, response) {
    try {
      const updated = await repository.updateSlot(request.params.slotNumber, request.body || {});
      const refreshed = await runner.refreshSlot(updated.slotNumber);

      response.json({
        ok: true,
        slot: withLinks(refreshed, config.tornMarketBaseUrl, config.staleAfterMs)
      });
    } catch (error) {
      sendApiError(response, error, 400);
    }
  }

  router.put("/slot/:slotNumber", updateSlot);
  router.post("/slot/:slotNumber/update", updateSlot);

  router.post("/slot/:slotNumber/enabled", async (request, response) => {
    try {
      const updated = await repository.setSlotEnabled(
        request.params.slotNumber,
        request.body?.enabled
      );
      const refreshed = await runner.refreshSlot(updated.slotNumber);

      response.json({
        ok: true,
        slot: withLinks(refreshed, config.tornMarketBaseUrl, config.staleAfterMs)
      });
    } catch (error) {
      sendApiError(response, error, 400);
    }
  });

  async function clearSlot(request, response) {
    try {
      const removed = await repository.clearSlot(request.params.slotNumber);

      response.json({
        ok: true,
        deleted: true,
        slotNumber: removed.slotNumber
      });
    } catch (error) {
      sendApiError(response, error, 404);
    }
  }

  router.delete("/slot/:slotNumber", clearSlot);
  router.post("/slot/:slotNumber/clear", clearSlot);

  router.post("/slots/reset", async (request, response) => {
    try {
      await repository.clearAllSlots();

      response.json({
        ok: true,
        cleared: true,
        slotCount: repository.listSlots().length
      });
    } catch (error) {
      sendApiError(response, error, 400);
    }
  });

  router.post("/refresh", async (request, response) => {
    if (!runner.isWatchingActive()) {
      sendApiError(
        response,
        createApiError(
          409,
          "watching_inactive",
          "Global watching is stopped. Start Watching before running a backend poll."
        ),
        409
      );
      return;
    }

    try {
      await runner.runPollCycle("manual_api");
      response.json({
        ok: true,
        ...buildCollectionPayload(repository, runner, config)
      });
    } catch (error) {
      sendApiError(response, error, 500);
    }
  });

  router.post("/watches", async (request, response) => {
    try {
      const created = await repository.createWatch(request.body || {});
      const refreshed = await runner.refreshSlot(created.slotNumber);

      response.status(201).json({
        ok: true,
        slot: withLinks(refreshed, config.tornMarketBaseUrl, config.staleAfterMs)
      });
    } catch (error) {
      sendApiError(response, error, 400);
    }
  });

  async function updateWatch(request, response) {
    try {
      const updated = await repository.updateWatch(request.params.itemId, request.body || {});
      const refreshed = await runner.refreshSlot(updated.slotNumber);

      response.json({
        ok: true,
        slot: withLinks(refreshed, config.tornMarketBaseUrl, config.staleAfterMs),
        watch: withLinks(refreshed, config.tornMarketBaseUrl, config.staleAfterMs)
      });
    } catch (error) {
      sendApiError(response, error, 400);
    }
  }

  router.put("/watch/:itemId", updateWatch);
  router.post("/watch/:itemId/update", updateWatch);

  async function deleteWatch(request, response) {
    try {
      const removed = await repository.deleteWatch(request.params.itemId);
      response.json({
        ok: true,
        deleted: true,
        slotNumber: removed.slotNumber,
        itemId: removed.itemId
      });
    } catch (error) {
      sendApiError(response, error, 404);
    }
  }

  router.delete("/watch/:itemId", deleteWatch);
  router.post("/watch/:itemId/delete", deleteWatch);

  return router;
}

module.exports = {
  createWatchesRouter
};
