const { createAlertState, buildListingKey } = require("./alertStateManager");
const {
  SOURCE_MODES,
  normalizeSourceMode,
  sourceModeLabel
} = require("../utils/sourceModes");

function appendBounded(list, value, limit) {
  if (value === null || value === undefined) {
    return [...(list || [])];
  }

  const next = [...(list || []), value];
  return next.slice(Math.max(0, next.length - limit));
}

function appendEvent(existingEvents, event, limit) {
  const next = [...(existingEvents || []), event];
  return next.slice(Math.max(0, next.length - limit));
}

function deriveTrendDirection(lastSeenPrices) {
  if (!lastSeenPrices || lastSeenPrices.length < 2) {
    return "UNKNOWN";
  }

  const previous = lastSeenPrices[lastSeenPrices.length - 2];
  const latest = lastSeenPrices[lastSeenPrices.length - 1];

  if (latest < previous) {
    return "DOWN";
  }

  if (latest > previous) {
    return "UP";
  }

  return "FLAT";
}

function normalizeListings(listings) {
  return [...listings]
    .filter((listing) => Number.isFinite(listing.price) && listing.quantity > 0)
    .sort(
      (left, right) =>
        left.price - right.price ||
        (left.playerId ?? Number.MAX_SAFE_INTEGER) -
          (right.playerId ?? Number.MAX_SAFE_INTEGER) ||
        (left.position ?? 0) - (right.position ?? 0) ||
        (left.occurrenceIndex ?? 0) - (right.occurrenceIndex ?? 0)
    );
}

function buildListingSummary(listing) {
  if (!listing) {
    return null;
  }

  const listingKey = buildListingKey(listing);

  return {
    listingKey,
    sourceMode: listing.sourceMode || SOURCE_MODES.MARKET_ONLY,
    sourceLabel: listing.sourceLabel || sourceModeLabel(listing.sourceMode),
    sourceType: listing.sourceType || "item_market",
    itemId: listing.itemId,
    listingId: listing.listingId ?? null,
    playerId: listing.playerId,
    playerName: listing.playerName,
    quantity: listing.quantity,
    price: listing.price,
    lastChecked: listing.lastChecked,
    contentUpdated: listing.contentUpdated,
    position: listing.position ?? null,
    occurrenceIndex: listing.occurrenceIndex ?? null,
    bazaarUrl: listing.bazaarUrl || null
  };
}

function evaluateWatch({ watch, snapshot, previousResult, nowIso, config }) {
  const sourceMode = normalizeSourceMode(watch.sourceMode, SOURCE_MODES.MARKET_ONLY);
  const sourceLabel = sourceModeLabel(sourceMode);
  const sortedListings = normalizeListings(snapshot.listings);
  const lowestListing = sortedListings[0] || null;
  const lowestAtOrBelowTarget =
    sortedListings.find((listing) => listing.price <= watch.targetPrice) || null;
  const lowestAboveTarget =
    sortedListings.find((listing) => listing.price > watch.targetPrice) || null;
  const lowestPrice = lowestListing ? lowestListing.price : null;
  const differenceFromTarget =
    lowestPrice === null ? null : lowestPrice - watch.targetPrice;
  const differenceAboveTarget = lowestAboveTarget
    ? lowestAboveTarget.price - watch.targetPrice
    : null;
  const buyNow = lowestPrice !== null && lowestPrice <= watch.targetPrice;
  const nearMissEnabled = watch.nearMissGap > 0;
  const nearMiss =
    nearMissEnabled &&
    lowestAboveTarget !== null &&
    differenceAboveTarget !== null &&
    differenceAboveTarget <= watch.nearMissGap;
  const state = buyNow ? "BUY_NOW" : nearMiss ? "NEAR_MISS" : "WAIT";
  const previousHistory = previousResult?.history || {};
  const lastSeenPrices = appendBounded(
    previousHistory.lastSeenPrices,
    lowestPrice,
    config.historyPointsLimit
  );
  const lowestSeenPrice =
    previousHistory.lowestSeenPrice === undefined ||
    previousHistory.lowestSeenPrice === null
      ? lowestPrice
      : lowestPrice === null
        ? previousHistory.lowestSeenPrice
        : Math.min(previousHistory.lowestSeenPrice, lowestPrice);
  const trendDirection = deriveTrendDirection(lastSeenPrices);
  const previousState = previousResult?.state || "WAIT";
  const qualifyingListings = sortedListings
    .filter((listing) => listing.price <= watch.targetPrice)
    .map((listing) => buildListingSummary(listing));

  let eventLog = previousHistory.eventLog || [];

  if (previousState !== state) {
    eventLog = appendEvent(
      eventLog,
      {
        timestamp: nowIso,
        kind: "state_change",
        from: previousState,
        to: state,
        lowestPrice
      },
      config.eventLogLimit
    );
  }

  const result = {
    slotNumber: watch.slotNumber,
    occupied: true,
    sourceMode,
    sourceLabel,
    itemId: watch.itemId,
    itemName: watch.itemName || snapshot.itemName,
    targetPrice: watch.targetPrice,
    nearMissGap: watch.nearMissGap,
    nearMissEnabled,
    enabled: watch.enabled,
    lowestPrice,
    lowestAtOrBelowTarget: lowestAtOrBelowTarget
      ? lowestAtOrBelowTarget.price
      : null,
    lowestAboveTarget: lowestAboveTarget ? lowestAboveTarget.price : null,
    differenceFromTarget,
    differenceAboveTarget,
    state,
    currentState: state,
    buyNow,
    nearMiss,
    lastChecked: nowIso,
    lastAttemptedAt: nowIso,
    stale: false,
    staleReason: null,
    lastError: null,
    market: {
      source: "weav3r",
      sourceMode,
      sourceLabel,
      sourceType: snapshot.sourceType,
      marketPrice: snapshot.marketPrice,
      bazaarAverage: snapshot.bazaarAverage,
      totalListings: snapshot.totalListings,
      fetchedListings: snapshot.fetchedListings ?? sortedListings.length,
      hasMoreListings: Boolean(snapshot.hasMoreListings),
      totalItems: snapshot.totalItems ?? null,
      totalValue: snapshot.totalValue ?? null,
      cacheTimestamp: snapshot.cacheTimestamp ?? null,
      fromCache: Boolean(snapshot.fromCache)
    },
    currentListings: sortedListings.map((listing) => buildListingSummary(listing)),
    qualifyingListings,
    cheapestListing: buildListingSummary(lowestListing),
    cheapestAtOrBelowTarget: buildListingSummary(lowestAtOrBelowTarget),
    cheapestAboveTarget: buildListingSummary(lowestAboveTarget),
    history: {
      lastSeenPrices,
      lowestSeenPrice,
      trendDirection,
      eventLog
    }
  };

  const alertState = createAlertState({
    result,
    previousResult,
    nowIso,
    cooldownMs: config.alertCooldownMs,
    groupingWindowMs: config.snapshotGroupingWindowMs,
    improvementAmount: config.alertImprovementAmount
  });

  if (alertState.shouldNotify && alertState.latestEvent) {
    result.history.eventLog = appendEvent(
      result.history.eventLog,
      {
        timestamp: alertState.latestEvent.timestamp,
        kind: "alert",
        type: alertState.latestEvent.type,
        reason: alertState.latestEvent.reason,
        price: alertState.latestEvent.price,
        listingKey: alertState.latestEvent.listingKey || null,
        sellerName: alertState.latestEvent.sellerName || null
      },
      config.eventLogLimit
    );
  }

  result.alertState = alertState;
  return result;
}

function buildStaleResult({ watch, previousResult, errorMessage, nowIso, config }) {
  const previousHistory = previousResult?.history || {};
  const lastAlertState = previousResult?.alertState || {};
  const sourceMode = normalizeSourceMode(
    watch.sourceMode ?? previousResult?.sourceMode,
    SOURCE_MODES.MARKET_ONLY
  );
  const eventLog = appendEvent(
    previousHistory.eventLog,
    {
      timestamp: nowIso,
      kind: "fetch_failure",
      message: errorMessage
    },
    config.eventLogLimit
  );

  return {
    slotNumber: watch.slotNumber,
    occupied: true,
    sourceMode,
    sourceLabel: sourceModeLabel(sourceMode),
    itemId: watch.itemId,
    itemName: watch.itemName,
    targetPrice: watch.targetPrice,
    nearMissGap: watch.nearMissGap,
    nearMissEnabled: watch.nearMissGap > 0,
    enabled: watch.enabled,
    lowestPrice: previousResult?.lowestPrice ?? null,
    lowestAtOrBelowTarget: previousResult?.lowestAtOrBelowTarget ?? null,
    lowestAboveTarget: previousResult?.lowestAboveTarget ?? null,
    differenceFromTarget: previousResult?.differenceFromTarget ?? null,
    differenceAboveTarget: previousResult?.differenceAboveTarget ?? null,
    state: previousResult?.state ?? "WAIT",
    currentState: previousResult?.state ?? "WAIT",
    buyNow: previousResult?.buyNow ?? false,
    nearMiss: previousResult?.nearMiss ?? false,
    lastChecked: previousResult?.lastChecked ?? null,
    lastAttemptedAt: nowIso,
    stale: true,
    staleReason: "fetch_failed",
    lastError: errorMessage,
    market: previousResult?.market || {
      source: "weav3r",
      sourceMode,
      sourceLabel: sourceModeLabel(sourceMode),
      sourceType: sourceMode === SOURCE_MODES.BAZAAR_ONLY ? "bazaar" : "item_market",
      marketPrice: null,
      bazaarAverage: null,
      totalListings: 0,
      fetchedListings: 0,
      hasMoreListings: false,
      totalItems: null,
      totalValue: null,
      cacheTimestamp: null,
      fromCache: false
    },
    currentListings: previousResult?.currentListings || [],
    qualifyingListings: previousResult?.qualifyingListings || [],
    cheapestListing: previousResult?.cheapestListing ?? null,
    cheapestAtOrBelowTarget: previousResult?.cheapestAtOrBelowTarget ?? null,
    cheapestAboveTarget: previousResult?.cheapestAboveTarget ?? null,
    history: {
      lastSeenPrices: previousHistory.lastSeenPrices || [],
      lowestSeenPrice: previousHistory.lowestSeenPrice ?? null,
      trendDirection: previousHistory.trendDirection || "UNKNOWN",
      eventLog
    },
    alertState: {
      buyNowFired: false,
      nearMissFired: false,
      lastAlertedAt: lastAlertState.lastAlertedAt ?? null,
      lastAlertType: lastAlertState.lastAlertType ?? null,
      lastAlertReason: lastAlertState.lastAlertReason ?? null,
      lastObservedState:
        lastAlertState.lastObservedState ?? previousResult?.state ?? "WAIT",
      lastObservedPrice:
        lastAlertState.lastObservedPrice ?? previousResult?.lowestPrice ?? null,
      cooldownMs: config.alertCooldownMs,
      groupingWindowMs: config.snapshotGroupingWindowMs,
      improvementAmount: config.alertImprovementAmount,
      activeBuyNowListings: lastAlertState.activeBuyNowListings || [],
      activeBuyNowListingKeys: lastAlertState.activeBuyNowListingKeys || [],
      pendingGroup: lastAlertState.pendingGroup ?? null,
      latestEvent: lastAlertState.latestEvent ?? null,
      shouldNotify: false
    }
  };
}

function buildIdleResult({ watch, previousResult, config }) {
  const previousHistory = previousResult?.history || {};
  const lastAlertState = previousResult?.alertState || {};
  const sourceMode = normalizeSourceMode(
    watch.sourceMode ?? previousResult?.sourceMode,
    SOURCE_MODES.MARKET_ONLY
  );

  return {
    slotNumber: watch.slotNumber,
    occupied: true,
    sourceMode,
    sourceLabel: sourceModeLabel(sourceMode),
    itemId: watch.itemId,
    itemName: watch.itemName,
    targetPrice: watch.targetPrice,
    nearMissGap: watch.nearMissGap,
    nearMissEnabled: watch.nearMissGap > 0,
    enabled: watch.enabled,
    lowestPrice: previousResult?.lowestPrice ?? null,
    lowestAtOrBelowTarget: previousResult?.lowestAtOrBelowTarget ?? null,
    lowestAboveTarget: previousResult?.lowestAboveTarget ?? null,
    differenceFromTarget: previousResult?.differenceFromTarget ?? null,
    differenceAboveTarget: previousResult?.differenceAboveTarget ?? null,
    state: "WAIT",
    currentState: "WAIT",
    buyNow: false,
    nearMiss: false,
    lastChecked: previousResult?.lastChecked ?? null,
    lastAttemptedAt: previousResult?.lastAttemptedAt ?? null,
    stale: watch.enabled ? previousResult?.stale ?? false : false,
    staleReason: watch.enabled ? previousResult?.staleReason ?? null : null,
    lastError: watch.enabled ? previousResult?.lastError ?? null : null,
    market: previousResult?.market || {
      source: "weav3r",
      sourceMode,
      sourceLabel: sourceModeLabel(sourceMode),
      sourceType: sourceMode === SOURCE_MODES.BAZAAR_ONLY ? "bazaar" : "item_market",
      marketPrice: null,
      bazaarAverage: null,
      totalListings: 0,
      fetchedListings: 0,
      hasMoreListings: false,
      totalItems: null,
      totalValue: null,
      cacheTimestamp: null,
      fromCache: false
    },
    currentListings: previousResult?.currentListings || [],
    qualifyingListings: [],
    cheapestListing: previousResult?.cheapestListing ?? null,
    cheapestAtOrBelowTarget: previousResult?.cheapestAtOrBelowTarget ?? null,
    cheapestAboveTarget: previousResult?.cheapestAboveTarget ?? null,
    history: {
      lastSeenPrices: previousHistory.lastSeenPrices || [],
      lowestSeenPrice: previousHistory.lowestSeenPrice ?? null,
      trendDirection: previousHistory.trendDirection || "UNKNOWN",
      eventLog: previousHistory.eventLog || []
    },
    alertState: {
      buyNowFired: false,
      nearMissFired: false,
      lastAlertedAt: lastAlertState.lastAlertedAt ?? null,
      lastAlertType: lastAlertState.lastAlertType ?? null,
      lastAlertReason: lastAlertState.lastAlertReason ?? null,
      lastObservedState: "WAIT",
      lastObservedPrice: null,
      cooldownMs: config.alertCooldownMs,
      groupingWindowMs: config.snapshotGroupingWindowMs,
      improvementAmount: config.alertImprovementAmount,
      activeBuyNowListings: [],
      activeBuyNowListingKeys: [],
      pendingGroup: null,
      latestEvent: null,
      shouldNotify: false
    }
  };
}

function buildEmptySlotResult({ slot }) {
  return {
    slotNumber: slot.slotNumber,
    occupied: false,
    enabled: false,
    sourceMode: normalizeSourceMode(slot.sourceMode, SOURCE_MODES.MARKET_ONLY),
    sourceLabel: sourceModeLabel(slot.sourceMode),
    itemId: null,
    itemName: null,
    targetPrice: null,
    nearMissGap: null,
    nearMissEnabled: false,
    lowestPrice: null,
    lowestAtOrBelowTarget: null,
    lowestAboveTarget: null,
    differenceFromTarget: null,
    differenceAboveTarget: null,
    state: "EMPTY",
    currentState: "EMPTY",
    buyNow: false,
    nearMiss: false,
    lastChecked: null,
    lastAttemptedAt: null,
    stale: false,
    staleReason: null,
    lastError: null,
    market: {
      source: "weav3r",
      sourceMode: normalizeSourceMode(slot.sourceMode, SOURCE_MODES.MARKET_ONLY),
      sourceLabel: sourceModeLabel(slot.sourceMode),
      sourceType:
        normalizeSourceMode(slot.sourceMode, SOURCE_MODES.MARKET_ONLY) ===
        SOURCE_MODES.BAZAAR_ONLY
          ? "bazaar"
          : "item_market",
      marketPrice: null,
      bazaarAverage: null,
      totalListings: 0,
      fetchedListings: 0,
      hasMoreListings: false,
      totalItems: null,
      totalValue: null,
      cacheTimestamp: null,
      fromCache: false
    },
    currentListings: [],
    qualifyingListings: [],
    cheapestListing: null,
    cheapestAtOrBelowTarget: null,
    cheapestAboveTarget: null,
    history: {
      lastSeenPrices: [],
      lowestSeenPrice: null,
      trendDirection: "UNKNOWN",
      eventLog: []
    },
    alertState: {
      buyNowFired: false,
      nearMissFired: false,
      lastAlertedAt: null,
      lastAlertType: null,
      lastAlertReason: null,
      lastObservedState: "EMPTY",
      lastObservedPrice: null,
      cooldownMs: null,
      groupingWindowMs: null,
      improvementAmount: null,
      activeBuyNowListings: [],
      activeBuyNowListingKeys: [],
      pendingGroup: null,
      latestEvent: null,
      shouldNotify: false
    }
  };
}

module.exports = {
  evaluateWatch,
  buildStaleResult,
  buildIdleResult,
  buildEmptySlotResult
};
