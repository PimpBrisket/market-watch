function buildListingKey(listing) {
  if (!listing) {
    return null;
  }

  const sourceType = listing.sourceType || "item_market";

  if (listing.listingId) {
    return [sourceType, listing.itemId ?? "unknown-item", listing.listingId].join(":");
  }

  return [
    sourceType,
    listing.itemId ?? "unknown-item",
    listing.playerId ?? "unknown",
    listing.price ?? "na",
    listing.quantity ?? "na",
    listing.contentUpdated ?? "na",
    listing.occurrenceIndex ?? "na"
  ].join(":");
}

function buildPrimaryAlert(result) {
  if (result.state === "BUY_NOW" && result.cheapestAtOrBelowTarget) {
    return {
      type: "BUY_NOW",
      price: result.lowestPrice,
      listing: result.cheapestAtOrBelowTarget,
      listingKey: buildListingKey(result.cheapestAtOrBelowTarget)
    };
  }

  if (result.state === "NEAR_MISS" && result.cheapestAboveTarget) {
    return {
      type: "NEAR_MISS",
      price: result.lowestAboveTarget,
      listing: result.cheapestAboveTarget,
      listingKey: buildListingKey(result.cheapestAboveTarget)
    };
  }

  return null;
}

function normalizeActiveListings(listings) {
  if (!Array.isArray(listings)) {
    return [];
  }

  const seenKeys = new Set();

  return listings.reduce((accumulator, listing) => {
    const listingKey = buildListingKey(listing);

    if (!listing || !listingKey || seenKeys.has(listingKey)) {
      return accumulator;
    }

    seenKeys.add(listingKey);
    accumulator.push({
      ...listing,
      listingKey
    });
    return accumulator;
  }, []);
}

function mapListingsByKey(listings) {
  return normalizeActiveListings(listings).reduce((accumulator, listing) => {
    accumulator[listing.listingKey] = listing;
    return accumulator;
  }, {});
}

function createPendingGroup({ currentPrimary, nowIso, reason, groupingWindowMs }) {
  return {
    type: currentPrimary.type,
    triggerReason: reason,
    startedAt: nowIso,
    windowEndsAt: new Date(Date.parse(nowIso) + groupingWindowMs).toISOString(),
    latestObservedAt: nowIso,
    latestPrice: currentPrimary.price,
    latestListingKey: currentPrimary.listingKey,
    latestListing: currentPrimary.listing,
    snapshotsObserved: 1
  };
}

function shouldStartGrouping({
  currentPrimary,
  previousPrimaryState,
  previousPrimaryPrice,
  lastAlertedAtMs,
  nowIso,
  cooldownMs,
  improvementAmount
}) {
  if (!currentPrimary) {
    return null;
  }

  const sameState = previousPrimaryState === currentPrimary.type;
  const becameActive = previousPrimaryState === "WAIT";
  const upgraded =
    previousPrimaryState === "NEAR_MISS" && currentPrimary.type === "BUY_NOW";
  const improved =
    sameState &&
    previousPrimaryPrice !== null &&
    currentPrimary.price !== null &&
    previousPrimaryPrice - currentPrimary.price >= improvementAmount;
  const cooldownExpired =
    sameState &&
    lastAlertedAtMs !== null &&
    Date.parse(nowIso) - lastAlertedAtMs >= cooldownMs;

  if (becameActive) {
    return "became_active";
  }

  if (upgraded) {
    return "upgraded_to_buy_now";
  }

  if (improved) {
    return "price_improved";
  }

  if (cooldownExpired) {
    return "cooldown_elapsed";
  }

  return null;
}

function createImmediateListingEvent({ result, nowIso, listings }) {
  const normalizedListings = normalizeActiveListings(listings);
  const primaryListing = normalizedListings[0] || null;

  if (!primaryListing) {
    return null;
  }

  return {
    eventId: `${result.itemId}-${primaryListing.listingKey}-${Date.parse(nowIso)}`,
    type: "BUY_NOW",
    reason: "new_listing_seen",
    sourceMode: result.sourceMode,
    sourceLabel: result.sourceLabel,
    price: primaryListing.price,
    listingKey: primaryListing.listingKey,
    listing: primaryListing,
    listings: normalizedListings,
    listingCount: normalizedListings.length,
    sellerName: primaryListing.playerName || null,
    sellerId: primaryListing.playerId ?? null,
    timestamp: nowIso
  };
}

function createAlertState({
  result,
  previousResult,
  nowIso,
  cooldownMs,
  groupingWindowMs,
  improvementAmount
}) {
  const previousAlertState = previousResult?.alertState || {};
  const previousPrimaryState = previousAlertState.lastObservedState || "WAIT";
  const previousPrimaryPrice = previousAlertState.lastObservedPrice ?? null;
  const lastAlertedAtMs = previousAlertState.lastAlertedAt
    ? Date.parse(previousAlertState.lastAlertedAt)
    : null;
  const currentPrimary = buildPrimaryAlert(result);
  const previousActiveListingMap = mapListingsByKey(previousAlertState.activeBuyNowListings);
  const currentActiveBuyNowListings =
    result.state === "BUY_NOW" ? normalizeActiveListings(result.qualifyingListings) : [];
  const newBuyNowListings = currentActiveBuyNowListings.filter(
    (listing) => !previousActiveListingMap[listing.listingKey]
  );

  let latestEvent = previousAlertState.latestEvent || null;
  let lastAlertedAt = previousAlertState.lastAlertedAt || null;
  let lastAlertType = previousAlertState.lastAlertType || null;
  let lastAlertReason = previousAlertState.lastAlertReason || null;
  let shouldNotify = false;
  let pendingGroup =
    previousAlertState.pendingGroup?.type === "NEAR_MISS"
      ? previousAlertState.pendingGroup
      : null;

  if (newBuyNowListings.length > 0) {
    latestEvent = createImmediateListingEvent({
      result,
      nowIso,
      listings: currentActiveBuyNowListings
    });
    lastAlertedAt = latestEvent.timestamp;
    lastAlertType = latestEvent.type;
    lastAlertReason = latestEvent.reason;
    shouldNotify = true;
    pendingGroup = null;
  }

  if (currentPrimary?.type === "BUY_NOW") {
    pendingGroup = null;
  } else if (!currentPrimary) {
    pendingGroup = null;
  } else if (currentPrimary.type === "NEAR_MISS") {
    const pendingWindowEndsAtMs = pendingGroup?.windowEndsAt
      ? Date.parse(pendingGroup.windowEndsAt)
      : null;

    if (pendingGroup) {
      pendingGroup = {
        ...pendingGroup,
        type:
          currentPrimary.type === "BUY_NOW" && pendingGroup.type !== "BUY_NOW"
            ? "BUY_NOW"
            : pendingGroup.type,
        triggerReason:
          currentPrimary.type === "BUY_NOW" && pendingGroup.type !== "BUY_NOW"
            ? "upgraded_to_buy_now"
            : pendingGroup.triggerReason,
        latestObservedAt: nowIso,
        latestPrice: currentPrimary.price,
        latestListingKey: currentPrimary.listingKey,
        latestListing: currentPrimary.listing,
        snapshotsObserved: (pendingGroup.snapshotsObserved || 0) + 1
      };

      if (pendingWindowEndsAtMs !== null && Date.parse(nowIso) >= pendingWindowEndsAtMs) {
        shouldNotify = true;
        latestEvent = {
          eventId: `${result.itemId}-${currentPrimary.type}-${Date.parse(nowIso)}`,
          type: currentPrimary.type,
          reason: pendingGroup.triggerReason,
          sourceMode: result.sourceMode,
          sourceLabel: result.sourceLabel,
          price: currentPrimary.price,
          listingKey: currentPrimary.listingKey,
          timestamp: nowIso
        };
        lastAlertedAt = nowIso;
        lastAlertType = currentPrimary.type;
        lastAlertReason = pendingGroup.triggerReason;
        pendingGroup = null;
      }
    } else {
      const groupReason = shouldStartGrouping({
        currentPrimary,
        previousPrimaryState,
        previousPrimaryPrice,
        lastAlertedAtMs,
        nowIso,
        cooldownMs,
        improvementAmount
      });

      if (groupReason) {
        pendingGroup = createPendingGroup({
          currentPrimary,
          nowIso,
          reason: groupReason,
          groupingWindowMs
        });

        if (groupingWindowMs === 0) {
          shouldNotify = true;
          latestEvent = {
            eventId: `${result.itemId}-${currentPrimary.type}-${Date.parse(nowIso)}`,
            type: currentPrimary.type,
            reason: groupReason,
            sourceMode: result.sourceMode,
            sourceLabel: result.sourceLabel,
            price: currentPrimary.price,
            listingKey: currentPrimary.listingKey,
            timestamp: nowIso
          };
          lastAlertedAt = nowIso;
          lastAlertType = currentPrimary.type;
          lastAlertReason = groupReason;
          pendingGroup = null;
        }
      }
    }
  }

  return {
    buyNowFired:
      result.state === "BUY_NOW"
        ? shouldNotify || currentActiveBuyNowListings.length > 0
        : false,
    nearMissFired:
      result.state === "NEAR_MISS"
        ? shouldNotify ||
          lastAlertType === "NEAR_MISS" ||
          previousPrimaryState === "NEAR_MISS"
        : false,
    lastAlertedAt,
    lastAlertType,
    lastAlertReason,
    lastObservedState: currentPrimary?.type || "WAIT",
    lastObservedPrice: currentPrimary?.price ?? null,
    cooldownMs,
    groupingWindowMs,
    improvementAmount,
    pendingGroup,
    activeBuyNowListings: currentActiveBuyNowListings,
    activeBuyNowListingKeys: currentActiveBuyNowListings.map((listing) => listing.listingKey),
    latestEvent,
    shouldNotify
  };
}

module.exports = {
  createAlertState,
  buildListingKey
};
