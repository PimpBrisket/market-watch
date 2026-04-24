const {
  evaluateWatch,
  buildStaleResult,
  buildIdleResult
} = require("./watchEvaluator");

class WatchRunner {
  constructor({ repository, weav3rClient, config, logger }) {
    this.repository = repository;
    this.weav3rClient = weav3rClient;
    this.config = config;
    this.logger = logger;
    this.intervalHandle = null;
    this.pollInFlight = false;
  }

  async start() {
    this.stop();
    await this.repository.setWatchingActive(false);
    await this.syncOccupiedSlotsToIdle();
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  isWatchingActive() {
    return this.repository.isWatchingActive();
  }

  getRuntimeSummary() {
    const watchingActive = this.isWatchingActive();
    const polling = watchingActive ? this.pollInFlight : false;

    return {
      watchingActive,
      polling,
      watcherStatus: polling
        ? "WATCHING"
        : watchingActive
          ? "WATCHING"
          : "INACTIVE"
    };
  }

  async syncOccupiedSlotsToIdle() {
    const runtimeSettings = this.repository.getSettings();
    const effectiveConfig = {
      ...this.config,
      ...runtimeSettings
    };

    for (const slot of this.repository.listOccupiedSlots()) {
      const idleResult = buildIdleResult({
        watch: slot,
        previousResult: this.repository.getProcessed(slot.slotNumber),
        config: effectiveConfig
      });

      await this.repository.upsertProcessed(slot.slotNumber, idleResult);
    }
  }

  async startWatching(reason = "manual") {
    if (this.isWatchingActive()) {
      return this.getRuntimeSummary();
    }

    await this.repository.setWatchingActive(true);
    await this.repository.updateMeta({
      lastError: null
    });
    await this.repository.appendActivity({
      type: "watching_started",
      message: "Global watching was started.",
      details: {
        reason
      }
    });

    await this.runPollCycle("start");

    this.stop();
    this.intervalHandle = setInterval(() => {
      this.runPollCycle("interval").catch((error) => {
        this.logger.error("Unhandled poll cycle error", { message: error.message });
      });
    }, this.config.pollIntervalMs);

    return this.getRuntimeSummary();
  }

  async stopWatching(reason = "manual") {
    const wasActive = this.isWatchingActive() || this.pollInFlight || Boolean(this.intervalHandle);

    this.stop();
    await this.repository.setWatchingActive(false);
    await this.repository.updateMeta({
      lastError: null
    });
    await this.syncOccupiedSlotsToIdle();

    if (wasActive) {
      await this.repository.appendActivity({
        type: "watching_stopped",
        message: "Global watching was stopped.",
        details: {
          reason
        }
      });
    }

    return this.getRuntimeSummary();
  }

  async runPollCycle(reason = "manual") {
    if (!this.isWatchingActive()) {
      this.logger.info("Skipping poll cycle because global watching is inactive", { reason });
      return {
        ok: false,
        skipped: true,
        inactive: true
      };
    }

    if (this.pollInFlight) {
      this.logger.warn("Skipping poll cycle because a previous cycle is still running");
      return {
        ok: false,
        skipped: true,
        inFlight: true
      };
    }

    const startedAt = Date.now();
    const startedIso = new Date(startedAt).toISOString();

    this.pollInFlight = true;
    await this.repository.updateMeta({
      lastPollStartedAt: startedIso,
      lastPollReason: reason
    });

    const enabledSlots = this.repository.listEnabledSlots();
    let successCount = 0;
    let failureCount = 0;
    let lastError = null;

    try {
      for (const slot of enabledSlots) {
        const refreshed = await this.refreshSlot(slot.slotNumber);

        if (refreshed.stale) {
          failureCount += 1;
          lastError = refreshed.lastError;
        } else {
          successCount += 1;
        }
      }
    } finally {
      this.pollInFlight = false;
    }

    await this.repository.updateMeta({
      lastPollCompletedAt: new Date().toISOString(),
      lastPollDurationMs: Date.now() - startedAt,
      lastPollSuccessCount: successCount,
      lastPollFailureCount: failureCount,
      lastError
    });

    return {
      ok: true,
      successCount,
      failureCount,
      lastError
    };
  }

  async refreshSlot(slotNumber) {
    const watch = this.repository.getSlot(slotNumber);

    if (!watch) {
      throw new Error(`slot not found for slotNumber ${slotNumber}`);
    }

    if (!watch.enabled) {
      const runtimeSettings = this.repository.getSettings();
      const idleResult = buildIdleResult({
        watch,
        previousResult: this.repository.getProcessed(slotNumber),
        config: {
          ...this.config,
          ...runtimeSettings
        }
      });

      await this.repository.upsertProcessed(slotNumber, idleResult);
      return idleResult;
    }

    const previousResult = this.repository.getProcessed(slotNumber);
    const nowIso = new Date().toISOString();
    const runtimeSettings = this.repository.getSettings();
    const effectiveConfig = {
      ...this.config,
      ...runtimeSettings
    };

    if (!this.isWatchingActive()) {
      const idleResult = buildIdleResult({
        watch,
        previousResult,
        config: effectiveConfig
      });

      await this.repository.upsertProcessed(slotNumber, idleResult);
      return idleResult;
    }

    try {
      const snapshot = await this.weav3rClient.fetchSnapshot(watch.itemId, watch.sourceMode);
      const result = evaluateWatch({
        watch: {
          ...watch,
          itemName: watch.itemName || snapshot.itemName
        },
        snapshot,
        previousResult,
        nowIso,
        config: effectiveConfig
      });

      if (!this.isWatchingActive()) {
        const idleResult = buildIdleResult({
          watch,
          previousResult,
          config: effectiveConfig
        });

        await this.repository.upsertProcessed(slotNumber, idleResult);
        return idleResult;
      }

      this.logger.info("Fetched source snapshot", {
        slotNumber: watch.slotNumber,
        itemId: watch.itemId,
        itemName: result.itemName,
        sourceMode: result.sourceMode,
        state: result.state,
        lowestPrice: result.lowestPrice
      });

      if (previousResult?.state !== result.state) {
        this.logger.info("Watch state changed", {
          slotNumber: watch.slotNumber,
          itemId: watch.itemId,
          from: previousResult?.state || "WAIT",
          to: result.state
        });
      }

      await this.recordListingActivity(previousResult, result);

      if (result.alertState.shouldNotify && result.alertState.latestEvent) {
        this.logger.info("Alert fired", {
          slotNumber: watch.slotNumber,
          itemId: watch.itemId,
          type: result.alertState.latestEvent.type,
          reason: result.alertState.latestEvent.reason,
          price: result.alertState.latestEvent.price,
          listingKey: result.alertState.latestEvent.listingKey || null,
          sellerName: result.alertState.latestEvent.sellerName || null,
          listingCount: result.alertState.latestEvent.listingCount || 0,
          groupingWindowMs: result.alertState.groupingWindowMs,
          cooldownMs: result.alertState.cooldownMs
        });
        await this.repository.appendActivity({
          type: "alert_triggered",
          message: `Alert ${result.alertState.latestEvent.type} triggered for ${result.itemName}.`,
          slotNumber: result.slotNumber,
          itemId: result.itemId,
          itemName: result.itemName,
          details: {
            sourceMode: result.sourceMode,
            price: result.alertState.latestEvent.price,
            sellerName: result.alertState.latestEvent.sellerName || null,
            listingKey: result.alertState.latestEvent.listingKey || null
          }
        });
      }

      await this.repository.upsertProcessed(slotNumber, result);
      return result;
    } catch (error) {
      this.logger.error("Failed source fetch", {
        slotNumber: watch.slotNumber,
        itemId: watch.itemId,
        sourceMode: watch.sourceMode,
        message: error.message
      });

      const staleResult = buildStaleResult({
        watch,
        previousResult,
        errorMessage: error.message,
        nowIso,
        config: effectiveConfig
      });

      if (!this.isWatchingActive()) {
        const idleResult = buildIdleResult({
          watch,
          previousResult,
          config: effectiveConfig
        });

        await this.repository.upsertProcessed(slotNumber, idleResult);
        return idleResult;
      }

      await this.repository.upsertProcessed(slotNumber, staleResult);
      return staleResult;
    }
  }

  async refreshWatch(itemId) {
    const slot = this.repository.getSlotByItemId(itemId);

    if (!slot) {
      throw new Error(`watch not found for itemId ${itemId}`);
    }

    return this.refreshSlot(slot.slotNumber);
  }

  async recordListingActivity(previousResult, result) {
    const previousQualifying = new Set(
      (previousResult?.qualifyingListings || [])
        .map((listing) => listing.listingKey)
        .filter(Boolean)
    );
    const currentQualifying = new Set(
      (result?.qualifyingListings || [])
        .map((listing) => listing.listingKey)
        .filter(Boolean)
    );
    const detectedCount = [...currentQualifying].filter((key) => !previousQualifying.has(key)).length;
    const removedCount = [...previousQualifying].filter((key) => !currentQualifying.has(key)).length;

    if (detectedCount > 0) {
      await this.repository.appendActivity({
        type: "listing_detected",
        message: `Detected ${detectedCount} qualifying listing${detectedCount === 1 ? "" : "s"} for ${result.itemName}.`,
        slotNumber: result.slotNumber,
        itemId: result.itemId,
        itemName: result.itemName,
        details: {
          sourceMode: result.sourceMode,
          detectedCount
        }
      });
    }

    if (removedCount > 0) {
      await this.repository.appendActivity({
        type: "listing_removed",
        message: `Removed ${removedCount} qualifying listing${removedCount === 1 ? "" : "s"} from active memory for ${result.itemName}.`,
        slotNumber: result.slotNumber,
        itemId: result.itemId,
        itemName: result.itemName,
        details: {
          sourceMode: result.sourceMode,
          removedCount
        }
      });
    }
  }
}

module.exports = {
  WatchRunner
};
