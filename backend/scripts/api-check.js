const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createApp } = require("../src/app");
const { JsonStore } = require("../src/storage/jsonStore");
const { WatchRepository } = require("../src/repositories/watchRepository");
const { WatchRunner } = require("../src/services/watchRunner");
const { ItemCatalog } = require("../src/services/itemCatalog");
const {
  parseMarketplacePayload,
  parseItemMarketPayload
} = require("../src/clients/weav3rClient");
const { SOURCE_MODES } = require("../src/utils/sourceModes");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const catalog = new ItemCatalog({
  catalogFile: path.resolve(__dirname, "..", "data", "item-catalog.json")
});

const config = {
  backendVersion: "1.8.6",
  minimumCompatibleScriptVersion: "1.8.0",
  minimumCompatibleBackendVersion: "1.8.1",
  corsOrigin: "*",
  slotLimit: 6,
  pollIntervalMs: 10000,
  requestTimeoutMs: 8000,
  alertCooldownMs: 30000,
  snapshotGroupingWindowMs: 0,
  alertImprovementAmount: 100,
  historyPointsLimit: 8,
  eventLogLimit: 25,
  activityLogLimit: 40,
  staleAfterMs: 30000,
  tornMarketBaseUrl:
    "https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID="
};

const samples = {
  bazaar: {
    372: parseMarketplacePayload({
      item_id: 372,
      item_name: "Empty Box",
      market_price: 99,
      bazaar_average: 101,
      total_listings: 2,
      listings: [
        {
          item_id: 372,
          player_id: 111111,
          player_name: "SellerOne",
          quantity: 2,
          price: 95,
          content_updated: 1776741873,
          last_checked: 1776741873,
          content_updated_relative: "4 minutes ago",
          last_checked_relative: "4 minutes ago"
        },
        {
          item_id: 372,
          player_id: 222222,
          player_name: "SellerTwo",
          quantity: 1,
          price: 110,
          content_updated: 1776741874,
          last_checked: 1776741874,
          content_updated_relative: "4 minutes ago",
          last_checked_relative: "4 minutes ago"
        }
      ]
    }),
    886: parseMarketplacePayload({
      item_id: 886,
      item_name: "Torn City Times",
      market_price: 3443,
      bazaar_average: 3263,
      total_listings: 2,
      listings: [
        {
          item_id: 886,
          player_id: 333333,
          player_name: "SellerThree",
          quantity: 1,
          price: 3299,
          content_updated: 1776741875,
          last_checked: 1776741875,
          content_updated_relative: "4 minutes ago",
          last_checked_relative: "4 minutes ago"
        },
        {
          item_id: 886,
          player_id: 444444,
          player_name: "SellerFour",
          quantity: 1,
          price: 3405,
          content_updated: 1776741876,
          last_checked: 1776741876,
          content_updated_relative: "4 minutes ago",
          last_checked_relative: "4 minutes ago"
        }
      ]
    })
  },
  market: {
    372: parseItemMarketPayload(
      {
        success: true,
        data: {
          item: {
            id: 372,
            name: "Empty Box",
            type: "Misc",
            average_price: 99
          },
          listings: [
            { price: 97, amount: 4 },
            { price: 100, amount: 3 }
          ],
          cacheTimestamp: 1776741873,
          totalItems: 7,
          totalValue: 688
        },
        fromCache: false
      },
      372
    ),
    886: parseItemMarketPayload(
      {
        success: true,
        data: {
          item: {
            id: 886,
            name: "Torn City Times",
            type: "Tool",
            average_price: 3443
          },
          listings: [
            { price: 3300, amount: 2 },
            { price: 3405, amount: 1 }
          ],
          cacheTimestamp: 1776741875,
          totalItems: 3,
          totalValue: 10005
        },
        fromCache: false
      },
      886
    )
  }
};

function bumpPrices(snapshot, amount) {
  return parseMarketplacePayload({
    item_id: snapshot.itemId,
    item_name: snapshot.itemName,
    market_price:
      snapshot.marketPrice === null ? null : snapshot.marketPrice + amount,
    bazaar_average:
      snapshot.bazaarAverage === null ? null : snapshot.bazaarAverage + amount,
    total_listings: snapshot.totalListings,
    listings: snapshot.listings.map((listing) => ({
      item_id: listing.itemId,
      player_id: listing.playerId,
      player_name: listing.playerName,
      quantity: listing.quantity,
      price: listing.price + amount,
      content_updated: listing.contentUpdated,
      last_checked: listing.lastChecked,
      content_updated_relative: listing.contentUpdatedRelative,
      last_checked_relative: listing.lastCheckedRelative
    }))
  });
}

const fakeClient = {
  async fetchSnapshot(itemId, sourceMode) {
    const snapshot =
      normalizeSourceModeForTest(sourceMode) === SOURCE_MODES.BAZAAR_ONLY
        ? samples.bazaar[itemId]
        : samples.market[itemId];

    if (!snapshot) {
      throw new Error(`No sample configured for item ${itemId}`);
    }

    return snapshot;
  }
};

function normalizeSourceModeForTest(value) {
  return value === SOURCE_MODES.BAZAAR_ONLY ? SOURCE_MODES.BAZAAR_ONLY : SOURCE_MODES.MARKET_ONLY;
}

const logger = {
  info() {},
  warn() {},
  error() {}
};

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();

  return {
    status: response.status,
    payload
  };
}

async function requestText(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || "GET",
    headers: options.headers || {}
  });
  const text = await response.text();

  return {
    status: response.status,
    text
  };
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tpda-market-api-"));
  const storeFile = path.join(tempRoot, "store.json");
  const repository = new WatchRepository({
    store: new JsonStore(storeFile),
    seedFile: path.join(tempRoot, "seed.json"),
    slotLimit: config.slotLimit,
    itemCatalog: catalog,
    defaultSettings: {
      alertCooldownMs: config.alertCooldownMs,
      snapshotGroupingWindowMs: config.snapshotGroupingWindowMs,
      activityLogLimit: config.activityLogLimit
    }
  });

  await repository.init();

  const runner = new WatchRunner({
    repository,
    weav3rClient: fakeClient,
    config,
    logger
  });

  const app = createApp({
    repository,
    runner,
    config
  });

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    let result = await requestJson(baseUrl, "/api/status");
    assert(result.status === 200, "GET /api/status should return 200");
    assert(
      result.payload.versions?.backendVersion === config.backendVersion,
      "status payload should expose the backend version"
    );
    assert(
      result.payload.versions?.minimumCompatibleScriptVersion ===
        config.minimumCompatibleScriptVersion,
      "status payload should expose the minimum compatible script version"
    );
    assert(
      result.payload.status?.watchingActive === false,
      "backend should start with global watching OFF"
    );
    assert(
      result.payload.status?.watcherStatus === "INACTIVE",
      "backend should report INACTIVE watcher status on startup"
    );
    assert(
      result.payload.status?.lastPollCompletedAt === null,
      "backend should not run a market poll before Start Watching"
    );

    let textResult = await requestText(baseUrl, "/viewer");
    assert(textResult.status === 200, "GET /viewer should return 200");
    assert(
      textResult.text.includes("<title>Torn Market Watcher Desktop Viewer</title>"),
      "/viewer should return the desktop viewer HTML shell"
    );
    assert(
      textResult.text.includes('href="/viewer/styles.css"') &&
        textResult.text.includes('src="/viewer/app.js"'),
      "/viewer should link to absolute viewer asset paths"
    );
    assert(
      textResult.text.includes("Loading viewer..."),
      "/viewer should include a visible loading shell"
    );

    textResult = await requestText(baseUrl, "/viewer/app.js");
    assert(textResult.status === 200, "GET /viewer/app.js should return 200");
    assert(
      textResult.text.includes("Desktop Viewer v1") ||
        textResult.text.includes("TornMarketDesktopViewer"),
      "/viewer/app.js should serve the desktop viewer client script"
    );

    textResult = await requestText(baseUrl, "/viewer/styles.css");
    assert(textResult.status === 200, "GET /viewer/styles.css should return 200");
    assert(
      textResult.text.includes(".status-grid"),
      "/viewer/styles.css should serve the desktop viewer stylesheet"
    );

    textResult = await requestText(baseUrl, "/viewer/health");
    assert(textResult.status === 200, "GET /viewer/health should return 200");
    assert(
      textResult.text.includes("Viewer Health") &&
        textResult.text.includes('src="/viewer/health.js"'),
      "/viewer/health should serve the health-page shell"
    );

    result = await requestJson(baseUrl, "/viewer/health.json");
    assert(result.status === 200, "GET /viewer/health.json should return 200");
    assert(result.payload?.ok === true, "/viewer/health.json should report ok");
    assert(
      result.payload?.viewer?.assets?.script === "/viewer/app.js",
      "/viewer/health.json should expose viewer asset paths"
    );

    result = await requestJson(baseUrl, "/api/slots");
    assert(result.status === 200, "GET /api/slots should return 200");
    assert(result.payload.ok === true, "GET /api/slots should return ok=true");
    assert(result.payload.slots.length === 6, "slot payload should always include 6 slots");
    assert(
      result.payload.versions?.backendVersion === config.backendVersion,
      "/api/slots should include backend version metadata"
    );
    assert(
      result.payload.slots.every((slot) => slot.occupied === false),
      "fresh API-check store should start with 6 empty slots"
    );

    result = await requestJson(baseUrl, "/api/refresh", {
      method: "POST",
      body: {}
    });
    assert(result.status === 409, "manual backend refresh should be blocked while watching is OFF");

    result = await requestJson(baseUrl, "/api/slot/2/watch", {
      method: "POST",
      body: {
        itemId: 372,
        targetPrice: 100,
        nearMissGap: 0,
        sourceMode: SOURCE_MODES.BAZAAR_ONLY,
        enabled: true
      }
    });
    assert(result.status === 201, "slot 2 add should return 201");
    assert(result.payload.slot.slotNumber === 2, "slot 2 add should stay in slot 2");
    assert(result.payload.slot.itemId === 372, "slot 2 should save Empty Box");
    assert(
      result.payload.slot.links.tornMarket.startsWith(config.tornMarketBaseUrl + "372"),
      "slot 2 market link should use the ItemMarket page route"
    );
    assert(
      result.payload.slot.sourceMode === SOURCE_MODES.BAZAAR_ONLY,
      "slot 2 should persist bazaar-only mode"
    );
    result = await requestJson(baseUrl, "/api/slots");
    assert(
      Array.isArray(result.payload.activityLog) &&
        result.payload.activityLog.some((entry) => entry.type === "item_added"),
      "activity log should record item adds"
    );

    result = await requestJson(baseUrl, "/api/slot/3/watch", {
      method: "POST",
      body: {
        itemName: "torn city times",
        targetPrice: 3300,
        nearMissGap: 150,
        sourceMode: SOURCE_MODES.MARKET_ONLY,
        enabled: true
      }
    });
    assert(result.status === 201, "slot 3 add should return 201");
    assert(result.payload.slot.slotNumber === 3, "slot 3 add should stay in slot 3");
    assert(result.payload.slot.itemId === 886, "slot 3 should resolve Torn City Times");
    assert(
      result.payload.slot.links.tornMarket.startsWith(config.tornMarketBaseUrl + "886"),
      "slot 3 market link should use the corrected ItemMarket route"
    );
    assert(
      result.payload.slot.sourceMode === SOURCE_MODES.MARKET_ONLY,
      "slot 3 should persist market-only mode"
    );

    result = await requestJson(baseUrl, "/api/slots");
    const slot2WhileStopped = result.payload.slots.find((slot) => slot.slotNumber === 2);
    const slot3WhileStopped = result.payload.slots.find((slot) => slot.slotNumber === 3);
    assert(slot2WhileStopped.trackerStatus === "IDLE", "slot 2 should be IDLE while watching is OFF");
    assert(slot3WhileStopped.trackerStatus === "IDLE", "slot 3 should be IDLE while watching is OFF");

    result = await requestJson(baseUrl, "/api/watching/start", {
      method: "POST",
      body: {}
    });
    assert(result.status === 200, "start watching should return 200");
    assert(
      result.payload.status?.watchingActive === true,
      "start watching should enable global watching"
    );

    result = await requestJson(baseUrl, "/api/refresh", {
      method: "POST",
      body: {}
    });
    assert(result.status === 200, "manual backend refresh should return 200");

    result = await requestJson(baseUrl, "/api/slots");
    const slot2AfterRefresh = result.payload.slots.find((slot) => slot.slotNumber === 2);
    const slot3AfterRefresh = result.payload.slots.find((slot) => slot.slotNumber === 3);
    assert(slot2AfterRefresh.trackerStatus === "WATCHING", "slot 2 should be WATCHING");
    assert(slot3AfterRefresh.trackerStatus === "WATCHING", "slot 3 should be WATCHING");
    assert(
      result.payload.session?.startedAt !== null,
      "starting watching should create a current watch session"
    );
    assert(
      Number(slot2AfterRefresh.sessionStats?.totalListingsFound) > 0,
      "session stats should accumulate listing observations while watching"
    );
    assert(
      slot2AfterRefresh.sourceMode === SOURCE_MODES.BAZAAR_ONLY &&
        slot2AfterRefresh.notification?.sourceMode === SOURCE_MODES.BAZAAR_ONLY,
      "bazaar-only slots should only alert from bazaar listings"
    );
    assert(
      slot3AfterRefresh.sourceMode === SOURCE_MODES.MARKET_ONLY &&
        slot3AfterRefresh.currentListings.every((listing) => listing.playerId === null),
      "market-only slots should only expose anonymous item market rows"
    );
    assert(
      Boolean(slot2AfterRefresh.notification?.eventId) &&
        Boolean(slot3AfterRefresh.notification?.eventId),
      "slot 2 and slot 3 should both keep independent alert memory and notifications"
    );
    assert(
      slot2AfterRefresh.notification?.listing?.playerName === "SellerOne",
      "slot 2 notification should keep seller details when the source provides them"
    );

    result = await requestJson(baseUrl, "/api/slot/2/listings?sourceMode=MARKET_ONLY");
    assert(result.status === 200, "slot listing detail view should return 200");
    assert(
      Array.isArray(result.payload?.listings) &&
        result.payload.sourceMode === SOURCE_MODES.MARKET_ONLY,
      "slot listing detail view should support on-demand market listings"
    );

    const initialSlot2EventId = slot2AfterRefresh.notification.eventId;

    result = await requestJson(baseUrl, "/api/refresh", {
      method: "POST",
      body: {}
    });
    assert(result.status === 200, "second manual backend refresh should return 200");

    result = await requestJson(baseUrl, "/api/slots");
    const slot2AfterDuplicateRefresh = result.payload.slots.find(
      (slot) => slot.slotNumber === 2
    );
    assert(
      slot2AfterDuplicateRefresh.notification?.eventId === initialSlot2EventId,
      "the same still-present low listing should not generate a new event every cycle"
    );
    assert(
      Array.isArray(slot2AfterDuplicateRefresh.alertState?.activeBuyNowListingKeys) &&
        slot2AfterDuplicateRefresh.alertState.activeBuyNowListingKeys.length > 0,
      "active buy-now listing memory should be retained while the listing is still present"
    );

    samples.bazaar[372] = bumpPrices(samples.bazaar[372], 20);

    result = await requestJson(baseUrl, "/api/refresh", {
      method: "POST",
      body: {}
    });
    assert(result.status === 200, "disappearance refresh should return 200");

    result = await requestJson(baseUrl, "/api/slots");
    const slot2AfterDisappearance = result.payload.slots.find((slot) => slot.slotNumber === 2);
    assert(
      slot2AfterDisappearance.state === "WAIT" &&
        slot2AfterDisappearance.alertState.activeBuyNowListingKeys.length === 0,
      "when the qualifying low listing disappears, it should be removed from active memory"
    );

    samples.bazaar[372] = parseMarketplacePayload({
      item_id: 372,
      item_name: "Empty Box",
      market_price: 99,
      bazaar_average: 101,
      total_listings: 2,
      listings: [
        {
          item_id: 372,
          player_id: 111111,
          player_name: "SellerOne",
          quantity: 2,
          price: 94,
          content_updated: 1776741873,
          last_checked: 1776741873,
          content_updated_relative: "4 minutes ago",
          last_checked_relative: "4 minutes ago"
        },
        {
          item_id: 372,
          player_id: 222222,
          player_name: "SellerTwo",
          quantity: 1,
          price: 110,
          content_updated: 1776741874,
          last_checked: 1776741874,
          content_updated_relative: "4 minutes ago",
          last_checked_relative: "4 minutes ago"
        }
      ]
    });

    result = await requestJson(baseUrl, "/api/refresh", {
      method: "POST",
      body: {}
    });
    assert(result.status === 200, "reappearance refresh should return 200");

    result = await requestJson(baseUrl, "/api/slots");
    const slot2AfterReappearance = result.payload.slots.find((slot) => slot.slotNumber === 2);
    assert(
      slot2AfterReappearance.notification?.eventId !== initialSlot2EventId &&
        slot2AfterReappearance.notification?.listing?.price === 94,
      "a newly seen qualifying listing should alert immediately after the old one disappeared"
    );

    result = await requestJson(baseUrl, "/api/slot/3/update", {
      method: "POST",
      body: {
        sourceMode: SOURCE_MODES.BAZAAR_ONLY
      }
    });
    assert(result.status === 200, "slot 3 source switch should return 200");
    assert(
      result.payload.slot.sourceMode === SOURCE_MODES.BAZAAR_ONLY,
      "slot 3 should switch cleanly from market-only to bazaar-only"
    );
    assert(
      Array.isArray(result.payload.slot.currentListings) &&
      result.payload.slot.currentListings[0]?.playerName === "SellerThree",
      "after switching to bazaar-only, slot 3 should show bazaar seller listings"
    );

    result = await requestJson(baseUrl, "/api/watching/stop", {
      method: "POST",
      body: {}
    });
    assert(result.status === 200, "stop watching should return 200");
    assert(
      result.payload.status?.watchingActive === false,
      "stop watching should disable global watching"
    );

    result = await requestJson(baseUrl, "/api/slots");
    const slot2AfterStop = result.payload.slots.find((slot) => slot.slotNumber === 2);
    const slot3AfterStop = result.payload.slots.find((slot) => slot.slotNumber === 3);
    assert(slot2AfterStop.trackerStatus === "IDLE", "slot 2 should return to IDLE after stop");
    assert(slot3AfterStop.trackerStatus === "IDLE", "slot 3 should return to IDLE after stop");
    assert(
      result.payload.session?.startedAt === null &&
        Number(result.payload.session?.slots?.["2"]?.totalAlerts || 0) === 0,
      "stopping watching should clear current-session watcher stats"
    );

    result = await requestJson(baseUrl, "/api/slot/3/update", {
      method: "POST",
      body: {
        sourceMode: SOURCE_MODES.MARKET_ONLY
      }
    });
    assert(result.status === 200, "slot 3 source switch back to market should return 200");
    assert(
      result.payload.slot.sourceMode === SOURCE_MODES.MARKET_ONLY,
      "slot 3 should switch cleanly from bazaar-only back to market-only"
    );
    assert(
      Array.isArray(result.payload.slot.currentListings) &&
        result.payload.slot.currentListings.every((listing) => listing.playerId === null),
      "after switching back to market-only, slot 3 should only show market rows"
    );

    result = await requestJson(baseUrl, "/api/backup/export");
    assert(result.status === 200, "backup export should return 200");
    assert(
      Array.isArray(result.payload.backup?.backend?.slots) &&
        result.payload.backup.backend.slots.length === 6,
      "backup export should include all six slots"
    );

    result = await requestJson(baseUrl, "/api/slot/2/update", {
      method: "POST",
      body: {
        targetPrice: 125,
        nearMissGap: 25,
        sourceMode: SOURCE_MODES.BAZAAR_ONLY,
        enabled: false
      }
    });
    assert(result.status === 200, "slot 2 edit should return 200");

    result = await requestJson(baseUrl, "/api/slots");
    const editedSlot2 = result.payload.slots.find((slot) => slot.slotNumber === 2);
    assert(editedSlot2.targetPrice === 125, "slot 2 target price should persist");
    assert(editedSlot2.nearMissGap === 25, "slot 2 near-miss gap should persist");
    assert(editedSlot2.enabled === false, "slot 2 enabled flag should persist");
    assert(editedSlot2.trackerStatus === "IDLE", "disabled slot 2 should show IDLE");

    result = await requestJson(baseUrl, "/api/slot/2/clear", {
      method: "POST",
      body: {}
    });
    assert(result.status === 200, "slot 2 clear should return 200");

    result = await requestJson(baseUrl, "/api/slots");
    const clearedSlot2 = result.payload.slots.find((slot) => slot.slotNumber === 2);
    assert(clearedSlot2.occupied === false, "slot 2 should be empty after clear");
    assert(clearedSlot2.trackerStatus === "EMPTY", "cleared slot 2 should show EMPTY");

    result = await requestJson(baseUrl, "/api/slot/2/watch", {
      method: "POST",
      body: {
        itemId: 372,
        targetPrice: 100,
        nearMissGap: 0,
        sourceMode: SOURCE_MODES.BAZAAR_ONLY,
        enabled: true
      }
    });
    assert(result.status === 201, "cleared slot 2 should be reusable");

    result = await requestJson(baseUrl, "/api/slot/4/watch", {
      method: "POST",
      body: {
        itemId: 372,
        targetPrice: 100,
        nearMissGap: 0,
        sourceMode: SOURCE_MODES.BAZAAR_ONLY,
        enabled: true
      }
    });
    assert(result.status === 409, "duplicate item add should return 409");
    assert(
      result.payload.error?.code === "duplicate_item",
      "duplicate item add should return duplicate_item"
    );

    result = await requestJson(baseUrl, "/api/slot/7/watch", {
      method: "POST",
      body: {
        itemId: 819,
        targetPrice: 100,
        nearMissGap: 0,
        sourceMode: SOURCE_MODES.MARKET_ONLY,
        enabled: true
      }
    });
    assert(result.status === 400, "invalid slot number should return 400");
    assert(
      result.payload.error?.code === "invalid_slot_number",
      "invalid slot number should return invalid_slot_number"
    );

    result = await requestJson(baseUrl, "/api/slots/reset", {
      method: "POST",
      body: {}
    });
    assert(result.status === 200, "reset all slots should return 200");
    result = await requestJson(baseUrl, "/api/slots");
    assert(
      result.payload.slots.every((slot) => slot.occupied === false),
      "reset all should clear all six slots before import"
    );

    result = await requestJson(baseUrl, "/api/backup/import", {
      method: "POST",
      body: {
        backup: {
          settings: {
            alertCooldownMs: 45000,
            snapshotGroupingWindowMs: 15000
          },
          slots: [
            {
              slotNumber: 1,
              occupied: true,
              enabled: true,
              sourceMode: SOURCE_MODES.MARKET_ONLY,
              itemId: 372,
              targetPrice: 120,
              nearMissGap: 10
            },
            {
              slotNumber: 2,
              occupied: false
            }
          ]
        }
      }
    });
    assert(result.status === 200, "backup import should return 200");
    const importedSlot1 = result.payload.slots.find((slot) => slot.slotNumber === 1);
    assert(importedSlot1.itemId === 372, "backup import should restore slot 1 item");
    assert(
      result.payload.settings.alertCooldownMs === 45000,
      "backup import should restore alert cooldown"
    );
    assert(
      Array.isArray(result.payload.activityLog) &&
        result.payload.activityLog.some((entry) => entry.type === "backup_imported"),
      "activity log should record backup imports"
    );

    result = await requestJson(baseUrl, "/api/slots");
    assert(
      result.payload.slots.some((slot) => slot.slotNumber === 1 && slot.occupied === true),
      "backup import should remain visible in the canonical slot payload"
    );

    console.log("API check passed.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
