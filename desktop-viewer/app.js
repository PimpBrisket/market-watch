(function (factory) {
  const viewer = factory();
  let fatalStartupRendered = false;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = viewer.__test;
  }

  function escapeFatalHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderFatalStartupError(error) {
    if (fatalStartupRendered || typeof document === "undefined") {
      return;
    }

    const appRoot = document.getElementById("app");

    if (!appRoot) {
      return;
    }

    fatalStartupRendered = true;
    appRoot.innerHTML = `
      <div class="boot-shell panel bad">
        <h1>Desktop Viewer v1</h1>
        <p>Error loading viewer</p>
        <p class="panel-subtitle">
          The desktop viewer shell loaded, but the client failed during startup.
        </p>
        <div class="notice bad" style="margin-top: 16px;">
          <strong>Startup error</strong>
          <div style="margin-top: 6px;">${escapeFatalHtml(
            error instanceof Error ? error.message : String(error || "Unknown startup error.")
          )}</div>
        </div>
      </div>
    `;
  }

  if (typeof window !== "undefined") {
    window.TornMarketDesktopViewer = viewer;
    window.addEventListener("DOMContentLoaded", () => {
      try {
        viewer.init();
      } catch (error) {
        renderFatalStartupError(error);
      }
    });
    window.addEventListener("error", (event) => {
      renderFatalStartupError(event?.error || event?.message || "Unhandled viewer error.");
    });
    window.addEventListener("unhandledrejection", (event) => {
      renderFatalStartupError(
        event?.reason instanceof Error
          ? event.reason
          : String(event?.reason || "Unhandled promise rejection.")
      );
    });
  }
})(function () {
  const DEFAULT_POLL_MS = 10000;
  const STATUS_REFRESH_MS = 1000;
  const STORAGE_KEY = "tornMarketDesktopViewer.uiState";
  const SEEN_ALERTS_KEY = "tornMarketDesktopViewer.seenAlertIds";
  const FILTER_OPTIONS = [
    { value: "ALL", label: "All" },
    { value: "BUY_NOW", label: "Only Buy / Buy Now" },
    { value: "ABOVE_TARGET", label: "Only Above Target" },
    { value: "NEAR_MISS", label: "Only Near Miss" },
    { value: "MARKET", label: "Only Market" },
    { value: "BAZAAR", label: "Only Bazaar" },
    { value: "WATCHING", label: "Only Watching" },
    { value: "STALE_ERROR", label: "Only Stale/Error" }
  ];
  const PANEL_VIEWS = {
    MARKET: "MARKET_LISTINGS",
    BAZAAR: "BAZAAR_LISTINGS",
    ALERTS: "LATEST_ALERTS",
    INFO: "WATCHER_INFO"
  };

  const state = {
    appRoot: null,
    statusPayload: null,
    slotsPayload: null,
    syncInFlight: false,
    requestState: {
      startWatching: false,
      stopWatching: false,
      refreshNow: false,
      resetSession: false
    },
    connectionState: "loading",
    connectionMessage: "Loading desktop viewer...",
    lastError: null,
    lastSuccessfulSyncAt: null,
    nowMs: Date.now(),
    timers: {
      sync: null,
      clock: null
    },
    ui: loadUiState(),
    listingCache: {},
    notifications: {
      enabled: loadUiState().desktopNotificationsEnabled === true,
      permission:
        typeof Notification === "undefined" ? "unsupported" : Notification.permission,
      hydrated: false,
      seenEventIds: loadSeenAlertIds()
    },
    panelResizeObserver: null,
    panelElement: null
  };

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatMoney(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "--";
    }

    return `$${Number(value).toLocaleString()}`;
  }

  function formatCompactTime(value) {
    if (!value) {
      return "--";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "--";
    }

    return date
      .toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      })
      .replace(" AM", "am")
      .replace(" PM", "pm")
      .replace(" ", "");
  }

  function formatTime(value) {
    if (!value) {
      return "--";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "--";
    }

    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function formatDateTime(value) {
    if (!value) {
      return "--";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "--";
    }

    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function formatDurationShort(valueMs) {
    const safeMs = Math.max(0, Number(valueMs) || 0);
    const totalSeconds = Math.ceil(safeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    }

    if (minutes > 0) {
      return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
    }

    return `${seconds}s`;
  }

  function loadUiState() {
    const stored = safeJsonParse(
      typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY),
      null
    );

    return {
      selectedSlotNumber: Number.isInteger(Number(stored?.selectedSlotNumber))
        ? Number(stored.selectedSlotNumber)
        : null,
      filter: FILTER_OPTIONS.some((option) => option.value === stored?.filter)
        ? stored.filter
        : "ALL",
      filterMenuOpen: false,
      alertsInboxOpen: stored?.alertsInboxOpen === true,
      alertsClearedAt: stored?.alertsClearedAt || null,
      desktopNotificationsEnabled: stored?.desktopNotificationsEnabled === true,
      panel: {
        open: stored?.panel?.open === true,
        minimized: stored?.panel?.minimized === true,
        width: Math.max(360, Number(stored?.panel?.width) || 440),
        view: Object.values(PANEL_VIEWS).includes(stored?.panel?.view)
          ? stored.panel.view
          : null
      }
    };
  }

  function persistUiState() {
    if (typeof localStorage === "undefined") {
      return;
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selectedSlotNumber: state.ui.selectedSlotNumber,
        filter: state.ui.filter,
        alertsInboxOpen: state.ui.alertsInboxOpen,
        alertsClearedAt: state.ui.alertsClearedAt,
        desktopNotificationsEnabled: state.notifications.enabled === true,
        panel: {
          open: state.ui.panel.open === true,
          minimized: state.ui.panel.minimized === true,
          width: state.ui.panel.width,
          view: state.ui.panel.view
        }
      })
    );
  }

  function loadSeenAlertIds() {
    const parsed = safeJsonParse(
      typeof localStorage === "undefined" ? null : localStorage.getItem(SEEN_ALERTS_KEY),
      []
    );

    return Array.isArray(parsed) ? parsed.slice(-100) : [];
  }

  function persistSeenAlertIds() {
    if (typeof localStorage === "undefined") {
      return;
    }

    localStorage.setItem(
      SEEN_ALERTS_KEY,
      JSON.stringify(state.notifications.seenEventIds.slice(-100))
    );
  }

  function sourceShortLabel(value) {
    return value === "BAZAAR_ONLY" ? "Bazaar" : "Market";
  }

  function createEmptySlot(slotNumber) {
    return {
      slotNumber,
      occupied: false,
      enabled: false,
      state: "EMPTY",
      trackerStatus: "EMPTY",
      trackerStatusLabel: "EMPTY",
      sourceMode: "MARKET_ONLY",
      itemId: null,
      itemName: null,
      targetPrice: null,
      nearMissGap: null,
      currentListings: [],
      qualifyingListings: [],
      sessionStats: null,
      alertState: {
        latestEvent: null
      }
    };
  }

  function trackerStatusBadgeClass(slot) {
    const status = String(slot?.trackerStatus || "EMPTY").toUpperCase();

    if (status === "WATCHING") {
      return "watching";
    }

    if (status === "STALE") {
      return "stale";
    }

    if (status === "ERROR") {
      return "error";
    }

    if (status === "IDLE") {
      return "idle";
    }

    return "empty";
  }

  function getAllSlots() {
    if (Array.isArray(state.slotsPayload?.slots)) {
      return state.slotsPayload.slots.slice().sort((left, right) => left.slotNumber - right.slotNumber);
    }

    return Array.from({ length: 6 }, (_, index) => createEmptySlot(index + 1));
  }

  function getOccupiedSlots() {
    return getAllSlots().filter((slot) => slot.occupied);
  }

  function chooseSelectedSlot(slots, selectedSlotNumber) {
    if (!slots.length) {
      return null;
    }

    const matchingSlot = slots.find((slot) => slot.slotNumber === selectedSlotNumber);

    if (matchingSlot) {
      return matchingSlot.slotNumber;
    }

    return slots[0].slotNumber;
  }

  function currentBestListing(slot) {
    return (
      slot?.cheapestAtOrBelowTarget ||
      slot?.cheapestListing ||
      slot?.cheapestAboveTarget ||
      slot?.notification?.listing ||
      null
    );
  }

  function currentBestPriceLabel(slot) {
    const listing = currentBestListing(slot);

    if (listing?.price !== null && listing?.price !== undefined) {
      return formatMoney(listing.price);
    }

    if (slot?.lowestPrice !== null && slot?.lowestPrice !== undefined) {
      return formatMoney(slot.lowestPrice);
    }

    if (slot?.lowestAboveTarget !== null && slot?.lowestAboveTarget !== undefined) {
      return formatMoney(slot.lowestAboveTarget);
    }

    return "--";
  }

  function describeSlotDataState(slot) {
    if (!slot?.occupied) {
      return {
        label: "Slot empty",
        detail: "This slot is available for a new watch item.",
        tone: "neutral"
      };
    }

    if (slot.lastError) {
      return {
        label: "Fetch failed",
        detail: slot.lastError,
        tone: "bad"
      };
    }

    if (slot.stale) {
      return {
        label: "Stale data",
        detail: "The last backend refresh is out of date or partially failed.",
        tone: "warn"
      };
    }

    if (!Array.isArray(slot.currentListings) || slot.currentListings.length === 0) {
      return {
        label: "No listings found",
        detail: `No current ${slot.sourceMode === "BAZAAR_ONLY" ? "bazaar" : "market"} listings were returned in the latest snapshot.`,
        tone: "neutral"
      };
    }

    return {
      label: "Live listings",
      detail: `Showing the latest ${slot.sourceMode === "BAZAAR_ONLY" ? "bazaar" : "market"} snapshot for this watch.`,
      tone: "live"
    };
  }

  function notificationExtraCount(notification, slot = null) {
    const listingCount = Number(notification?.listingCount) ||
      (Array.isArray(slot?.qualifyingListings) ? slot.qualifyingListings.length : 0);

    return Math.max(0, listingCount - 1);
  }

  function formatPriceComparison(targetPrice, listedPrice, quantity) {
    const target = formatMoney(targetPrice);
    const listed = formatMoney(listedPrice);
    const safeQuantity = Math.max(1, Number(quantity) || 1);

    if (safeQuantity >= 2 && Number.isFinite(Number(listedPrice))) {
      return `${target}>${listed}(${formatMoney(Number(listedPrice) * safeQuantity)})`;
    }

    return `${target}>${listed}`;
  }

  function normalizeAlertEntry(entry, slotsByItemId = {}) {
    const details = entry?.details || {};
    const fallbackSlot = slotsByItemId[String(entry?.itemId)] || null;
    const listedPrice = details.listedPrice ?? details.price ?? fallbackSlot?.notification?.price ?? null;
    const targetPrice = details.targetPrice ?? fallbackSlot?.targetPrice ?? null;
    const quantity = Number(details.quantity) || Number(fallbackSlot?.notification?.listing?.quantity) || 1;
    const sourceMode = details.sourceMode || fallbackSlot?.sourceMode || "MARKET_ONLY";

    return {
      eventId: details.eventId || `${entry?.timestamp || "unknown"}-${entry?.itemId || "na"}`,
      itemId: entry?.itemId ?? fallbackSlot?.itemId ?? null,
      itemName: entry?.itemName || fallbackSlot?.itemName || "Item",
      sourceMode,
      quantity,
      targetPrice,
      listedPrice,
      listingCount: Number(details.listingCount) || 1,
      timestamp: details.timestamp || entry?.timestamp || null
    };
  }

  function formatAlertHeadline(alert, { includeTime = false } = {}) {
    const headline = `[${sourceShortLabel(alert.sourceMode)}] ${alert.quantity}x ${alert.itemName} ${formatPriceComparison(
      alert.targetPrice,
      alert.listedPrice,
      alert.quantity
    )}`;

    if (!includeTime) {
      return headline;
    }

    return `${headline} ${formatCompactTime(alert.timestamp)}`;
  }

  function createActiveAlertForSlot(slot) {
    if (!slot?.occupied) {
      return null;
    }

    const listing = slot.notification?.listing || currentBestListing(slot);
    const listedPrice =
      slot.notification?.price ??
      listing?.price ??
      slot.lowestPrice ??
      slot.lowestAboveTarget ??
      null;

    if (listedPrice === null || listedPrice === undefined) {
      return null;
    }

    return {
      eventId: slot.notification?.eventId || `slot-${slot.slotNumber}-${slot.lastChecked || "na"}`,
      itemId: slot.itemId,
      itemName: slot.itemName || "Item",
      sourceMode: slot.sourceMode,
      quantity: Number(listing?.quantity) || 1,
      targetPrice: slot.targetPrice,
      listedPrice,
      listingCount:
        Number(slot.notification?.listingCount) ||
        (Array.isArray(slot.qualifyingListings) ? slot.qualifyingListings.length : 1),
      timestamp: slot.notification?.timestamp || slot.lastChecked || null,
      state: slot.state || "RECENT"
    };
  }

  function buildAlertInboxEntries(activityLog, slots) {
    const slotsByItemId = Object.fromEntries(
      slots.filter((slot) => slot.occupied).map((slot) => [String(slot.itemId), slot])
    );
    const clearedAtMs = state.ui.alertsClearedAt ? Date.parse(state.ui.alertsClearedAt) : null;

    return (Array.isArray(activityLog) ? activityLog : [])
      .filter((entry) => entry?.type === "alert_triggered")
      .filter((entry) => {
        if (!clearedAtMs) {
          return true;
        }

        const entryTimestamp = Date.parse(entry.timestamp || 0);
        return Number.isFinite(entryTimestamp) && entryTimestamp > clearedAtMs;
      })
      .map((entry) => normalizeAlertEntry(entry, slotsByItemId))
      .sort((left, right) => Date.parse(right.timestamp || 0) - Date.parse(left.timestamp || 0))
      .slice(0, 10);
  }

  function buildCurrentAlertEntries(slots) {
    return slots
      .map((slot) => ({
        slot,
        alert: createActiveAlertForSlot(slot)
      }))
      .filter((entry) => entry.alert)
      .sort((left, right) => {
        const leftPriority = left.slot.state === "BUY_NOW" ? 0 : left.slot.state === "NEAR_MISS" ? 1 : 2;
        const rightPriority = right.slot.state === "BUY_NOW" ? 0 : right.slot.state === "NEAR_MISS" ? 1 : 2;
        return leftPriority - rightPriority || left.slot.slotNumber - right.slot.slotNumber;
      });
  }

  function filterSlots(slots, filterValue) {
    if (filterValue === "ALL") {
      return slots;
    }

    return slots.filter((slot) => {
      if (filterValue === "BUY_NOW") {
        return slot.state === "BUY_NOW";
      }

      if (filterValue === "ABOVE_TARGET") {
        return slot.state === "WAIT" && slot.lowestAboveTarget !== null;
      }

      if (filterValue === "NEAR_MISS") {
        return slot.state === "NEAR_MISS";
      }

      if (filterValue === "MARKET") {
        return slot.sourceMode !== "BAZAAR_ONLY";
      }

      if (filterValue === "BAZAAR") {
        return slot.sourceMode === "BAZAAR_ONLY";
      }

      if (filterValue === "WATCHING") {
        return slot.trackerStatus === "WATCHING";
      }

      if (filterValue === "STALE_ERROR") {
        return slot.trackerStatus === "STALE" || slot.trackerStatus === "ERROR";
      }

      return true;
    });
  }

  function currentNotificationLabel() {
    if (!state.notifications.enabled) {
      return "Disabled";
    }

    if (state.notifications.permission === "unsupported") {
      return "Unsupported";
    }

    if (state.notifications.permission === "denied") {
      return "Permission denied";
    }

    if (state.notifications.permission === "default") {
      return "Permission needed";
    }

    return "Enabled";
  }

  function deriveOverallWatcherStatus(status, slots) {
    if (state.connectionState === "loading") {
      return "Connecting";
    }

    if (state.connectionState === "disconnected" || state.connectionState === "error") {
      return "Disconnected";
    }

    if (!status?.watchingActive) {
      return "Idle";
    }

    if (!status?.activeEnabledCount) {
      return "Idle";
    }

    if (status?.lastError) {
      return "Degraded";
    }

    if (!slots.some((slot) => slot.occupied && slot.enabled)) {
      return "Idle";
    }

    if (slots.some((slot) => slot.stale)) {
      return "Stale";
    }

    return "Watching";
  }

  function deriveNextCheckLabel(status, nowMs) {
    const pollIntervalMs = Number(state.statusPayload?.config?.pollIntervalMs) || DEFAULT_POLL_MS;
    const lastPollCompletedAt = status?.lastPollCompletedAt;

    if (!status?.watchingActive || !status?.activeEnabledCount) {
      return "Not scheduled";
    }

    if (status?.polling) {
      return "Checking...";
    }

    if (!lastPollCompletedAt) {
      return "Waiting";
    }

    const remainingMs = Date.parse(lastPollCompletedAt) + pollIntervalMs - nowMs;
    return remainingMs <= 0 ? "Ready now" : formatDurationShort(remainingMs);
  }

  function deriveNextAlertLabel(status, slots) {
    if (!status?.watchingActive) {
      return "Not scheduled";
    }

    const enabledSlots = slots.filter((slot) => slot.occupied && slot.enabled);

    if (!enabledSlots.length) {
      return "Not scheduled";
    }

    const cooldowns = enabledSlots
      .map((slot) => Number(slot.cooldownRemainingMs) || 0)
      .filter((value) => value > 0);

    if (!cooldowns.length) {
      return "Ready now";
    }

    return formatDurationShort(Math.min(...cooldowns));
  }

  function deriveNextNotificationLabel(status, inboxEntries) {
    if (!state.notifications.enabled) {
      return "Disabled";
    }

    if (state.notifications.permission === "denied") {
      return "Permission denied";
    }

    if (state.notifications.permission === "default") {
      return "Permission needed";
    }

    if (state.notifications.permission === "unsupported") {
      return "Unsupported";
    }

    if (!status?.watchingActive) {
      return "Not scheduled";
    }

    return inboxEntries.length ? "Ready now" : "Waiting";
  }

  function fetchJson(path, options = {}) {
    return fetch(path, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    }).then(async (response) => {
      const text = await response.text();
      let payload = null;

      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (error) {
          payload = null;
        }
      }

      if (!response.ok) {
        throw new Error(
          payload?.error?.message || `Request failed for ${path}: HTTP ${response.status}.`
        );
      }

      return payload;
    });
  }

  function seedListingCacheFromSlots(slots) {
    slots.forEach((slot) => {
      if (!slot?.occupied) {
        return;
      }

      const key = `${slot.slotNumber}:${slot.sourceMode}`;
      state.listingCache[key] = {
        status: "success",
        data: {
          slotNumber: slot.slotNumber,
          itemId: slot.itemId,
          itemName: slot.itemName,
          sourceMode: slot.sourceMode,
          sourceLabel: sourceShortLabel(slot.sourceMode),
          market: slot.market || null,
          listings: Array.isArray(slot.currentListings) ? slot.currentListings : []
        },
        error: null,
        lastFetchedAt: new Date().toISOString()
      };
    });
  }

  function currentRuntimeStatus() {
    return state.statusPayload?.status || state.slotsPayload?.status || {};
  }

  function updateNotificationsFromPayload(activityLog, slots) {
    const alerts = buildAlertInboxEntries(activityLog, slots).slice().reverse();

    if (!state.notifications.hydrated) {
      state.notifications.seenEventIds = alerts.map((entry) => entry.eventId).slice(-100);
      state.notifications.hydrated = true;
      persistSeenAlertIds();
      return;
    }

    alerts.forEach((alert) => {
      if (state.notifications.seenEventIds.includes(alert.eventId)) {
        return;
      }

      state.notifications.seenEventIds.push(alert.eventId);

      if (
        !state.notifications.enabled ||
        typeof Notification === "undefined" ||
        state.notifications.permission !== "granted"
      ) {
        return;
      }

      try {
        const notification = new Notification("Torn Market Watcher", {
          body: formatAlertHeadline(alert, { includeTime: true })
        });
        window.setTimeout(() => notification.close(), 7000);
      } catch (error) {
        state.lastError = error?.message || "Desktop notification failed.";
      }
    });

    state.notifications.seenEventIds = state.notifications.seenEventIds.slice(-100);
    persistSeenAlertIds();
  }

  async function syncData({ manualRefresh = false } = {}) {
    if (state.syncInFlight) {
      return;
    }

    state.syncInFlight = true;
    render();

    const errors = [];
    let anySuccess = false;

    try {
      if (manualRefresh) {
        try {
          await fetchJson("/api/refresh", {
            method: "POST",
            body: {}
          });
        } catch (error) {
          errors.push(error.message);
        }
      }

      const [statusResult, slotsResult] = await Promise.allSettled([
        fetchJson("/api/status"),
        fetchJson("/api/slots")
      ]);

      if (statusResult.status === "fulfilled") {
        state.statusPayload = statusResult.value;
        anySuccess = true;
      } else {
        errors.push(statusResult.reason?.message || "Status request failed.");
      }

      if (slotsResult.status === "fulfilled") {
        state.slotsPayload = slotsResult.value;
        anySuccess = true;
      } else {
        errors.push(slotsResult.reason?.message || "Slot request failed.");
      }

      const occupiedSlots = getOccupiedSlots();

      if (state.slotsPayload?.slots?.length) {
        state.ui.selectedSlotNumber = chooseSelectedSlot(occupiedSlots, state.ui.selectedSlotNumber);
        seedListingCacheFromSlots(occupiedSlots);
      }

      if (!occupiedSlots.length) {
        state.ui.panel.open = false;
        state.ui.panel.minimized = false;
      }

      if (anySuccess) {
        state.lastSuccessfulSyncAt = new Date().toISOString();
        state.connectionState = errors.length ? "degraded" : "connected";
        state.connectionMessage = errors.length
          ? "Viewer updated with partial data. Last known good slot data is still visible."
          : "Viewer is in sync with the backend.";
        state.lastError = errors.join(" | ") || null;
        updateNotificationsFromPayload(
          state.statusPayload?.activityLog || state.slotsPayload?.activityLog || [],
          occupiedSlots
        );

        const selectedSlot = occupiedSlots.find(
          (slot) => slot.slotNumber === state.ui.selectedSlotNumber
        );
        const selectedView = state.ui.panel.view;

        if (
          selectedSlot &&
          state.ui.panel.open &&
          (selectedView === PANEL_VIEWS.MARKET || selectedView === PANEL_VIEWS.BAZAAR)
        ) {
          const sourceMode =
            selectedView === PANEL_VIEWS.BAZAAR ? "BAZAAR_ONLY" : "MARKET_ONLY";
          const cacheKey = `${selectedSlot.slotNumber}:${sourceMode}`;

          if (!state.listingCache[cacheKey]?.data && state.listingCache[cacheKey]?.status !== "loading") {
            void loadPanelListings(selectedSlot, sourceMode);
          }
        }
      } else {
        state.connectionState = state.lastSuccessfulSyncAt ? "disconnected" : "error";
        state.connectionMessage =
          "Viewer could not reach the backend. Last known good data is being preserved.";
        state.lastError = errors.join(" | ") || "Backend unavailable.";
      }
    } finally {
      state.syncInFlight = false;
      persistUiState();
      render();
    }
  }

  async function requestWatcherAction(actionKey, path, successMessage) {
    if (state.requestState[actionKey]) {
      return;
    }

    state.requestState[actionKey] = true;
    state.lastError = null;
    render();

    try {
      const payload = await fetchJson(path, {
        method: "POST",
        body: {}
      });

      if (payload?.status || payload?.slots) {
        state.statusPayload = {
          ...(state.statusPayload || {}),
          ...(payload.status ? { status: payload.status } : {}),
          ...(payload.activityLog ? { activityLog: payload.activityLog } : {}),
          ...(payload.versions ? { versions: payload.versions } : {}),
          ...(payload.session ? { session: payload.session } : {})
        };
        state.slotsPayload = payload;
      }

      state.connectionState = "connected";
      state.connectionMessage = successMessage;
      state.lastSuccessfulSyncAt = new Date().toISOString();
      const occupiedSlots = getOccupiedSlots();
      seedListingCacheFromSlots(occupiedSlots);
      updateNotificationsFromPayload(
        payload?.activityLog || state.statusPayload?.activityLog || [],
        occupiedSlots
      );
    } catch (error) {
      state.connectionState = "degraded";
      state.connectionMessage = error.message;
      state.lastError = error.message;
    } finally {
      state.requestState[actionKey] = false;
      persistUiState();
      render();
    }
  }

  async function toggleDesktopNotifications() {
    const nextEnabled = !state.notifications.enabled;
    state.notifications.enabled = nextEnabled;

    if (typeof Notification !== "undefined" && nextEnabled && Notification.permission === "default") {
      try {
        state.notifications.permission = await Notification.requestPermission();
      } catch (error) {
        state.notifications.permission = Notification.permission;
        state.lastError = error?.message || "Notification permission request failed.";
      }
    } else if (typeof Notification !== "undefined") {
      state.notifications.permission = Notification.permission;
    }

    persistUiState();
    render();
  }

  function clearAlerts() {
    state.ui.alertsClearedAt = new Date().toISOString();
    persistUiState();
    render();
  }

  function toggleAlertsInbox() {
    state.ui.alertsInboxOpen = !state.ui.alertsInboxOpen;
    persistUiState();
    render();
  }

  function openPanelForSlot(slotNumber) {
    state.ui.selectedSlotNumber = slotNumber;
    state.ui.panel.open = true;
    state.ui.panel.minimized = false;

    const slot = getOccupiedSlots().find((entry) => entry.slotNumber === slotNumber);

    if (slot) {
      state.ui.panel.view =
        state.ui.panel.view ||
        (slot.sourceMode === "BAZAAR_ONLY" ? PANEL_VIEWS.BAZAAR : PANEL_VIEWS.MARKET);
    }

    persistUiState();
    render();

    if (slot && (state.ui.panel.view === PANEL_VIEWS.MARKET || state.ui.panel.view === PANEL_VIEWS.BAZAAR)) {
      void loadPanelListings(slot, state.ui.panel.view === PANEL_VIEWS.BAZAAR ? "BAZAAR_ONLY" : "MARKET_ONLY");
    }
  }

  function minimizePanel() {
    state.ui.panel.minimized = true;
    state.ui.panel.open = false;
    persistUiState();
    render();
  }

  function closePanel() {
    state.ui.panel.open = false;
    state.ui.panel.minimized = false;
    persistUiState();
    render();
  }

  function restoreMinimizedPanel() {
    if (!state.ui.selectedSlotNumber) {
      return;
    }

    state.ui.panel.open = true;
    state.ui.panel.minimized = false;
    persistUiState();
    render();
  }

  async function loadPanelListings(slot, sourceMode) {
    const cacheKey = `${slot.slotNumber}:${sourceMode}`;
    const cached = state.listingCache[cacheKey];

    if (cached?.status === "loading") {
      return;
    }

    state.listingCache[cacheKey] = {
      status: "loading",
      data: cached?.data || null,
      error: null,
      lastFetchedAt: cached?.lastFetchedAt || null
    };
    render();

    try {
      const payload = await fetchJson(
        `/api/slot/${slot.slotNumber}/listings?sourceMode=${encodeURIComponent(sourceMode)}`
      );
      state.listingCache[cacheKey] = {
        status: "success",
        data: payload,
        error: null,
        lastFetchedAt: new Date().toISOString()
      };
    } catch (error) {
      state.listingCache[cacheKey] = {
        status: "error",
        data: cached?.data || null,
        error: error.message,
        lastFetchedAt: cached?.lastFetchedAt || null
      };
      state.lastError = error.message;
    } finally {
      render();
    }
  }

  function setPanelView(nextView) {
    state.ui.panel.view = nextView;
    persistUiState();
    render();

    const slot = getOccupiedSlots().find((entry) => entry.slotNumber === state.ui.selectedSlotNumber);

    if (!slot) {
      return;
    }

    if (nextView === PANEL_VIEWS.MARKET) {
      void loadPanelListings(slot, "MARKET_ONLY");
    }

    if (nextView === PANEL_VIEWS.BAZAAR) {
      void loadPanelListings(slot, "BAZAAR_ONLY");
    }
  }

  function openExternal(url) {
    if (!url) {
      return;
    }

    window.open(url, "_blank", "noopener");
  }

  function renderTopStatus(slots, inboxEntries) {
    const status = currentRuntimeStatus();
    const backendVersion =
      state.statusPayload?.versions?.backendVersion ||
      state.slotsPayload?.versions?.backendVersion ||
      (state.syncInFlight ? "Loading..." : "Unknown");
    const overallStatus = deriveOverallWatcherStatus(status, slots);

    const cards = [
      {
        label: "Backend",
        value: backendVersion,
        detail:
          state.statusPayload?.versions?.minimumCompatibleScriptVersion
            ? `TornPDA min ${state.statusPayload.versions.minimumCompatibleScriptVersion}`
            : state.connectionState === "connected"
              ? "Live backend version"
              : "Waiting for backend metadata"
      },
      {
        label: "Watcher",
        value: overallStatus,
        detail:
          status.lastPollCompletedAt
            ? `Last completed ${formatTime(status.lastPollCompletedAt)}`
            : "No completed backend poll yet"
      },
      {
        label: "Next Check",
        value: deriveNextCheckLabel(status, state.nowMs),
        detail:
          status.lastPollReason
            ? `Last poll reason: ${status.lastPollReason}`
            : "Polling information appears after the first backend cycle"
      },
      {
        label: "Next Alert",
        value: deriveNextAlertLabel(status, slots),
        detail: "Based on current slot cooldown windows"
      },
      {
        label: "Next Notification",
        value: deriveNextNotificationLabel(status, inboxEntries),
        detail: `Desktop notifications: ${currentNotificationLabel()}`
      },
      {
        label: "Connection",
        value:
          state.connectionState === "connected"
            ? "Connected"
            : state.connectionState === "degraded"
              ? "Degraded"
              : state.connectionState === "loading"
                ? "Loading"
                : "Disconnected",
        detail:
          state.lastSuccessfulSyncAt
            ? `Last good sync ${formatDateTime(state.lastSuccessfulSyncAt)}`
            : "No successful desktop sync yet"
      }
    ];

    return `
      <div class="status-grid">
        ${cards
          .map(
            (card) => `
              <article class="status-card">
                <span class="label">${escapeHtml(card.label)}</span>
                <span class="value">${escapeHtml(card.value)}</span>
                <span class="detail">${escapeHtml(card.detail)}</span>
              </article>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderWatchedSlotCard(slot) {
    const stateInfo = describeSlotDataState(slot);
    const activeAlert = createActiveAlertForSlot(slot);

    return `
      <article class="slot-card occupied" data-slot-select="${slot.slotNumber}">
        <div class="slot-head">
          <div>
            <div class="slot-title">Slot ${slot.slotNumber}: ${escapeHtml(slot.itemName)}</div>
            <div class="slot-subtitle">Item ${escapeHtml(slot.itemId)} | ${escapeHtml(
              sourceShortLabel(slot.sourceMode)
            )}</div>
          </div>
          <div class="badge-row">
            <span class="badge source">${escapeHtml(sourceShortLabel(slot.sourceMode))}</span>
            <span class="badge ${escapeHtml(trackerStatusBadgeClass(slot))}">${escapeHtml(
              slot.trackerStatusLabel || slot.trackerStatus || "EMPTY"
            )}</span>
          </div>
        </div>
        <div class="meta-grid compact">
          <div class="meta-card">
            <span class="label">Target</span>
            <span class="value">${formatMoney(slot.targetPrice)}</span>
          </div>
          <div class="meta-card">
            <span class="label">Near-Miss Gap</span>
            <span class="value">${formatMoney(slot.nearMissGap)}</span>
          </div>
          <div class="meta-card">
            <span class="label">Current Best</span>
            <span class="value">${escapeHtml(currentBestPriceLabel(slot))}</span>
          </div>
          <div class="meta-card">
            <span class="label">Watching</span>
            <span class="value">${slot.enabled ? "Enabled" : "Disabled"}</span>
          </div>
        </div>
        <div class="slot-note ${escapeHtml(stateInfo.tone)}">
          <strong>${escapeHtml(stateInfo.label)}</strong><br />
          ${escapeHtml(stateInfo.detail)}
        </div>
        ${
          activeAlert
            ? `<div class="slot-alert-line">${escapeHtml(
                formatAlertHeadline(activeAlert, { includeTime: true })
              )}</div>`
            : ""
        }
        <div class="slot-subtitle" style="margin-top: 12px;">
          Last checked: ${escapeHtml(formatDateTime(slot.lastChecked))}
        </div>
      </article>
    `;
  }

  function renderCurrentAlerts(slots) {
    const entries = buildCurrentAlertEntries(slots);

    if (!entries.length) {
      return `
        <div class="empty-state">
          No active desktop alerts right now. This panel stays focused on current opportunities instead of the full alert history.
        </div>
      `;
    }

    return `
      <div class="alert-list">
        ${entries
          .map(({ slot, alert }) => `
            <article class="alert-card">
              <div class="alert-head">
                <div>
                  <div class="alert-title">${escapeHtml(
                    formatAlertHeadline(alert, { includeTime: true })
                  )}</div>
                  <div class="alert-detail">Slot ${escapeHtml(slot.slotNumber)} | ${escapeHtml(
                    slot.state || "RECENT"
                  )}</div>
                </div>
                <span class="badge ${slot.state === "BUY_NOW" ? "watching" : "stale"}">${escapeHtml(
                  slot.state || "RECENT"
                )}</span>
              </div>
              ${
                notificationExtraCount(slot.notification, slot) > 0
                  ? `<div class="alert-detail">+${escapeHtml(
                      notificationExtraCount(slot.notification, slot)
                    )} Listings available</div>`
                  : ""
              }
            </article>
          `)
          .join("")}
      </div>
    `;
  }

  function renderAlertInbox(inboxEntries) {
    if (!state.ui.alertsInboxOpen) {
      return "";
    }

    return `
      <section class="panel inbox-panel">
        <div class="panel-head">
          <div>
            <h2>Alert Inbox</h2>
            <div class="panel-subtitle">Last 10 alerts plus new alerts that arrive while watching.</div>
          </div>
          <div class="panel-subtitle">${escapeHtml(inboxEntries.length)} visible</div>
        </div>
        ${
          inboxEntries.length
            ? `<div class="alert-list compact">
                ${inboxEntries
                  .map((alert) => `
                    <article class="alert-card">
                      <div class="alert-title">${escapeHtml(
                        formatAlertHeadline(alert, { includeTime: true })
                      )}</div>
                      ${alert.listingCount > 1 ? `<div class="alert-detail">+${escapeHtml(alert.listingCount - 1)} Listings available</div>` : ""}
                    </article>
                  `)
                  .join("")}
              </div>`
            : `<div class="empty-state">No alerts yet. New alerts will appear here while watching.</div>`
        }
      </section>
    `;
  }

  function renderFilterMenu() {
    if (!state.ui.filterMenuOpen) {
      return "";
    }

    return `
      <div class="filter-menu" data-filter-menu>
        ${FILTER_OPTIONS.map(
          (option) => `
            <button
              class="filter-option ${state.ui.filter === option.value ? "active" : ""}"
              data-filter-value="${escapeHtml(option.value)}"
            >
              ${escapeHtml(option.label)}
            </button>
          `
        ).join("")}
      </div>
    `;
  }

  function renderPanelListings(slot, sourceMode) {
    const cacheKey = `${slot.slotNumber}:${sourceMode}`;
    const entry = state.listingCache[cacheKey];
    const label = sourceMode === "BAZAAR_ONLY" ? "Bazaar" : "Market";
    const listings = Array.isArray(entry?.data?.listings) ? entry.data.listings : [];

    if (entry?.status === "loading" && !entry?.data) {
      return `<div class="empty-state">Loading ${escapeHtml(label.toLowerCase())} listings...</div>`;
    }

    if (entry?.status === "error" && !entry?.data) {
      return `<div class="empty-state bad">Failed to load ${escapeHtml(
        label.toLowerCase()
      )} listings.<br />${escapeHtml(entry.error || "Unknown fetch error.")}</div>`;
    }

    if (!listings.length) {
      return `<div class="empty-state">No current ${escapeHtml(
        label.toLowerCase()
      )} listings exist for this item.</div>`;
    }

    if (sourceMode === "BAZAAR_ONLY") {
      return `
        <div class="detail-listings">
          <table>
            <thead>
              <tr>
                <th>Seller</th>
                <th>Price</th>
                <th>Qty</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${listings
                .map(
                  (listing) => `
                    <tr>
                      <td>${escapeHtml(
                        listing.playerName ||
                          (listing.playerId ? `Player ${listing.playerId}` : "Seller unavailable")
                      )}</td>
                      <td>${escapeHtml(formatMoney(listing.price))}</td>
                      <td>${escapeHtml(listing.quantity ?? "--")}</td>
                      <td>${escapeHtml(formatCompactTime(listing.contentUpdated || listing.lastChecked))}</td>
                      <td>${
                        listing.bazaarUrl
                          ? `<button class="link-button" data-open-link="${escapeHtml(
                              listing.bazaarUrl
                            )}">Open Bazaar</button>`
                          : `<span class="panel-subtitle">Unavailable</span>`
                      }</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    return `
      <div class="detail-listings">
        <table>
          <thead>
            <tr>
              <th>Price</th>
              <th>Qty</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            ${listings
              .map(
                (listing) => `
                  <tr>
                    <td>${escapeHtml(formatMoney(listing.price))}</td>
                    <td>${escapeHtml(listing.quantity ?? "--")}</td>
                    <td>${escapeHtml(formatCompactTime(listing.contentUpdated || listing.lastChecked))}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPanelAlerts(slot, inboxEntries) {
    const itemAlerts = inboxEntries.filter((alert) => Number(alert.itemId) === Number(slot.itemId));

    if (!itemAlerts.length) {
      return `<div class="empty-state">No alerts recorded for this watched item in the current desktop inbox view.</div>`;
    }

    return `
      <div class="alert-list compact">
        ${itemAlerts
          .map(
            (alert) => `
              <article class="alert-card">
                <div class="alert-title">${escapeHtml(
                  formatAlertHeadline(alert, { includeTime: true })
                )}</div>
                ${alert.listingCount > 1 ? `<div class="alert-detail">+${escapeHtml(alert.listingCount - 1)} Listings available</div>` : ""}
              </article>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderWatcherInfo(slot) {
    const stats = slot.sessionStats || state.slotsPayload?.session?.slots?.[String(slot.slotNumber)] || null;
    const targetPrice = slot.targetPrice;

    if (!stats) {
      return `<div class="empty-state">No current watch-session stats are available for this item yet.</div>`;
    }

    const lowDelta =
      stats.lowestListingPrice !== null && targetPrice !== null
        ? stats.lowestListingPrice - targetPrice
        : null;
    const highDelta =
      stats.highestListingPrice !== null && targetPrice !== null
        ? stats.highestListingPrice - targetPrice
        : null;

    const cards = [
      {
        label: "Lowest Found",
        value:
          stats.lowestListingPrice === null
            ? "--"
            : `${formatMoney(stats.lowestListingPrice)} (${lowDelta >= 0 ? "+" : ""}${formatMoney(
                lowDelta
              )})`
      },
      {
        label: "Highest Found",
        value:
          stats.highestListingPrice === null
            ? "--"
            : `${formatMoney(stats.highestListingPrice)} (${highDelta >= 0 ? "+" : ""}${formatMoney(
                highDelta
              )})`
      },
      {
        label: "Alerted Qty",
        value: String(stats.totalAlertedQuantity ?? 0)
      },
      {
        label: "Listings Seen",
        value: String(stats.totalListingsFound ?? 0)
      },
      {
        label: "Near-Misses",
        value: String(stats.totalNearMisses ?? 0)
      },
      {
        label: "Total Alerts",
        value: String(stats.totalAlerts ?? 0)
      },
      {
        label: "Last Checked",
        value: formatDateTime(stats.lastChecked)
      },
      {
        label: "Source Mode",
        value: sourceShortLabel(stats.sourceMode)
      }
    ];

    return `
      <div class="meta-grid">
        ${cards
          .map(
            (card) => `
              <div class="meta-card">
                <span class="label">${escapeHtml(card.label)}</span>
                <span class="value">${escapeHtml(card.value)}</span>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  function panelViewOptions() {
    return [
      { value: PANEL_VIEWS.MARKET, label: "View Market Listings" },
      { value: PANEL_VIEWS.BAZAAR, label: "View Bazaar Listings" },
      { value: PANEL_VIEWS.ALERTS, label: "Latest Alerts" },
      { value: PANEL_VIEWS.INFO, label: "Watcher Info" }
    ];
  }

  function renderSidePanel(slot, inboxEntries) {
    if (!slot || !state.ui.panel.open) {
      return "";
    }

    let content = "";

    if (state.ui.panel.view === PANEL_VIEWS.BAZAAR) {
      content = renderPanelListings(slot, "BAZAAR_ONLY");
    } else if (state.ui.panel.view === PANEL_VIEWS.ALERTS) {
      content = renderPanelAlerts(slot, inboxEntries);
    } else if (state.ui.panel.view === PANEL_VIEWS.INFO) {
      content = renderWatcherInfo(slot);
    } else {
      content = renderPanelListings(slot, "MARKET_ONLY");
    }

    return `
      <aside
        class="side-panel"
        id="desktop-side-panel"
        style="width:${escapeHtml(state.ui.panel.width)}px;"
      >
        <div class="side-panel-header">
          <div>
            <h2>${escapeHtml(slot.itemName)}</h2>
            <div class="panel-subtitle">Slot ${escapeHtml(slot.slotNumber)} | Item ${escapeHtml(
              slot.itemId
            )}</div>
          </div>
          <div class="side-panel-controls">
            <button class="button secondary slim" data-action="minimize-panel">Minimize</button>
            <button class="button secondary slim" data-action="close-panel">X</button>
          </div>
        </div>
        <div class="badge-row panel-badges">
          <span class="badge source">${escapeHtml(sourceShortLabel(slot.sourceMode))}</span>
          <span class="badge ${escapeHtml(trackerStatusBadgeClass(slot))}">${escapeHtml(
            slot.trackerStatusLabel || slot.trackerStatus || "EMPTY"
          )}</span>
        </div>
        <div class="panel-controls-row">
          <select class="panel-select" data-action="change-panel-view">
            ${panelViewOptions()
              .map(
                (option) => `
                  <option value="${escapeHtml(option.value)}" ${
                    option.value === state.ui.panel.view ? "selected" : ""
                  }>
                    ${escapeHtml(option.label)}
                  </option>
                `
              )
              .join("")}
          </select>
          ${
            slot.links?.tornMarket
              ? `<button class="button secondary slim" data-open-link="${escapeHtml(
                  slot.links.tornMarket
                )}">Open Market</button>`
              : ""
          }
        </div>
        <div class="side-panel-content">
          ${content}
        </div>
      </aside>
    `;
  }

  function renderMinimizedPanelChip(slot) {
    if (!slot || !state.ui.panel.minimized) {
      return "";
    }

    return `
      <button class="minimized-panel-chip" data-action="restore-panel">
        ${escapeHtml(slot.itemName)} (${escapeHtml(sourceShortLabel(slot.sourceMode))})
      </button>
    `;
  }

  function requestBusy(actionKey) {
    return state.requestState[actionKey] === true || state.syncInFlight;
  }

  function render() {
    if (!state.appRoot) {
      return;
    }

    const occupiedSlots = getOccupiedSlots();
    const filteredSlots = filterSlots(occupiedSlots, state.ui.filter);
    state.ui.selectedSlotNumber = chooseSelectedSlot(occupiedSlots, state.ui.selectedSlotNumber);
    const selectedSlot = occupiedSlots.find((slot) => slot.slotNumber === state.ui.selectedSlotNumber) || null;
    const summary = state.slotsPayload?.summary || state.statusPayload?.status || {};
    const runtimeStatus = currentRuntimeStatus();
    const activityLog = state.statusPayload?.activityLog || state.slotsPayload?.activityLog || [];
    const inboxEntries = buildAlertInboxEntries(activityLog, occupiedSlots);

    if (!selectedSlot && state.ui.panel.open) {
      state.ui.panel.open = false;
      state.ui.panel.minimized = false;
    }

    if (selectedSlot && !state.ui.panel.view) {
      state.ui.panel.view =
        selectedSlot.sourceMode === "BAZAAR_ONLY" ? PANEL_VIEWS.BAZAAR : PANEL_VIEWS.MARKET;
    }

    state.appRoot.innerHTML = `
      <header class="viewer-header">
        <div class="viewer-title">
          <h1>Desktop Viewer</h1>
          <p>
            Desktop-first monitoring for the same Torn market watcher backend. This view focuses on occupied watches,
            compact alerts, and a resizable detail panel without changing backend truth.
          </p>
        </div>
        <div class="header-actions">
          <span class="pill ${escapeHtml(state.connectionState)}">${escapeHtml(
            state.connectionState === "connected"
              ? "Backend Connected"
              : state.connectionState === "degraded"
                ? "Backend Degraded"
                : state.connectionState === "loading"
                  ? "Connecting"
                  : "Backend Disconnected"
          )}</span>
          <button class="button secondary" data-action="toggle-inbox">
            ${state.ui.alertsInboxOpen ? "Close" : "Alerts"}
          </button>
          <button class="button secondary" data-action="toggle-desktop-notifications">
            Notifications: ${escapeHtml(state.notifications.enabled ? "On" : "Off")}
          </button>
          <button
            class="button secondary"
            data-action="start-watching"
            ${runtimeStatus.watchingActive || requestBusy("startWatching") ? "disabled" : ""}
          >
            ${requestBusy("startWatching") ? "Starting..." : "Start Watching"}
          </button>
          <button
            class="button secondary"
            data-action="stop-watching"
            ${!runtimeStatus.watchingActive || requestBusy("stopWatching") ? "disabled" : ""}
          >
            ${requestBusy("stopWatching") ? "Stopping..." : "Stop Watching"}
          </button>
          <button
            class="button"
            data-action="refresh-now"
            ${requestBusy("refreshNow") ? "disabled" : ""}
          >
            ${
              requestBusy("refreshNow")
                ? "Refreshing..."
                : runtimeStatus.watchingActive && runtimeStatus.activeEnabledCount > 0
                  ? "Refresh Now"
                  : "Reload View"
            }
          </button>
          <button class="button secondary" data-action="clear-alerts">Clear Alerts</button>
          <button
            class="button secondary"
            data-action="reset-session"
            ${requestBusy("resetSession") ? "disabled" : ""}
          >
            ${requestBusy("resetSession") ? "Resetting..." : "Reset Session Stats"}
          </button>
        </div>
      </header>

      ${renderTopStatus(occupiedSlots, inboxEntries)}

      <div class="notice ${escapeHtml(
        state.connectionState === "connected"
          ? "good"
          : state.connectionState === "degraded"
            ? "warn"
            : state.connectionState === "loading"
              ? "info"
              : "bad"
      )}">
        <strong>${escapeHtml(state.connectionMessage)}</strong>
        ${
          state.lastError
            ? `<div style="margin-top: 6px;">${escapeHtml(state.lastError)}</div>`
            : ""
        }
      </div>

      ${renderAlertInbox(inboxEntries)}

      <main class="viewer-main ${state.ui.panel.open ? "panel-open" : ""}" ${
        state.ui.panel.open ? `style="margin-right:${escapeHtml(state.ui.panel.width + 24)}px;"` : ""
      }>
        <section class="panel watched-panel">
          <div class="panel-head">
            <div>
              <h2>Watched Slots</h2>
              <div class="panel-subtitle">
                Only currently occupied slots appear here so the dashboard stays dense and readable.
              </div>
            </div>
            <div class="panel-tools">
              <button class="button secondary slim" data-action="toggle-filter-menu" data-filter-menu>
                Filter
              </button>
              <div class="panel-subtitle">
                ${escapeHtml(summary.occupiedCount ?? occupiedSlots.length)} watched
              </div>
              ${renderFilterMenu()}
            </div>
          </div>
          ${
            !occupiedSlots.length
              ? `<div class="empty-state">No watched items yet.</div>`
              : !filteredSlots.length
                ? `<div class="empty-state">No watched items match the current filter.</div>`
                : `<div class="slot-grid">${filteredSlots.map((slot) => renderWatchedSlotCard(slot)).join("")}</div>`
          }
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Active Alerts</h2>
              <div class="panel-subtitle">
                Current active opportunities stay here. Use the inbox for recent alert history.
              </div>
            </div>
          </div>
          ${renderCurrentAlerts(occupiedSlots)}
        </section>
      </main>

      ${renderSidePanel(selectedSlot, inboxEntries)}
      ${renderMinimizedPanelChip(selectedSlot)}

      <div class="footer-note">
        Desktop Viewer v1 stays monitoring-focused: no charts, no predictors, and no heavy analytics yet.
      </div>
    `;

    state.appRoot.querySelectorAll("[data-slot-select]").forEach((button) => {
      button.addEventListener("click", () => {
        openPanelForSlot(Number(button.getAttribute("data-slot-select")));
      });
    });

    state.appRoot.querySelectorAll("[data-open-link]").forEach((button) => {
      button.addEventListener("click", () => {
        openExternal(button.getAttribute("data-open-link"));
      });
    });

    state.appRoot.querySelectorAll("[data-filter-value]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        state.ui.filter = button.getAttribute("data-filter-value") || "ALL";
        state.ui.filterMenuOpen = false;
        persistUiState();
        render();
      });
    });

    const filterToggle = state.appRoot.querySelector('[data-action="toggle-filter-menu"]');
    if (filterToggle) {
      filterToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        state.ui.filterMenuOpen = !state.ui.filterMenuOpen;
        render();
      });
    }

    const panelViewSelect = state.appRoot.querySelector('[data-action="change-panel-view"]');
    if (panelViewSelect) {
      panelViewSelect.addEventListener("change", () => {
        setPanelView(panelViewSelect.value);
      });
    }

    const panel = document.getElementById("desktop-side-panel");
    if (panel && typeof ResizeObserver !== "undefined") {
      if (state.panelResizeObserver) {
        state.panelResizeObserver.disconnect();
      }

      state.panelResizeObserver = new ResizeObserver((entries) => {
        const width = Math.round(entries[0]?.contentRect?.width || state.ui.panel.width);
        state.ui.panel.width = Math.max(360, width);
        persistUiState();
      });
      state.panelResizeObserver.observe(panel);
      state.panelElement = panel;
    } else if (state.panelResizeObserver) {
      state.panelResizeObserver.disconnect();
      state.panelResizeObserver = null;
      state.panelElement = null;
    }

    const handlers = {
      "toggle-inbox": toggleAlertsInbox,
      "toggle-desktop-notifications": () => {
        void toggleDesktopNotifications();
      },
      "start-watching": () => {
        void requestWatcherAction(
          "startWatching",
          "/api/watching/start",
          "Global watching started. Enabled slots will now poll on the backend interval."
        );
      },
      "stop-watching": () => {
        void requestWatcherAction(
          "stopWatching",
          "/api/watching/stop",
          "Global watching stopped. Slots remain saved as preferences."
        );
      },
      "refresh-now": () => {
        const active = runtimeStatus.watchingActive && runtimeStatus.activeEnabledCount > 0;

        if (active) {
          state.requestState.refreshNow = true;
          render();
          syncData({ manualRefresh: true }).finally(() => {
            state.requestState.refreshNow = false;
            render();
          });
          return;
        }

        state.requestState.refreshNow = true;
        render();
        syncData({ manualRefresh: false }).finally(() => {
          state.requestState.refreshNow = false;
          render();
        });
      },
      "clear-alerts": clearAlerts,
      "reset-session": () => {
        void requestWatcherAction(
          "resetSession",
          "/api/session/reset",
          "Watcher session stats were reset."
        );
      },
      "close-panel": closePanel,
      "minimize-panel": minimizePanel,
      "restore-panel": restoreMinimizedPanel
    };

    Object.entries(handlers).forEach(([action, handler]) => {
      state.appRoot.querySelectorAll(`[data-action="${action}"]`).forEach((button) => {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          handler();
        });
      });
    });
  }

  function handleDocumentClick(event) {
    if (
      state.ui.filterMenuOpen &&
      !event.target.closest("[data-filter-menu]") &&
      !event.target.closest(".filter-menu")
    ) {
      state.ui.filterMenuOpen = false;
      render();
    }
  }

  function init() {
    state.appRoot = document.getElementById("app");

    if (!state.appRoot) {
      throw new Error("Desktop viewer app root was not found.");
    }

    if (typeof document !== "undefined") {
      document.addEventListener("click", handleDocumentClick);
    }

    render();
    syncData();

    if (state.timers.sync) {
      window.clearInterval(state.timers.sync);
    }

    if (state.timers.clock) {
      window.clearInterval(state.timers.clock);
    }

    state.timers.sync = window.setInterval(() => {
      syncData();
    }, DEFAULT_POLL_MS);

    state.timers.clock = window.setInterval(() => {
      state.nowMs = Date.now();
      if (typeof Notification !== "undefined") {
        state.notifications.permission = Notification.permission;
      }
      render();
    }, STATUS_REFRESH_MS);
  }

  return {
    init,
    __test: {
      formatPriceComparison,
      formatAlertHeadline,
      filterSlots,
      buildAlertInboxEntries,
      createActiveAlertForSlot,
      describeSlotDataState,
      deriveNextCheckLabel,
      deriveNextAlertLabel,
      deriveOverallWatcherStatus
    }
  };
});
