const path = require("path");
const fs = require("fs/promises");
const os = require("os");
const {
  parseMarketplacePayload,
  parseItemMarketPayload
} = require("../src/clients/weav3rClient");
const { ItemCatalog } = require("../src/services/itemCatalog");
const { JsonStore } = require("../src/storage/jsonStore");
const { WatchRepository } = require("../src/repositories/watchRepository");
const {
  evaluateWatch,
  buildStaleResult,
  buildIdleResult
} = require("../src/services/watchEvaluator");
const { SOURCE_MODES } = require("../src/utils/sourceModes");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const config = {
  backendVersion: "1.8.1",
  minimumCompatibleScriptVersion: "1.8.0",
  minimumCompatibleBackendVersion: "1.8.1",
  historyPointsLimit: 8,
  eventLogLimit: 25,
  activityLogLimit: 40,
  alertCooldownMs: 120000,
  snapshotGroupingWindowMs: 30000,
  alertImprovementAmount: 100
};

const samplePayload = {
  item_id: 886,
  item_name: "Torn City Times",
  market_price: 3443,
  bazaar_average: 3903,
  total_listings: 3,
  listings: [
    {
      item_id: 886,
      player_id: 3790401,
      player_name: "ecobos418",
      quantity: 3,
      price: 3299,
      content_updated: 1776741873,
      last_checked: 1776741873,
      content_updated_relative: "4 minutes ago",
      last_checked_relative: "4 minutes ago"
    },
    {
      item_id: 886,
      player_id: 4067941,
      player_name: "Aahsts1",
      quantity: 2,
      price: 3300,
      content_updated: 1776740862,
      last_checked: 1776741972,
      content_updated_relative: "21 minutes ago",
      last_checked_relative: "2 minutes ago"
    },
    {
      item_id: 886,
      player_id: 3536982,
      player_name: "Deglor",
      quantity: 1,
      price: 3369,
      content_updated: 1776734355,
      last_checked: 1776741583,
      content_updated_relative: "2 hours ago",
      last_checked_relative: "9 minutes ago"
    }
  ]
};

const sampleItemMarketPayload = {
  success: true,
  data: {
    item: {
      id: 886,
      name: "Torn City Times",
      type: "Tool",
      average_price: 3443
    },
    listings: [
      {
        price: 3299,
        amount: 3
      },
      {
        price: 3300,
        amount: 2
      },
      {
        price: 3369,
        amount: 1
      }
    ],
    cacheTimestamp: 1776741873,
    totalItems: 6,
    totalValue: 16635
  },
  fromCache: false
};

const aboveTargetPayload = {
  ...samplePayload,
  listings: samplePayload.listings.map((listing) => ({
    ...listing,
    price: listing.price + 200
  }))
};

const parsed = parseMarketplacePayload(samplePayload);
const parsedAboveTarget = parseMarketplacePayload(aboveTargetPayload);
const parsedItemMarket = parseItemMarketPayload(sampleItemMarketPayload, 886);
const itemCatalog = new ItemCatalog({
  catalogFile: path.resolve(__dirname, "..", "data", "item-catalog.json")
});

const resolvedById = itemCatalog.resolve({ itemId: 372 });
const resolvedByName = itemCatalog.resolve({ itemName: " empty box " });
const resolvedByNameUpper = itemCatalog.resolve({ itemName: "EMPTY BOX" });

const initialResult = evaluateWatch({
  watch: {
    slotNumber: 1,
    sourceMode: SOURCE_MODES.BAZAAR_ONLY,
    itemId: 886,
    itemName: "Torn City Times",
    targetPrice: 3300,
    nearMissGap: 100,
    enabled: true
  },
  snapshot: parsed,
  previousResult: null,
  nowIso: "2026-04-21T00:00:00.000Z",
  config
});

const confirmedResult = evaluateWatch({
  watch: {
    slotNumber: 1,
    sourceMode: SOURCE_MODES.BAZAAR_ONLY,
    itemId: 886,
    itemName: "Torn City Times",
    targetPrice: 3300,
    nearMissGap: 100,
    enabled: true
  },
  snapshot: parsed,
  previousResult: initialResult,
  nowIso: "2026-04-21T00:00:31.000Z",
  config
});

const disappearedBeforeConfirmation = evaluateWatch({
  watch: {
    slotNumber: 1,
    sourceMode: SOURCE_MODES.BAZAAR_ONLY,
    itemId: 886,
    itemName: "Torn City Times",
    targetPrice: 3200,
    nearMissGap: 100,
    enabled: true
  },
  snapshot: parsedAboveTarget,
  previousResult: initialResult,
  nowIso: "2026-04-21T00:00:31.000Z",
  config
});

const reappearedLowListing = evaluateWatch({
  watch: {
    slotNumber: 1,
    sourceMode: SOURCE_MODES.BAZAAR_ONLY,
    itemId: 886,
    itemName: "Torn City Times",
    targetPrice: 3300,
    nearMissGap: 100,
    enabled: true
  },
  snapshot: parsed,
  previousResult: disappearedBeforeConfirmation,
  nowIso: "2026-04-21T00:00:41.000Z",
  config
});

const nearMissDisabledResult = evaluateWatch({
  watch: {
    slotNumber: 2,
    sourceMode: SOURCE_MODES.BAZAAR_ONLY,
    itemId: 886,
    itemName: "Torn City Times",
    targetPrice: 3200,
    nearMissGap: 0,
    enabled: true
  },
  snapshot: parsedAboveTarget,
  previousResult: null,
  nowIso: "2026-04-21T00:00:00.000Z",
  config
});

const itemMarketOnlyResult = evaluateWatch({
  watch: {
    slotNumber: 3,
    sourceMode: SOURCE_MODES.MARKET_ONLY,
    itemId: 886,
    itemName: "Torn City Times",
    targetPrice: 3300,
    nearMissGap: 25,
    enabled: true
  },
  snapshot: parsedItemMarket,
  previousResult: null,
  nowIso: "2026-04-21T00:00:00.000Z",
  config
});

const staleResult = buildStaleResult({
  watch: {
    slotNumber: 1,
    sourceMode: SOURCE_MODES.BAZAAR_ONLY,
    itemId: 886,
    itemName: "Torn City Times",
    targetPrice: 3300,
    nearMissGap: 100,
    enabled: true
  },
  previousResult: confirmedResult,
  errorMessage: "sample fetch failure",
  nowIso: "2026-04-21T00:01:00.000Z",
  config
});

const idleResult = buildIdleResult({
  watch: {
    slotNumber: 1,
    sourceMode: SOURCE_MODES.BAZAAR_ONLY,
    itemId: 886,
    itemName: "Torn City Times",
    targetPrice: 3300,
    nearMissGap: 100,
    enabled: false
  },
  previousResult: confirmedResult,
  config
});

async function verifyLegacyDemoSeedReset() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tpda-market-smoke-"));
  const storeFile = path.join(tempRoot, "store.json");
  const seedFile = path.join(tempRoot, "seed.json");
  const legacySeed = {
    version: 2,
    slots: [
      {
        slotNumber: 1,
        occupied: true,
        enabled: true,
        sourceMode: SOURCE_MODES.BAZAAR_ONLY,
        itemId: 886,
        itemName: "Torn City Times",
        targetPrice: 3400,
        nearMissGap: 250,
        currentState: "BUY_NOW",
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
        clearedAt: null
      },
      { slotNumber: 2, occupied: false, enabled: false, itemId: null, itemName: null, targetPrice: null, nearMissGap: null },
      { slotNumber: 3, occupied: false, enabled: false, itemId: null, itemName: null, targetPrice: null, nearMissGap: null },
      { slotNumber: 4, occupied: false, enabled: false, itemId: null, itemName: null, targetPrice: null, nearMissGap: null },
      { slotNumber: 5, occupied: false, enabled: false, itemId: null, itemName: null, targetPrice: null, nearMissGap: null },
      { slotNumber: 6, occupied: false, enabled: false, itemId: null, itemName: null, targetPrice: null, nearMissGap: null }
    ],
    processed: {
      "1": {
        slotNumber: 1,
        occupied: true,
        itemId: 886,
        itemName: "Torn City Times",
        state: "BUY_NOW"
      }
    },
    meta: {
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z"
    }
  };

  await fs.writeFile(storeFile, JSON.stringify(legacySeed, null, 2), "utf8");
  await fs.writeFile(seedFile, JSON.stringify(legacySeed, null, 2), "utf8");

  const repository = new WatchRepository({
    store: new JsonStore(storeFile),
    seedFile,
    slotLimit: 6,
    itemCatalog,
    defaultSettings: {
      alertCooldownMs: config.alertCooldownMs,
      snapshotGroupingWindowMs: config.snapshotGroupingWindowMs,
      activityLogLimit: config.activityLogLimit
    }
  });

  await repository.init();

  const slots = repository.listSlots();
  const occupiedCount = slots.filter((slot) => slot.occupied).length;

  assert(occupiedCount === 0, "legacy demo seed should be cleared to empty slots");
  assert(
    repository.getProcessed(1) === null,
    "legacy demo seed cleanup should clear processed slot state"
  );
}

async function main() {
  assert(parsed.itemId === 886, "parser should map item_id");
  assert(
    parsedItemMarket.sourceMode === SOURCE_MODES.MARKET_ONLY &&
      parsedItemMarket.listings[0].playerId === null,
    "item market parser should normalize anonymous market rows separately from bazaar sellers"
  );
  assert(resolvedById.itemName === "Empty Box", "catalog should resolve by item ID");
  assert(resolvedByName.itemId === 372, "catalog should resolve by item name");
  assert(
    resolvedByNameUpper.itemId === 372,
    "catalog name resolution should be case-insensitive"
  );
  assert(initialResult.state === "BUY_NOW", "evaluator should detect BUY_NOW state");
  assert(
    initialResult.alertState.shouldNotify === true &&
      initialResult.alertState.latestEvent?.type === "BUY_NOW" &&
      initialResult.alertState.latestEvent?.reason === "new_listing_seen",
    "first qualifying low listing should alert immediately"
  );
  assert(
    confirmedResult.alertState.shouldNotify === false &&
      confirmedResult.alertState.activeBuyNowListings.length ===
        initialResult.alertState.activeBuyNowListings.length,
    "the same still-present low listing should not re-alert on the next snapshot"
  );
  assert(
    disappearedBeforeConfirmation.alertState.shouldNotify === false &&
      disappearedBeforeConfirmation.alertState.activeBuyNowListings.length === 0,
    "active low-listing memory should clear when a later real snapshot no longer contains it"
  );
  assert(
    reappearedLowListing.alertState.shouldNotify === true &&
      reappearedLowListing.alertState.latestEvent?.listing?.playerName === "ecobos418",
    "the same listing can alert again after disappearing and then reappearing in a later snapshot"
  );
  assert(
    nearMissDisabledResult.state === "WAIT" && nearMissDisabledResult.nearMiss === false,
    "near-miss gap 0 should disable near-miss alerts"
  );
  assert(
    itemMarketOnlyResult.sourceMode === SOURCE_MODES.MARKET_ONLY &&
      itemMarketOnlyResult.currentListings.length === 3 &&
      itemMarketOnlyResult.currentListings[0].playerId === null,
    "market-only evaluation should keep true item market rows separate from bazaar seller listings"
  );
  assert(staleResult.stale === true, "stale result should be marked stale");
  assert(
    staleResult.alertState.lastObservedState === "BUY_NOW",
    "stale result should preserve the last observed alert state"
  );
  assert(idleResult.state === "WAIT", "idle result should be forced to WAIT");
  assert(
    idleResult.alertState.latestEvent === null,
    "idle result should not expose a fresh latest event"
  );

  await verifyLegacyDemoSeedReset();

  console.log("Smoke check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
