const fs = require("fs/promises");
const { createApiError } = require("../utils/apiError");
const { appendActivityEntry } = require("../utils/activityLog");
const {
  SOURCE_MODES,
  normalizeSourceMode
} = require("../utils/sourceModes");

function nowIso() {
  return new Date().toISOString();
}

function createEmptySlot(slotNumber, timestamp = nowIso()) {
  return {
    slotNumber,
    occupied: false,
    enabled: false,
    sourceMode: SOURCE_MODES.MARKET_ONLY,
    itemId: null,
    itemName: null,
    targetPrice: null,
    nearMissGap: null,
    currentState: "EMPTY",
    createdAt: timestamp,
    updatedAt: timestamp,
    clearedAt: timestamp
  };
}

function createDefaultSlots(slotLimit, timestamp = nowIso()) {
  return Array.from({ length: slotLimit }, (_, index) =>
    createEmptySlot(index + 1, timestamp)
  );
}

function createDefaultSettings(defaultSettings) {
  return {
    alertCooldownMs: defaultSettings.alertCooldownMs,
    snapshotGroupingWindowMs: defaultSettings.snapshotGroupingWindowMs
  };
}

function createSessionSlotStats(slot, timestamp = nowIso()) {
  return {
    slotNumber: slot.slotNumber,
    occupied: Boolean(slot.occupied),
    itemId: slot.itemId ?? null,
    itemName: slot.itemName ?? null,
    sourceMode: normalizeSourceMode(slot.sourceMode, SOURCE_MODES.MARKET_ONLY),
    targetPrice: slot.targetPrice ?? null,
    nearMissGap: slot.nearMissGap ?? null,
    lastChecked: null,
    lowestListingPrice: null,
    highestListingPrice: null,
    totalAlertedQuantity: 0,
    totalListingsFound: 0,
    totalNearMisses: 0,
    totalAlerts: 0,
    lastAlertAt: null,
    lastAlertPrice: null,
    updatedAt: timestamp
  };
}

function createDefaultSession(slotLimit, timestamp = nowIso()) {
  const slots = {};

  for (let slotNumber = 1; slotNumber <= slotLimit; slotNumber += 1) {
    slots[String(slotNumber)] = createSessionSlotStats(
      createEmptySlot(slotNumber, timestamp),
      timestamp
    );
  }

  return {
    startedAt: null,
    lastResetAt: timestamp,
    slots
  };
}

function isLegacyDemoSeed(slots) {
  if (!Array.isArray(slots) || slots.length !== 6) {
    return false;
  }

  const [first, ...rest] = slots;

  if (!first || !first.occupied) {
    return false;
  }

  const matchesLegacyFirstSlot =
    first.slotNumber === 1 &&
    first.itemId === 886 &&
    first.itemName === "Torn City Times" &&
    first.targetPrice === 3400 &&
    first.nearMissGap === 250;

  if (!matchesLegacyFirstSlot) {
    return false;
  }

  return rest.every((slot, index) => {
    return (
      slot &&
      slot.slotNumber === index + 2 &&
      slot.occupied === false &&
      slot.itemId === null &&
      slot.itemName === null &&
      slot.targetPrice === null &&
      slot.nearMissGap === null
    );
  });
}

function createDefaultStore(slotLimit = 6, defaultSettings = {}) {
  const timestamp = nowIso();

  return {
    version: 5,
    settings: createDefaultSettings(defaultSettings),
    slots: createDefaultSlots(slotLimit, timestamp),
    processed: {},
    meta: {
      createdAt: timestamp,
      updatedAt: timestamp,
      lastPollStartedAt: null,
      lastPollCompletedAt: null,
      lastPollDurationMs: null,
      lastPollReason: null,
      lastPollSuccessCount: 0,
      lastPollFailureCount: 0,
      lastError: null,
      watchingActive: false,
      activityLog: [],
      session: createDefaultSession(slotLimit, timestamp)
    }
  };
}

function getDefaultOccupiedSourceMode(rawSlot, storeVersion) {
  if (rawSlot?.sourceMode) {
    return normalizeSourceMode(rawSlot.sourceMode);
  }

  // Older watcher versions tracked the Weav3r bazaar feed under a generic market label.
  return storeVersion >= 3 ? SOURCE_MODES.MARKET_ONLY : SOURCE_MODES.BAZAAR_ONLY;
}

function normalizeSlotNumber(value, slotLimit) {
  const slotNumber = Number.parseInt(value, 10);

  if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > slotLimit) {
    throw createApiError(
      400,
      "invalid_slot_number",
      `Slot number must be an integer between 1 and ${slotLimit}.`,
      {
        slotNumber: value
      }
    );
  }

  return slotNumber;
}

function parsePositiveInteger(value, fieldName, allowNull = false) {
  if (value === null || value === undefined || value === "") {
    if (allowNull) {
      return null;
    }

    throw createApiError(
      400,
      "field_required",
      `${fieldName} is required.`,
      {
        field: fieldName
      }
    );
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw createApiError(
      400,
      "invalid_integer",
      `${fieldName} must be a non-negative integer.`,
      {
        field: fieldName,
        value
      }
    );
  }

  if (fieldName === "itemId" && parsed <= 0) {
    throw createApiError(400, "invalid_item_id", "Item ID must be a positive integer.", {
      field: fieldName,
      value
    });
  }

  return parsed;
}

function parseTimingSetting(value, fieldName, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw createApiError(
      400,
      "invalid_timing_setting",
      `${fieldName} must be a non-negative integer.`,
      {
        field: fieldName,
        value
      }
    );
  }

  return parsed;
}

function sanitizeRuntimeSettings(input, existing, defaults) {
  return {
    alertCooldownMs: parseTimingSetting(
      input?.alertCooldownMs,
      "alertCooldownMs",
      existing?.alertCooldownMs ?? defaults.alertCooldownMs
    ),
    snapshotGroupingWindowMs: parseTimingSetting(
      input?.snapshotGroupingWindowMs,
      "snapshotGroupingWindowMs",
      existing?.snapshotGroupingWindowMs ?? defaults.snapshotGroupingWindowMs
    )
  };
}

function sanitizeSlotWatchInput(input, itemCatalog, existing = null) {
  let resolvedItem;

  try {
    resolvedItem = itemCatalog.resolve({
      itemId: input.itemId ?? existing?.itemId ?? null,
      itemName: input.itemName ?? existing?.itemName ?? ""
    });
  } catch (error) {
    throw createApiError(400, "item_resolution_failed", error.message, {
      itemId: input.itemId ?? existing?.itemId ?? null,
      itemName: input.itemName ?? existing?.itemName ?? ""
    });
  }

  const targetPrice = parsePositiveInteger(
    input.targetPrice ?? existing?.targetPrice,
    "targetPrice"
  );
  const nearMissGap = parsePositiveInteger(
    input.nearMissGap ?? existing?.nearMissGap,
    "nearMissGap"
  );
  const enabled =
    typeof input.enabled === "boolean" ? input.enabled : existing?.enabled ?? true;
  const sourceMode = normalizeSourceMode(
    input.sourceMode ?? existing?.sourceMode,
    existing?.sourceMode || SOURCE_MODES.MARKET_ONLY
  );

  return {
    occupied: true,
    enabled,
    sourceMode,
    itemId: resolvedItem.itemId,
    itemName: resolvedItem.itemName,
    targetPrice,
    nearMissGap,
    itemResolutionSource: resolvedItem.resolutionSource
  };
}

function normalizeSlotRecord(
  rawSlot,
  slotNumber,
  fallbackTimestamp,
  itemCatalog,
  storeVersion
) {
  const baseSlot = createEmptySlot(slotNumber, fallbackTimestamp);
  const itemId = parsePositiveInteger(rawSlot?.itemId, "itemId", true);

  if (!itemId) {
    return {
      ...baseSlot,
      createdAt: rawSlot?.createdAt || baseSlot.createdAt,
      updatedAt: rawSlot?.updatedAt || rawSlot?.createdAt || baseSlot.updatedAt,
      clearedAt: rawSlot?.clearedAt || rawSlot?.updatedAt || baseSlot.clearedAt
    };
  }

  const normalized = sanitizeSlotWatchInput(rawSlot, itemCatalog);

  return {
    slotNumber,
    occupied: true,
    enabled: normalized.enabled,
    sourceMode: getDefaultOccupiedSourceMode(rawSlot, storeVersion),
    itemId: normalized.itemId,
    itemName: normalized.itemName,
    targetPrice: normalized.targetPrice,
    nearMissGap: normalized.nearMissGap,
    currentState: String(rawSlot?.currentState || rawSlot?.state || "WAIT"),
    createdAt: rawSlot?.createdAt || fallbackTimestamp,
    updatedAt: rawSlot?.updatedAt || rawSlot?.createdAt || fallbackTimestamp,
    clearedAt: rawSlot?.clearedAt || null
  };
}

function migrateStore(rawData, slotLimit, itemCatalog, defaultSettings) {
  const fallback = createDefaultStore(slotLimit, defaultSettings);
  const source = rawData && typeof rawData === "object" ? rawData : fallback;
  const sourceVersion = Number.parseInt(source.version, 10) || 0;
  const createdAt = source.meta?.createdAt || fallback.meta.createdAt;
  let slots = createDefaultSlots(slotLimit, createdAt);

  if (Array.isArray(source.slots) && source.slots.length) {
    source.slots.forEach((slot) => {
      if (!slot) {
        return;
      }

      const slotNumber = normalizeSlotNumber(slot.slotNumber, slotLimit);
      slots[slotNumber - 1] = normalizeSlotRecord(
        slot,
        slotNumber,
        createdAt,
        itemCatalog,
        sourceVersion
      );
    });
  } else if (Array.isArray(source.watches) && source.watches.length) {
    source.watches.slice(0, slotLimit).forEach((watch, index) => {
      const slotNumber = index + 1;
      const normalized = sanitizeSlotWatchInput(watch, itemCatalog);
      slots[index] = {
        slotNumber,
        occupied: true,
        enabled: normalized.enabled,
        sourceMode: SOURCE_MODES.BAZAAR_ONLY,
        itemId: normalized.itemId,
        itemName: normalized.itemName,
        targetPrice: normalized.targetPrice,
        nearMissGap: normalized.nearMissGap,
        currentState: "WAIT",
        createdAt: watch.createdAt || createdAt,
        updatedAt: watch.updatedAt || watch.createdAt || createdAt,
        clearedAt: null
      };
    });
  }

  let processed = {};

  if (source.processed && typeof source.processed === "object") {
    slots.forEach((slot) => {
      if (!slot.occupied) {
        return;
      }

      const bySlotKey = source.processed[String(slot.slotNumber)];
      const byItemKey = source.processed[String(slot.itemId)];
      const previous = bySlotKey || byItemKey;

      if (!previous) {
        return;
      }

      processed[String(slot.slotNumber)] = {
        ...previous,
        slotNumber: slot.slotNumber,
        occupied: true,
        itemId: slot.itemId,
        itemName: slot.itemName
      };

      slots[slot.slotNumber - 1].currentState =
        previous.state || slot.currentState || "WAIT";
    });
  }

  if (isLegacyDemoSeed(slots)) {
    slots = createDefaultSlots(slotLimit, createdAt);
    processed = {};
  }

  return {
    version: 5,
    settings: sanitizeRuntimeSettings(
      source.settings || {},
      fallback.settings,
      defaultSettings
    ),
    slots,
    processed,
    meta: {
      ...fallback.meta,
      ...(source.meta || {}),
      watchingActive: false,
      session: {
        ...fallback.meta.session,
        ...(source.meta?.session || {}),
        slots: {
          ...fallback.meta.session.slots,
          ...(source.meta?.session?.slots || {})
        }
      }
    }
  };
}

class WatchRepository {
  constructor({ store, seedFile, slotLimit, itemCatalog, defaultSettings }) {
    this.store = store;
    this.seedFile = seedFile;
    this.slotLimit = slotLimit;
    this.itemCatalog = itemCatalog;
    this.defaultSettings = defaultSettings;
    this.activityLogLimit = defaultSettings.activityLogLimit || 40;
    this.data = createDefaultStore(slotLimit, defaultSettings);
  }

  cloneSessionSlotStats(slotStats) {
    return {
      ...slotStats
    };
  }

  ensureSessionSlotStats(slotNumber) {
    const normalizedSlotNumber = normalizeSlotNumber(slotNumber, this.slotLimit);
    const key = String(normalizedSlotNumber);
    const slot = this.getSlot(normalizedSlotNumber) || createEmptySlot(normalizedSlotNumber);

    this.data.meta.session = this.data.meta.session || createDefaultSession(this.slotLimit);
    this.data.meta.session.slots = this.data.meta.session.slots || {};

    if (!this.data.meta.session.slots[key]) {
      this.data.meta.session.slots[key] = createSessionSlotStats(slot);
    }

    return this.data.meta.session.slots[key];
  }

  createFreshSessionSummary(startedAt = null, timestamp = nowIso()) {
    const slots = {};

    for (const slot of this.listSlots()) {
      slots[String(slot.slotNumber)] = createSessionSlotStats(slot, timestamp);
    }

    return {
      startedAt,
      lastResetAt: timestamp,
      slots
    };
  }

  async init() {
    const liveStoreExists = await this.store.exists();

    if (!liveStoreExists) {
      try {
        const seedRaw = await fs.readFile(this.seedFile, "utf8");
        const parsedSeed = JSON.parse(seedRaw);
        this.data = migrateStore(
          parsedSeed,
          this.slotLimit,
          this.itemCatalog,
          this.defaultSettings
        );
      } catch (error) {
        this.data = createDefaultStore(this.slotLimit, this.defaultSettings);
      }

      await this.persist();
      return;
    }

    const current = await this.store.read();
    this.data = migrateStore(
      current,
      this.slotLimit,
      this.itemCatalog,
      this.defaultSettings
    );
    this.data.meta.watchingActive = false;
    await this.persist();
  }

  async persist() {
    this.data.meta.updatedAt = nowIso();
    await this.store.write(this.data);
  }

  getSettings() {
    return {
      ...this.data.settings
    };
  }

  getSettingsSummary() {
    return {
      alertCooldownMs: this.data.settings.alertCooldownMs,
      snapshotGroupingWindowMs: this.data.settings.snapshotGroupingWindowMs
    };
  }

  getActivityLog() {
    return [...(this.data.meta.activityLog || [])];
  }

  async appendActivity(entry) {
    const nextEntry = {
      timestamp: entry.timestamp || nowIso(),
      type: entry.type || "info",
      message: entry.message || "Activity recorded.",
      slotNumber:
        entry.slotNumber === null || entry.slotNumber === undefined
          ? null
          : Number.parseInt(entry.slotNumber, 10),
      itemId:
        entry.itemId === null || entry.itemId === undefined
          ? null
          : Number.parseInt(entry.itemId, 10),
      itemName: entry.itemName || null,
      details: entry.details && typeof entry.details === "object" ? entry.details : null
    };

    this.data.meta.activityLog = appendActivityEntry(
      this.data.meta.activityLog,
      nextEntry,
      this.activityLogLimit
    );

    await this.persist();
    return nextEntry;
  }

  async updateSettings(input) {
    this.data.settings = sanitizeRuntimeSettings(
      input,
      this.data.settings,
      this.defaultSettings
    );
    await this.persist();
    await this.appendActivity({
      type: "settings_updated",
      message: "Alert timing settings were updated.",
      details: {
        alertCooldownMs: this.data.settings.alertCooldownMs,
        snapshotGroupingWindowMs: this.data.settings.snapshotGroupingWindowMs
      }
    });
    return this.getSettings();
  }

  listSlots() {
    return [...this.data.slots].sort((left, right) => left.slotNumber - right.slotNumber);
  }

  listOccupiedSlots() {
    return this.listSlots().filter((slot) => slot.occupied);
  }

  listEnabledSlots() {
    return this.listSlots().filter((slot) => slot.occupied && slot.enabled);
  }

  findFirstEmptySlot() {
    return this.listSlots().find((slot) => !slot.occupied) || null;
  }

  getSlot(slotNumber) {
    const normalizedSlotNumber = normalizeSlotNumber(slotNumber, this.slotLimit);
    return this.data.slots.find((slot) => slot.slotNumber === normalizedSlotNumber) || null;
  }

  getSlotByItemId(itemId) {
    const normalizedItemId = Number.parseInt(itemId, 10);
    return this.data.slots.find((slot) => slot.itemId === normalizedItemId) || null;
  }

  getProcessed(slotNumber) {
    const normalizedSlotNumber = String(
      normalizeSlotNumber(slotNumber, this.slotLimit)
    );
    return this.data.processed[normalizedSlotNumber] || null;
  }

  getProcessedByItemId(itemId) {
    const slot = this.getSlotByItemId(itemId);
    return slot ? this.getProcessed(slot.slotNumber) : null;
  }

  listProcessed() {
    return this.listSlots().map((slot) => {
      if (!slot.occupied) {
        return null;
      }

      return this.getProcessed(slot.slotNumber) || null;
    });
  }

  getStatusSummary() {
    const slots = this.listSlots();
    const processed = this.listProcessed().filter(Boolean);
    const staleCount = this.isWatchingActive()
      ? processed.filter((result) => result.stale).length
      : 0;
    const occupiedCount = slots.filter((slot) => slot.occupied).length;
    const enabledCount = slots.filter((slot) => slot.occupied && slot.enabled).length;

    return {
      healthy: !this.isWatchingActive() || this.data.meta.lastPollFailureCount === 0,
      watchingActive: this.isWatchingActive(),
      slotLimit: this.slotLimit,
      slotCount: slots.length,
      occupiedCount,
      emptyCount: this.slotLimit - occupiedCount,
      watchCount: occupiedCount,
      enabledCount,
      activeEnabledCount: this.isWatchingActive() ? enabledCount : 0,
      staleCount,
      lastPollStartedAt: this.data.meta.lastPollStartedAt,
      lastPollCompletedAt: this.data.meta.lastPollCompletedAt,
      lastPollDurationMs: this.data.meta.lastPollDurationMs,
      lastPollReason: this.data.meta.lastPollReason,
      lastPollSuccessCount: this.data.meta.lastPollSuccessCount,
      lastPollFailureCount: this.data.meta.lastPollFailureCount,
      lastError: this.data.meta.lastError,
      activityCount: this.getActivityLog().length,
      sessionStartedAt: this.data.meta.session?.startedAt || null,
      sessionLastResetAt: this.data.meta.session?.lastResetAt || null
    };
  }

  getSessionSummary() {
    const slots = this.listSlots().reduce((accumulator, slot) => {
      const key = String(slot.slotNumber);
      const slotStats = this.ensureSessionSlotStats(slot.slotNumber);

      accumulator[key] = this.cloneSessionSlotStats({
        ...slotStats,
        occupied: Boolean(slot.occupied),
        itemId: slot.itemId ?? null,
        itemName: slot.itemName ?? null,
        sourceMode: normalizeSourceMode(slot.sourceMode, SOURCE_MODES.MARKET_ONLY),
        targetPrice: slot.targetPrice ?? null,
        nearMissGap: slot.nearMissGap ?? null
      });
      return accumulator;
    }, {});

    return {
      startedAt: this.data.meta.session?.startedAt || null,
      lastResetAt: this.data.meta.session?.lastResetAt || null,
      slots
    };
  }

  isWatchingActive() {
    return this.data.meta.watchingActive === true;
  }

  async setWatchingActive(active) {
    this.data.meta.watchingActive = active === true;
    await this.persist();
    return this.isWatchingActive();
  }

  async resetSessionStats(startedAt = null) {
    this.data.meta.session = this.createFreshSessionSummary(startedAt, nowIso());
    await this.persist();
    return this.getSessionSummary();
  }

  async recordSessionResult(slotNumber, result) {
    const slotStats = this.ensureSessionSlotStats(slotNumber);
    const listingPrices = Array.isArray(result?.currentListings)
      ? result.currentListings
          .map((listing) => Number(listing?.price))
          .filter((price) => Number.isFinite(price))
      : [];
    const buyNowQuantities = Array.isArray(result?.alertState?.latestEvent?.listings)
      ? result.alertState.latestEvent.listings
          .map((listing) => Number(listing?.quantity) || 0)
          .filter((quantity) => quantity > 0)
      : [];

    slotStats.occupied = Boolean(result?.occupied);
    slotStats.itemId = result?.itemId ?? slotStats.itemId ?? null;
    slotStats.itemName = result?.itemName ?? slotStats.itemName ?? null;
    slotStats.sourceMode = normalizeSourceMode(result?.sourceMode, slotStats.sourceMode);
    slotStats.targetPrice = result?.targetPrice ?? slotStats.targetPrice ?? null;
    slotStats.nearMissGap = result?.nearMissGap ?? slotStats.nearMissGap ?? null;
    slotStats.lastChecked = result?.lastChecked || result?.lastAttemptedAt || slotStats.lastChecked;
    slotStats.updatedAt = nowIso();

    if (listingPrices.length) {
      const lowestPrice = Math.min(...listingPrices);
      const highestPrice = Math.max(...listingPrices);

      slotStats.lowestListingPrice =
        slotStats.lowestListingPrice === null
          ? lowestPrice
          : Math.min(slotStats.lowestListingPrice, lowestPrice);
      slotStats.highestListingPrice =
        slotStats.highestListingPrice === null
          ? highestPrice
          : Math.max(slotStats.highestListingPrice, highestPrice);
      slotStats.totalListingsFound += listingPrices.length;
    }

    if (result?.nearMiss) {
      slotStats.totalNearMisses += 1;
    }

    if (result?.alertState?.shouldNotify && result?.alertState?.latestEvent) {
      slotStats.totalAlerts += 1;
      slotStats.lastAlertAt =
        result.alertState.latestEvent.timestamp || slotStats.updatedAt;
      slotStats.lastAlertPrice =
        result.alertState.latestEvent.price ?? slotStats.lastAlertPrice ?? null;

      if (result.alertState.latestEvent.type === "BUY_NOW") {
        slotStats.totalAlertedQuantity += buyNowQuantities.length
          ? buyNowQuantities.reduce((sum, quantity) => sum + quantity, 0)
          : Number(result.alertState.latestEvent.listing?.quantity) || 0;
      }
    }

    await this.persist();
    return this.cloneSessionSlotStats(slotStats);
  }

  exportBackup() {
    return {
      formatVersion: 1,
      exportedAt: nowIso(),
      backend: {
        settings: this.getSettingsSummary(),
        slots: this.listSlots().map((slot) => ({
          slotNumber: slot.slotNumber,
          occupied: Boolean(slot.occupied),
          enabled: Boolean(slot.enabled),
          sourceMode: normalizeSourceMode(slot.sourceMode, SOURCE_MODES.MARKET_ONLY),
          itemId: slot.itemId ?? null,
          itemName: slot.itemName ?? null,
          targetPrice: slot.targetPrice ?? null,
          nearMissGap: slot.nearMissGap ?? null
        }))
      }
    };
  }

  async importBackup(backup) {
    if (!backup || typeof backup !== "object") {
      throw createApiError(400, "invalid_backup", "Backup payload must be an object.");
    }

    const slotsInput = Array.isArray(backup.slots) ? backup.slots : null;

    if (!slotsInput) {
      throw createApiError(400, "invalid_backup", "Backup must include a slots array.");
    }

    const nextSettings = sanitizeRuntimeSettings(
      backup.settings || {},
      this.data.settings,
      this.defaultSettings
    );
    const timestamp = nowIso();
    const nextSlots = createDefaultSlots(this.slotLimit, timestamp);
    const seenItems = new Set();

    slotsInput.forEach((rawSlot) => {
      if (!rawSlot || typeof rawSlot !== "object") {
        throw createApiError(400, "invalid_backup_slot", "Each backup slot must be an object.");
      }

      const slotNumber = normalizeSlotNumber(rawSlot.slotNumber, this.slotLimit);

      if (!rawSlot.occupied) {
        return;
      }

      const normalized = sanitizeSlotWatchInput(rawSlot, this.itemCatalog);

      if (seenItems.has(normalized.itemId)) {
        throw createApiError(
          400,
          "duplicate_item",
          `Backup contains duplicate item ${normalized.itemName}.`,
          {
            itemId: normalized.itemId,
            itemName: normalized.itemName
          }
        );
      }

      seenItems.add(normalized.itemId);
      nextSlots[slotNumber - 1] = {
        slotNumber,
        occupied: true,
        enabled: normalized.enabled,
        sourceMode: normalized.sourceMode,
        itemId: normalized.itemId,
        itemName: normalized.itemName,
        targetPrice: normalized.targetPrice,
        nearMissGap: normalized.nearMissGap,
        currentState: "WAIT",
        createdAt: timestamp,
        updatedAt: timestamp,
        clearedAt: null
      };
    });

    this.data.settings = nextSettings;
    this.data.slots = nextSlots;
    this.data.processed = {};
    this.data.meta = {
      ...this.data.meta,
      lastError: null,
      lastPollSuccessCount: 0,
      lastPollFailureCount: 0,
      session: this.createFreshSessionSummary(null, timestamp)
    };
    await this.persist();
    await this.appendActivity({
      type: "backup_imported",
      message: "A backup import replaced the current slot configuration.",
      details: {
        occupiedCount: nextSlots.filter((slot) => slot.occupied).length
      }
    });

    return this.listSlots();
  }

  assertItemIdAvailable(itemId, excludedSlotNumber = null) {
    const existing = this.getSlotByItemId(itemId);

    if (existing && existing.slotNumber !== excludedSlotNumber) {
      throw createApiError(
        409,
        "duplicate_item",
        `${existing.itemName || `Item ${itemId}`} is already assigned to slot ${existing.slotNumber}.`,
        {
          itemId,
          slotNumber: existing.slotNumber,
          itemName: existing.itemName
        }
      );
    }
  }

  async createWatchInSlot(slotNumber, input) {
    const existingSlot = this.getSlot(slotNumber);

    if (existingSlot.occupied) {
      throw createApiError(
        409,
        "slot_occupied",
        `Slot ${existingSlot.slotNumber} is already occupied.`,
        {
          slotNumber: existingSlot.slotNumber,
          itemId: existingSlot.itemId,
          itemName: existingSlot.itemName
        }
      );
    }

    const normalized = sanitizeSlotWatchInput(input, this.itemCatalog);
    this.assertItemIdAvailable(normalized.itemId);

    const timestamp = nowIso();
    const created = {
      slotNumber: existingSlot.slotNumber,
      occupied: true,
      enabled: normalized.enabled,
      sourceMode: normalized.sourceMode,
      itemId: normalized.itemId,
      itemName: normalized.itemName,
      targetPrice: normalized.targetPrice,
      nearMissGap: normalized.nearMissGap,
      currentState: "WAIT",
      createdAt: existingSlot.createdAt || timestamp,
      updatedAt: timestamp,
      clearedAt: null
    };

    this.data.slots = this.data.slots.map((slot) =>
      slot.slotNumber === existingSlot.slotNumber ? created : slot
    );
    this.ensureSessionSlotStats(created.slotNumber);
    this.data.meta.session.slots[String(created.slotNumber)] = createSessionSlotStats(created);

    delete this.data.processed[String(existingSlot.slotNumber)];
    await this.persist();
    await this.appendActivity({
      type: "item_added",
      message: `Added ${created.itemName} to slot ${created.slotNumber}.`,
      slotNumber: created.slotNumber,
      itemId: created.itemId,
      itemName: created.itemName,
      details: {
        sourceMode: created.sourceMode,
        targetPrice: created.targetPrice,
        nearMissGap: created.nearMissGap
      }
    });
    return created;
  }

  async createWatch(input) {
    const requestedSlot = input?.slotNumber ? this.getSlot(input.slotNumber) : null;
    const targetSlot = requestedSlot || this.findFirstEmptySlot();

    if (!targetSlot) {
      throw createApiError(
        409,
        "slot_limit_reached",
        `All ${this.slotLimit} slots are already occupied.`,
        {
          slotLimit: this.slotLimit
        }
      );
    }

    return this.createWatchInSlot(targetSlot.slotNumber, input);
  }

  async updateSlot(slotNumber, updates) {
    const existing = this.getSlot(slotNumber);

    if (!existing.occupied) {
      throw createApiError(404, "slot_empty", `Slot ${existing.slotNumber} is empty.`, {
        slotNumber: existing.slotNumber
      });
    }

    const normalized = sanitizeSlotWatchInput(updates, this.itemCatalog, existing);
    this.assertItemIdAvailable(normalized.itemId, existing.slotNumber);

    const itemChanged = existing.itemId !== normalized.itemId;
    const sourceChanged = existing.sourceMode !== normalized.sourceMode;
    const updated = {
      ...existing,
      occupied: true,
      enabled: normalized.enabled,
      sourceMode: normalized.sourceMode,
      itemId: normalized.itemId,
      itemName: normalized.itemName,
      targetPrice: normalized.targetPrice,
      nearMissGap: normalized.nearMissGap,
      currentState: itemChanged || sourceChanged ? "WAIT" : existing.currentState || "WAIT",
      updatedAt: nowIso(),
      clearedAt: null
    };

    this.data.slots = this.data.slots.map((slot) =>
      slot.slotNumber === existing.slotNumber ? updated : slot
    );
    this.ensureSessionSlotStats(updated.slotNumber);
    this.data.meta.session.slots[String(updated.slotNumber)] = createSessionSlotStats(updated);

    if (itemChanged || sourceChanged) {
      delete this.data.processed[String(existing.slotNumber)];
    }

    await this.persist();
    await this.appendActivity({
      type: sourceChanged ? "mode_switched" : "slot_updated",
      message: sourceChanged
        ? `Slot ${updated.slotNumber} switched to ${updated.sourceMode === SOURCE_MODES.BAZAAR_ONLY ? "Bazaar Only" : "Market Only"}.`
        : `Updated slot ${updated.slotNumber} for ${updated.itemName}.`,
      slotNumber: updated.slotNumber,
      itemId: updated.itemId,
      itemName: updated.itemName,
      details: {
        sourceMode: updated.sourceMode,
        enabled: updated.enabled,
        targetPrice: updated.targetPrice,
        nearMissGap: updated.nearMissGap
      }
    });
    return updated;
  }

  async updateWatch(itemId, updates) {
    const slot = this.getSlotByItemId(itemId);

    if (!slot) {
      throw createApiError(404, "watch_not_found", `Watch not found for item ID ${itemId}.`, {
        itemId
      });
    }

    return this.updateSlot(slot.slotNumber, updates);
  }

  async clearSlot(slotNumber) {
    const existing = this.getSlot(slotNumber);

    if (!existing.occupied) {
      throw createApiError(
        404,
        "slot_empty",
        `Slot ${existing.slotNumber} is already empty.`,
        {
          slotNumber: existing.slotNumber
        }
      );
    }

    const cleared = createEmptySlot(existing.slotNumber, existing.createdAt || nowIso());
    cleared.updatedAt = nowIso();
    cleared.clearedAt = cleared.updatedAt;

    this.data.slots = this.data.slots.map((slot) =>
      slot.slotNumber === existing.slotNumber ? cleared : slot
    );
    this.ensureSessionSlotStats(cleared.slotNumber);
    this.data.meta.session.slots[String(cleared.slotNumber)] = createSessionSlotStats(cleared);

    delete this.data.processed[String(existing.slotNumber)];
    await this.persist();
    await this.appendActivity({
      type: "item_removed",
      message: `Removed ${existing.itemName} from slot ${existing.slotNumber}.`,
      slotNumber: existing.slotNumber,
      itemId: existing.itemId,
      itemName: existing.itemName,
      details: {
        sourceMode: existing.sourceMode
      }
    });
    return existing;
  }

  async deleteWatch(itemId) {
    const slot = this.getSlotByItemId(itemId);

    if (!slot) {
      throw createApiError(404, "watch_not_found", `Watch not found for item ID ${itemId}.`, {
        itemId
      });
    }

    return this.clearSlot(slot.slotNumber);
  }

  async setSlotEnabled(slotNumber, enabled) {
    const existing = this.getSlot(slotNumber);

    if (!existing.occupied) {
      throw createApiError(404, "slot_empty", `Slot ${existing.slotNumber} is empty.`, {
        slotNumber: existing.slotNumber
      });
    }

    if (typeof enabled !== "boolean") {
      throw createApiError(400, "invalid_enabled_value", "Enabled must be true or false.", {
        slotNumber: existing.slotNumber,
        enabled
      });
    }

    const updated = {
      ...existing,
      enabled,
      updatedAt: nowIso()
    };

    this.data.slots = this.data.slots.map((slot) =>
      slot.slotNumber === existing.slotNumber ? updated : slot
    );

    await this.persist();
    await this.appendActivity({
      type: enabled ? "slot_enabled" : "slot_disabled",
      message: `${enabled ? "Enabled" : "Disabled"} slot ${updated.slotNumber} for ${updated.itemName}.`,
      slotNumber: updated.slotNumber,
      itemId: updated.itemId,
      itemName: updated.itemName,
      details: {
        enabled
      }
    });
    return updated;
  }

  async clearAllSlots() {
    const timestamp = nowIso();

    this.data.slots = this.data.slots.map((slot) => {
      const cleared = createEmptySlot(slot.slotNumber, slot.createdAt || timestamp);
      cleared.updatedAt = timestamp;
      cleared.clearedAt = timestamp;
      return cleared;
    });
    this.data.processed = {};
    this.data.meta = {
      ...this.data.meta,
      lastError: null
    };
    this.data.meta.session = this.createFreshSessionSummary(null, timestamp);

    await this.persist();
    await this.appendActivity({
      type: "all_slots_cleared",
      message: "Reset all watcher slots to empty."
    });
    return this.listSlots();
  }

  async upsertProcessed(slotNumber, result) {
    const normalizedSlotNumber = normalizeSlotNumber(slotNumber, this.slotLimit);
    this.data.processed[String(normalizedSlotNumber)] = result;
    this.data.slots = this.data.slots.map((slot) =>
      slot.slotNumber === normalizedSlotNumber
        ? {
            ...slot,
            currentState: result.state,
            updatedAt: nowIso()
          }
        : slot
    );
    await this.persist();
    return result;
  }

  async updateMeta(patch) {
    this.data.meta = {
      ...this.data.meta,
      ...patch
    };

    await this.persist();
    return this.data.meta;
  }
}

module.exports = {
  WatchRepository,
  createDefaultStore,
  createEmptySlot
};
