function buildTornMarketLink(result, tornMarketBaseUrl) {
  if (!result?.itemId) {
    return null;
  }

  const itemNamePart = result.itemName
    ? `&itemName=${encodeURIComponent(result.itemName)}`
    : "";

  return `${tornMarketBaseUrl}${result.itemId}${itemNamePart}`;
}

function deriveTrackerStatus(result, derivedStale, globalWatchingActive) {
  if (!result?.occupied) {
    return "EMPTY";
  }

  if (!globalWatchingActive) {
    return "IDLE";
  }

  if (!result.enabled) {
    return "IDLE";
  }

  if (result.lastError && !result.lastChecked) {
    return "ERROR";
  }

  if (derivedStale) {
    return "STALE";
  }

  return "WATCHING";
}

function deriveCooldownState(result) {
  const cooldownMs = result.alertState?.cooldownMs ?? null;
  const lastAlertedAt = result.alertState?.lastAlertedAt ?? null;

  if (!cooldownMs || !lastAlertedAt) {
    return {
      coolingDown: false,
      cooldownRemainingMs: 0
    };
  }

  const remaining = Math.max(0, cooldownMs - (Date.now() - Date.parse(lastAlertedAt)));

  return {
    coolingDown: remaining > 0,
    cooldownRemainingMs: remaining
  };
}

function withLinks(result, tornMarketBaseUrl, staleAfterMs, globalWatchingActive = true) {
  if (!result) {
    return null;
  }

  if (!result.occupied) {
    return {
      ...result,
      trackerStatus: "EMPTY",
      trackerStatusLabel: "EMPTY",
      coolingDown: false,
      cooldownRemainingMs: 0,
      links: {
        tornMarket: null
      },
      notification: null
    };
  }

  const latestEvent = result.alertState?.latestEvent || null;
  const latestEventAgeMs = latestEvent ? Date.now() - Date.parse(latestEvent.timestamp) : null;
  const derivedStale =
    result.lastChecked === null
      ? result.stale
      : result.stale || Date.now() - Date.parse(result.lastChecked) > staleAfterMs;
  const trackerStatus = deriveTrackerStatus(result, derivedStale, globalWatchingActive);
  const cooldownState = deriveCooldownState(result);

  return {
    ...result,
    stale: derivedStale,
    trackerStatus,
    trackerStatusLabel: trackerStatus.replace("_", " "),
    coolingDown: globalWatchingActive ? cooldownState.coolingDown : false,
    cooldownRemainingMs: globalWatchingActive ? cooldownState.cooldownRemainingMs : 0,
    links: {
      tornMarket: buildTornMarketLink(result, tornMarketBaseUrl)
    },
    notification: latestEvent
      ? {
          ...latestEvent,
          ageMs: latestEventAgeMs
        }
      : null
  };
}

function formatSlotCollection({
  slots,
  status,
  settings,
  activityLog,
  versions,
  tornMarketBaseUrl,
  staleAfterMs
}) {
  const globalWatchingActive = status?.watchingActive === true;
  const formattedSlots = slots
    .filter(Boolean)
    .map((slot) => withLinks(slot, tornMarketBaseUrl, staleAfterMs, globalWatchingActive))
    .sort((left, right) => left.slotNumber - right.slotNumber);
  const occupiedSlots = formattedSlots.filter((slot) => slot.occupied);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      slotLimit: formattedSlots.length,
      slotCount: formattedSlots.length,
      occupiedCount: occupiedSlots.length,
      emptyCount: formattedSlots.length - occupiedSlots.length,
      enabledCount: occupiedSlots.filter((slot) => slot.enabled).length,
      activeEnabledCount: globalWatchingActive
        ? occupiedSlots.filter((slot) => slot.enabled).length
        : 0,
      watchCount: occupiedSlots.length,
      buyNowCount: occupiedSlots.filter((slot) => slot.state === "BUY_NOW").length,
      nearMissCount: occupiedSlots.filter((slot) => slot.state === "NEAR_MISS").length,
      waitCount: occupiedSlots.filter((slot) => slot.state === "WAIT").length,
      staleCount: occupiedSlots.filter((slot) => slot.stale).length
    },
    status,
    settings,
    activityLog: Array.isArray(activityLog) ? activityLog : [],
    versions: versions || null,
    slots: formattedSlots,
    watches: occupiedSlots
  };
}

module.exports = {
  withLinks,
  formatSlotCollection
};
