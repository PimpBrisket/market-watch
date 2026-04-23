const {
  SOURCE_MODES,
  normalizeSourceMode,
  sourceModeLabel,
  sourceTypeFromMode
} = require("../utils/sourceModes");

const ITEM_MARKET_ACTION_NAME = "getItemMarket";

function toInteger(value, fieldName) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid integer for ${fieldName}`);
  }

  return parsed;
}

function buildBazaarUrl(itemId, playerId) {
  if (!Number.isFinite(Number(itemId)) || !Number.isFinite(Number(playerId))) {
    return null;
  }

  return `https://www.torn.com/bazaar.php?userId=${playerId}&highlightItem=${itemId}#/`;
}

function buildBazaarListing(index, listing) {
  return {
    itemId: toInteger(listing.item_id, `listings[${index}].item_id`),
    playerId: toInteger(listing.player_id, `listings[${index}].player_id`),
    playerName: String(listing.player_name ?? "").trim(),
    quantity: toInteger(listing.quantity, `listings[${index}].quantity`),
    price: toInteger(listing.price, `listings[${index}].price`),
    contentUpdated: toInteger(listing.content_updated, `listings[${index}].content_updated`),
    lastChecked: toInteger(listing.last_checked, `listings[${index}].last_checked`),
    contentUpdatedRelative: String(listing.content_updated_relative ?? ""),
    lastCheckedRelative: String(listing.last_checked_relative ?? ""),
    position: index + 1,
    occurrenceIndex: 1
  };
}

function parseMarketplacePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("expected Weav3r marketplace payload to be an object");
  }

  if (!Array.isArray(payload.listings)) {
    throw new Error("expected Weav3r marketplace payload to include listings[]");
  }

  const itemId = toInteger(payload.item_id, "item_id");
  const itemName = String(payload.item_name ?? "").trim();

  if (!itemName) {
    throw new Error("expected item_name to be present in Weav3r payload");
  }

  const listings = payload.listings.map((listing, index) => buildBazaarListing(index, listing));

  return {
    sourceMode: SOURCE_MODES.BAZAAR_ONLY,
    sourceLabel: sourceModeLabel(SOURCE_MODES.BAZAAR_ONLY),
    sourceType: sourceTypeFromMode(SOURCE_MODES.BAZAAR_ONLY),
    itemId,
    itemName,
    marketPrice:
      payload.market_price === null ? null : toInteger(payload.market_price, "market_price"),
    bazaarAverage:
      payload.bazaar_average === null
        ? null
        : toInteger(payload.bazaar_average, "bazaar_average"),
    totalListings:
      payload.total_listings === null
        ? listings.length
        : toInteger(payload.total_listings, "total_listings"),
    fetchedListings: listings.length,
    hasMoreListings:
      payload.total_listings === null
        ? false
        : toInteger(payload.total_listings, "total_listings") > listings.length,
    totalItems: listings.reduce((sum, listing) => sum + listing.quantity, 0),
    totalValue: listings.reduce((sum, listing) => sum + listing.quantity * listing.price, 0),
    cacheTimestamp: null,
    fromCache: false,
    listings: listings.map((listing) => ({
      ...listing,
      sourceMode: SOURCE_MODES.BAZAAR_ONLY,
      sourceLabel: sourceModeLabel(SOURCE_MODES.BAZAAR_ONLY),
      sourceType: sourceTypeFromMode(SOURCE_MODES.BAZAAR_ONLY),
      listingId: null,
      bazaarUrl: buildBazaarUrl(itemId, listing.playerId)
    }))
  };
}

function parseServerActionPayload(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let latestError = null;

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");

    if (separatorIndex <= 0) {
      continue;
    }

    const payload = line.slice(separatorIndex + 1);

    if (payload.startsWith("E")) {
      latestError = payload;
      continue;
    }

    try {
      const parsed = JSON.parse(payload);

      if (parsed && typeof parsed === "object" && "success" in parsed) {
        return parsed;
      }
    } catch (error) {
      continue;
    }
  }

  if (latestError) {
    throw new Error(`Weav3r server action failed: ${latestError}`);
  }

  throw new Error("could not parse Weav3r server action response");
}

function parseItemMarketPayload(payload, requestedItemId) {
  if (!payload || typeof payload !== "object") {
    throw new Error("expected Weav3r item market payload to be an object");
  }

  if (payload.success !== true || !payload.data) {
    throw new Error(payload.error || "Weav3r item market action returned no data");
  }

  const item = payload.data.item || {};
  const itemId = toInteger(item.id ?? requestedItemId, "item.id");
  const itemName = String(item.name ?? "").trim();

  if (!itemName) {
    throw new Error("expected item market item name to be present");
  }

  if (!Array.isArray(payload.data.listings)) {
    throw new Error("expected item market listings[] to be present");
  }

  const occurrenceMap = new Map();
  const listings = payload.data.listings.map((listing, index) => {
    const price = toInteger(listing.price, `listings[${index}].price`);
    const quantity = toInteger(listing.amount, `listings[${index}].amount`);
    const occurrenceKey = `${price}:${quantity}`;
    const occurrenceIndex = (occurrenceMap.get(occurrenceKey) || 0) + 1;
    occurrenceMap.set(occurrenceKey, occurrenceIndex);

    return {
      itemId,
      playerId: null,
      playerName: "",
      quantity,
      price,
      contentUpdated:
        payload.data.cacheTimestamp === null || payload.data.cacheTimestamp === undefined
          ? null
          : toInteger(payload.data.cacheTimestamp, "cacheTimestamp"),
      lastChecked:
        payload.data.cacheTimestamp === null || payload.data.cacheTimestamp === undefined
          ? null
          : toInteger(payload.data.cacheTimestamp, "cacheTimestamp"),
      contentUpdatedRelative: "",
      lastCheckedRelative: "",
      position: index + 1,
      occurrenceIndex,
      sourceMode: SOURCE_MODES.MARKET_ONLY,
      sourceLabel: sourceModeLabel(SOURCE_MODES.MARKET_ONLY),
      sourceType: sourceTypeFromMode(SOURCE_MODES.MARKET_ONLY),
      listingId: `market:${itemId}:${price}:${quantity}:${occurrenceIndex}`,
      bazaarUrl: null
    };
  });

  return {
    sourceMode: SOURCE_MODES.MARKET_ONLY,
    sourceLabel: sourceModeLabel(SOURCE_MODES.MARKET_ONLY),
    sourceType: sourceTypeFromMode(SOURCE_MODES.MARKET_ONLY),
    itemId,
    itemName,
    marketPrice:
      item.average_price === null || item.average_price === undefined
        ? null
        : toInteger(item.average_price, "item.average_price"),
    bazaarAverage: null,
    totalListings: listings.length,
    fetchedListings: listings.length,
    hasMoreListings: false,
    totalItems:
      payload.data.totalItems === null || payload.data.totalItems === undefined
        ? listings.reduce((sum, listing) => sum + listing.quantity, 0)
        : toInteger(payload.data.totalItems, "totalItems"),
    totalValue:
      payload.data.totalValue === null || payload.data.totalValue === undefined
        ? listings.reduce((sum, listing) => sum + listing.quantity * listing.price, 0)
        : toInteger(payload.data.totalValue, "totalValue"),
    cacheTimestamp:
      payload.data.cacheTimestamp === null || payload.data.cacheTimestamp === undefined
        ? null
        : toInteger(payload.data.cacheTimestamp, "cacheTimestamp"),
    fromCache: Boolean(payload.fromCache),
    listings
  };
}

class Weav3rClient {
  constructor({ baseUrl, requestTimeoutMs }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.requestTimeoutMs = requestTimeoutMs;
    this.cachedActionIds = new Map();
  }

  async fetchSnapshot(itemId, sourceMode) {
    const normalizedSourceMode = normalizeSourceMode(sourceMode);

    if (normalizedSourceMode === SOURCE_MODES.BAZAAR_ONLY) {
      return this.fetchBazaarSnapshot(itemId);
    }

    return this.fetchItemMarketSnapshot(itemId);
  }

  async fetchBazaarSnapshot(itemId) {
    const payload = await this.fetchJson(`${this.baseUrl}/api/marketplace/${itemId}`);
    return parseMarketplacePayload(payload);
  }

  async fetchItemMarketSnapshot(itemId) {
    const actionId = await this.getServerActionId(itemId, ITEM_MARKET_ACTION_NAME);

    try {
      return await this.fetchItemMarketSnapshotWithAction(itemId, actionId);
    } catch (error) {
      this.cachedActionIds.delete(ITEM_MARKET_ACTION_NAME);

      if (!/server action/i.test(error.message)) {
        throw error;
      }

      const refreshedActionId = await this.getServerActionId(
        itemId,
        ITEM_MARKET_ACTION_NAME,
        true
      );
      return this.fetchItemMarketSnapshotWithAction(itemId, refreshedActionId);
    }
  }

  async fetchItemMarketSnapshotWithAction(itemId, actionId) {
    const text = await this.fetchText(`${this.baseUrl}/item/${itemId}?tab=itemmarket`, {
      method: "POST",
      headers: {
        accept: "text/x-component, text/html, application/xhtml+xml",
        origin: this.baseUrl,
        "next-action": actionId,
        "content-type": "text/plain;charset=UTF-8"
      },
      body: JSON.stringify([Number(itemId)])
    });

    const payload = parseServerActionPayload(text);
    return parseItemMarketPayload(payload, itemId);
  }

  async getServerActionId(itemId, actionName, forceRefresh = false) {
    if (!forceRefresh && this.cachedActionIds.has(actionName)) {
      return this.cachedActionIds.get(actionName);
    }

    const html = await this.fetchText(`${this.baseUrl}/item/${itemId}?tab=itemmarket`);
    const chunkPaths = [
      ...new Set(
        [...html.matchAll(/(?:https:\/\/weav3r\.dev)?(\/_next\/static\/chunks\/[^"']+\.js)/g)].map(
          (match) => match[1]
        )
      )
    ];

    for (const chunkPath of chunkPaths) {
      const chunkSource = await this.fetchText(`${this.baseUrl}${chunkPath}`);
      const pattern = new RegExp(
        `createServerReference\\)\\("([^"]+)",h\\.callServer,void 0,h\\.findSourceMapURL,"${actionName}"\\)`
      );
      const match = chunkSource.match(pattern);

      if (match) {
        this.cachedActionIds.set(actionName, match[1]);
        return match[1];
      }
    }

    throw new Error(`could not discover Weav3r server action ${actionName}`);
  }

  async fetchJson(url, options = {}) {
    const response = await this.fetchWithTimeout(url, {
      ...options,
      headers: {
        accept: "application/json",
        "user-agent": "TornPDA-Market-Watcher/1.0",
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(`Weav3r request failed with HTTP ${response.status}`);
    }

    return response.json();
  }

  async fetchText(url, options = {}) {
    const response = await this.fetchWithTimeout(url, {
      ...options,
      headers: {
        "user-agent": "TornPDA-Market-Watcher/1.0",
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(`Weav3r request failed with HTTP ${response.status}`);
    }

    return response.text();
  }

  async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`Weav3r request timed out after ${this.requestTimeoutMs}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  Weav3rClient,
  parseMarketplacePayload,
  parseItemMarketPayload,
  parseServerActionPayload
};
