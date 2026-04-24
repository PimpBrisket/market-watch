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

  const state = {
    appRoot: null,
    statusPayload: null,
    slotsPayload: null,
    syncInFlight: false,
    connectionState: "loading",
    connectionMessage: "Loading desktop viewer...",
    lastError: null,
    lastSuccessfulSyncAt: null,
    selectedSlotNumber: 1,
    nowMs: Date.now(),
    timers: {
      sync: null,
      clock: null
    }
  };

  function formatMoney(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "--";
    }

    return `$${Number(value).toLocaleString()}`;
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sourceShortLabel(value) {
    return value === "BAZAAR_ONLY" ? "Bazaar" : "Market";
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

  function createEmptySlot(slotNumber) {
    return {
      slotNumber,
      occupied: false,
      trackerStatus: "EMPTY",
      trackerStatusLabel: "EMPTY",
      sourceMode: "MARKET_ONLY",
      sourceLabel: "Market Only",
      currentListings: [],
      qualifyingListings: [],
      alertState: {
        latestEvent: null
      }
    };
  }

  function getSlots() {
    if (Array.isArray(state.slotsPayload?.slots) && state.slotsPayload.slots.length) {
      const slotsByNumber = new Map(
        state.slotsPayload.slots
          .filter((slot) => Number.isInteger(Number(slot?.slotNumber)))
          .map((slot) => [Number(slot.slotNumber), slot])
      );

      return Array.from({ length: 6 }, (_, index) => {
        const slotNumber = index + 1;
        return slotsByNumber.get(slotNumber) || createEmptySlot(slotNumber);
      });
    }

    return Array.from({ length: 6 }, (_, index) => createEmptySlot(index + 1));
  }

  function chooseSelectedSlot(slots, selectedSlotNumber) {
    const matchingSlot = slots.find((slot) => slot.slotNumber === selectedSlotNumber);

    if (matchingSlot) {
      return matchingSlot.slotNumber;
    }

    const firstOccupied = slots.find((slot) => slot.occupied);
    return firstOccupied ? firstOccupied.slotNumber : slots[0]?.slotNumber || 1;
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

  function alertHeadlineForSlot(slot) {
    const listing = currentBestListing(slot);
    const quantity = Number(listing?.quantity) || 1;
    const price =
      listing?.price ??
      slot?.notification?.price ??
      slot?.lowestPrice ??
      slot?.lowestAboveTarget ??
      null;

    return `[${sourceShortLabel(slot?.sourceMode)}] ${quantity}x ${slot?.itemName || "Item"} | ${formatMoney(price)}`;
  }

  function buildAlertEntries(slots) {
    return slots
      .filter((slot) => {
        if (!slot?.occupied) {
          return false;
        }

        return slot.state === "BUY_NOW" || slot.state === "NEAR_MISS" || Boolean(slot.notification);
      })
      .map((slot) => {
        const qualifyingCount = Array.isArray(slot.qualifyingListings)
          ? slot.qualifyingListings.length
          : Number(slot.notification?.listingCount) || 0;

        return {
          slotNumber: slot.slotNumber,
          state: slot.state,
          itemName: slot.itemName,
          headline: alertHeadlineForSlot(slot),
          extraCount: Math.max(0, qualifyingCount - 1),
          lastUpdated: slot.notification?.timestamp || slot.lastChecked || null
        };
      })
      .sort((left, right) => {
        const leftPriority = left.state === "BUY_NOW" ? 0 : left.state === "NEAR_MISS" ? 1 : 2;
        const rightPriority = right.state === "BUY_NOW" ? 0 : right.state === "NEAR_MISS" ? 1 : 2;
        return leftPriority - rightPriority || left.slotNumber - right.slotNumber;
      });
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

    if (!status?.watchingActive) {
      return "Not scheduled";
    }

    if (!status?.activeEnabledCount) {
      return "Not scheduled";
    }

    if (status?.polling) {
      return "Checking...";
    }

    if (!lastPollCompletedAt) {
      return status?.activeEnabledCount > 0 ? "Waiting" : "Not scheduled";
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

  function deriveNextNotificationLabel() {
    return "Disabled";
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

      if (state.slotsPayload?.slots?.length) {
        state.selectedSlotNumber = chooseSelectedSlot(
          state.slotsPayload.slots,
          state.selectedSlotNumber
        );
      }

      if (anySuccess) {
        state.lastSuccessfulSyncAt = new Date().toISOString();
        state.connectionState = errors.length ? "degraded" : "connected";
        state.connectionMessage = errors.length
          ? "Viewer updated with partial data. Last known good slot data is still visible."
          : "Viewer is in sync with the backend.";
        state.lastError = errors.join(" | ") || null;
      } else {
        state.connectionState = state.lastSuccessfulSyncAt ? "disconnected" : "error";
        state.connectionMessage = "Viewer could not reach the backend. Last known good data is being preserved.";
        state.lastError = errors.join(" | ") || "Backend unavailable.";
      }
    } finally {
      state.syncInFlight = false;
      render();
    }
  }

  function openExternal(url) {
    if (!url) {
      return;
    }

    window.open(url, "_blank", "noopener");
  }

  function renderTopStatus(slots) {
    const status = state.statusPayload?.status || state.slotsPayload?.status || {};
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
        value: deriveNextNotificationLabel(),
        detail: "Desktop notifications are not part of v1 yet"
      },
      {
        label: "Connection",
        value: state.connectionState === "connected" ? "Connected" : state.connectionState === "degraded" ? "Degraded" : state.connectionState === "loading" ? "Loading" : "Disconnected",
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

  function renderSlotCard(slot) {
    const stateInfo = describeSlotDataState(slot);

    return `
      <article class="slot-card ${slot.occupied ? "occupied" : "empty"} ${
        state.selectedSlotNumber === slot.slotNumber ? "selected" : ""
      }" data-slot-select="${slot.slotNumber}">
        <div class="slot-head">
          <div>
            <div class="slot-title">Slot ${slot.slotNumber}${slot.occupied ? `: ${escapeHtml(slot.itemName)}` : ""}</div>
            <div class="slot-subtitle">${
              slot.occupied
                ? `Item ${escapeHtml(slot.itemId)} | ${escapeHtml(sourceShortLabel(slot.sourceMode))}`
                : "Empty watch slot"
            }</div>
          </div>
          <div class="badge-row">
            <span class="badge source">${escapeHtml(sourceShortLabel(slot.sourceMode))}</span>
            <span class="badge ${escapeHtml(trackerStatusBadgeClass(slot))}">${escapeHtml(
              slot.trackerStatusLabel || slot.trackerStatus || "EMPTY"
            )}</span>
          </div>
        </div>
        <div class="meta-grid">
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
            <span class="value">${slot.occupied ? (slot.enabled ? "Enabled" : "Disabled") : "--"}</span>
          </div>
        </div>
        <div class="slot-note ${escapeHtml(stateInfo.tone)}">
          <strong>${escapeHtml(stateInfo.label)}</strong><br />
          ${escapeHtml(stateInfo.detail)}
        </div>
        <div class="slot-subtitle" style="margin-top: 12px;">
          Last checked: ${escapeHtml(formatDateTime(slot.lastChecked))} | Last success: ${escapeHtml(
            formatTime(slot.lastChecked)
          )}
        </div>
      </article>
    `;
  }

  function renderAlerts(slots) {
    const alerts = buildAlertEntries(slots);

    if (!alerts.length) {
      return `
        <div class="empty-state">
          No active desktop alerts right now. This panel will show current BUY NOW and near-miss opportunities in a denser desktop format.
        </div>
      `;
    }

    return `
      <div class="alert-list">
        ${alerts
          .map(
            (alert) => `
              <article class="alert-card">
                <div class="alert-head">
                  <div>
                    <div class="alert-title">${escapeHtml(alert.headline)}</div>
                    <div class="alert-detail">Slot ${escapeHtml(alert.slotNumber)} | ${escapeHtml(
                      alert.state || "RECENT"
                    )}</div>
                  </div>
                  <span class="badge ${alert.state === "BUY_NOW" ? "watching" : "stale"}">${escapeHtml(
                    alert.state || "RECENT"
                  )}</span>
                </div>
                ${
                  alert.extraCount > 0
                    ? `<div class="alert-detail" style="margin-top: 10px;">+${escapeHtml(
                        alert.extraCount
                      )} Listings available</div>`
                    : ""
                }
                <div class="alert-detail">Last updated ${escapeHtml(formatDateTime(alert.lastUpdated))}</div>
              </article>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderListingTable(slot) {
    if (!slot.occupied) {
      return `
        <div class="empty-state">
          This slot is empty. Desktop Viewer v1 shows all six slots so you can monitor occupancy at a glance.
        </div>
      `;
    }

    if (!Array.isArray(slot.currentListings) || slot.currentListings.length === 0) {
      const listingState = describeSlotDataState(slot);
      return `
        <div class="empty-state ${escapeHtml(listingState.tone)}">
          <strong>${escapeHtml(listingState.label)}</strong><br />
          ${escapeHtml(listingState.detail)}
        </div>
      `;
    }

    if (slot.sourceMode === "BAZAAR_ONLY") {
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
              ${slot.currentListings
                .map(
                  (listing) => `
                    <tr>
                      <td>${escapeHtml(
                        listing.playerName ||
                          (listing.playerId ? `Player ${listing.playerId}` : "Seller unavailable")
                      )}</td>
                      <td>${escapeHtml(formatMoney(listing.price))}</td>
                      <td>${escapeHtml(listing.quantity ?? "--")}</td>
                      <td>${escapeHtml(formatTime(listing.contentUpdated || listing.lastChecked))}</td>
                      <td>${
                        listing.bazaarUrl
                          ? `<a class="listing-action" href="${escapeHtml(
                              listing.bazaarUrl
                            )}" target="_blank" rel="noopener">Open Bazaar</a>`
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
            ${slot.currentListings
              .map(
                (listing) => `
                  <tr>
                    <td>${escapeHtml(formatMoney(listing.price))}</td>
                    <td>${escapeHtml(listing.quantity ?? "--")}</td>
                    <td>${escapeHtml(formatTime(listing.contentUpdated || listing.lastChecked))}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderDetail(slot) {
    if (!slot) {
      return `
        <div class="empty-state">
          Select a slot to inspect its listing detail view.
        </div>
      `;
    }

    const listingState = describeSlotDataState(slot);
    const bestListing = currentBestListing(slot);

    return `
      <div class="detail-stack">
        <section class="detail-header">
          <h2>${slot.occupied ? escapeHtml(slot.itemName) : `Slot ${escapeHtml(slot.slotNumber)}`}</h2>
          <p>${
            slot.occupied
              ? `Slot ${escapeHtml(slot.slotNumber)} | Item ${escapeHtml(slot.itemId)} | ${escapeHtml(
                  sourceShortLabel(slot.sourceMode)
                )}`
              : "Empty slot ready for a new watch item"
          }</p>
          <div class="badge-row" style="justify-content:flex-start; margin-top: 10px;">
            <span class="badge source">${escapeHtml(sourceShortLabel(slot.sourceMode))}</span>
            <span class="badge ${escapeHtml(trackerStatusBadgeClass(slot))}">${escapeHtml(
              slot.trackerStatusLabel || slot.trackerStatus || "EMPTY"
            )}</span>
          </div>
          ${
            slot.occupied
              ? `<div class="detail-actions">
                  ${
                    slot.links?.tornMarket && slot.sourceMode !== "BAZAAR_ONLY"
                      ? `<button class="button secondary" data-open-link="${escapeHtml(
                          slot.links.tornMarket
                        )}">Open Market</button>`
                      : ""
                  }
                  <button class="button secondary" data-action="refresh-now">Refresh Snapshot</button>
                </div>`
              : ""
          }
        </section>

        <section class="meta-grid">
          <div class="meta-card">
            <span class="label">Target Price</span>
            <span class="value">${formatMoney(slot.targetPrice)}</span>
          </div>
          <div class="meta-card">
            <span class="label">Near-Miss Gap</span>
            <span class="value">${formatMoney(slot.nearMissGap)}</span>
          </div>
          <div class="meta-card">
            <span class="label">Current Status</span>
            <span class="value">${escapeHtml(slot.trackerStatusLabel || slot.trackerStatus || "EMPTY")}</span>
          </div>
          <div class="meta-card">
            <span class="label">Current Best Listing</span>
            <span class="value">${escapeHtml(currentBestPriceLabel(slot))}</span>
          </div>
          <div class="meta-card">
            <span class="label">Watching Enabled</span>
            <span class="value">${slot.occupied ? (slot.enabled ? "Yes" : "No") : "--"}</span>
          </div>
          <div class="meta-card">
            <span class="label">Desktop Notifications</span>
            <span class="value">Not in v1</span>
          </div>
        </section>

        <section class="slot-note ${escapeHtml(listingState.tone)}">
          <strong>${escapeHtml(listingState.label)}</strong><br />
          ${escapeHtml(listingState.detail)}
        </section>

        <section class="panel" style="padding: 14px;">
          <div class="panel-head">
            <div>
              <h3>Recent Alert</h3>
              <div class="panel-subtitle">Current or most recent interesting deal for this slot</div>
            </div>
          </div>
          ${
            slot.notification || bestListing
              ? `<div class="alert-card">
                  <div class="alert-title">${escapeHtml(alertHeadlineForSlot(slot))}</div>
                  ${
                    (slot.qualifyingListings?.length || 0) > 1
                      ? `<div class="alert-detail">+${escapeHtml(
                          (slot.qualifyingListings?.length || 0) - 1
                        )} Listings available</div>`
                      : ""
                  }
                  <div class="alert-detail">Last updated ${escapeHtml(
                    formatDateTime(slot.notification?.timestamp || slot.lastChecked)
                  )}</div>
                </div>`
              : `<div class="empty-state">No alert has been recorded for this slot yet.</div>`
          }
        </section>

        <section>
          <div class="panel-head">
            <div>
              <h3>${slot.sourceMode === "BAZAAR_ONLY" ? "Bazaar Listings" : "Market Listings"}</h3>
              <div class="panel-subtitle">Source-specific live listing view with more room than TornPDA.</div>
            </div>
          </div>
          ${renderListingTable(slot)}
        </section>

        <section class="panel" style="padding: 14px;">
          <div class="panel-head">
            <div>
              <h3>Update Details</h3>
              <div class="panel-subtitle">Useful backend timestamps for diagnosing watcher state</div>
            </div>
          </div>
          <div class="meta-grid">
            <div class="meta-card">
              <span class="label">Last Checked</span>
              <span class="value">${escapeHtml(formatDateTime(slot.lastChecked))}</span>
            </div>
            <div class="meta-card">
              <span class="label">Last Attempted</span>
              <span class="value">${escapeHtml(formatDateTime(slot.lastAttemptedAt))}</span>
            </div>
            <div class="meta-card">
              <span class="label">Lowest Price</span>
              <span class="value">${escapeHtml(formatMoney(slot.lowestPrice))}</span>
            </div>
            <div class="meta-card">
              <span class="label">Lowest Above Target</span>
              <span class="value">${escapeHtml(formatMoney(slot.lowestAboveTarget))}</span>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  function render() {
    if (!state.appRoot) {
      return;
    }

    const slots = getSlots();
    const selectedSlotNumber = chooseSelectedSlot(slots, state.selectedSlotNumber);
    const selectedSlot = slots.find((slot) => slot.slotNumber === selectedSlotNumber) || null;
    const summary = state.slotsPayload?.summary || state.statusPayload?.status || {};
    const runtimeStatus = state.statusPayload?.status || state.slotsPayload?.status || {};

    state.selectedSlotNumber = selectedSlotNumber;

    state.appRoot.innerHTML = `
      <header class="viewer-header">
        <div class="viewer-title">
          <h1>Desktop Viewer v1</h1>
          <p>
            Desktop-first monitoring for the same Torn market watcher backend. This view keeps all 6 slots visible,
            expands listing detail, and preserves the backend as the single source of truth.
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
          <button class="button" data-action="refresh-now" ${state.syncInFlight ? "disabled" : ""}>
            ${state.syncInFlight
              ? "Refreshing..."
              : runtimeStatus.watchingActive && runtimeStatus.activeEnabledCount > 0
                ? "Refresh Now"
                : "Reload View"}
          </button>
        </div>
      </header>

      ${renderTopStatus(slots)}

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

      <main class="layout-grid" style="margin-top: 18px;">
        <section>
          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Watched Slots</h2>
                <div class="panel-subtitle">
                  All 6 slots stay visible. Occupied slots surface key pricing and backend status at a glance.
                </div>
              </div>
          <div class="panel-subtitle">
            ${escapeHtml(summary.occupiedCount ?? 0)} occupied / ${escapeHtml(
              summary.slotLimit ?? 6
            )} total
          </div>
        </div>
        ${
          !state.syncInFlight && !state.slotsPayload?.slots?.length
            ? `<div class="empty-state" style="margin-bottom: 16px;">
                No slot data available from the backend yet. The viewer is showing all 6 slot placeholders until /api/slots responds.
              </div>`
            : ""
        }
        <div class="slot-grid">
          ${slots.map((slot) => renderSlotCard(slot)).join("")}
        </div>
      </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Active Alerts</h2>
                <div class="panel-subtitle">
                  Current BUY NOW and near-miss opportunities in a denser desktop format.
                </div>
              </div>
            </div>
            ${renderAlerts(slots)}
          </section>
        </section>

        <aside class="panel">
          <div class="panel-head">
            <div>
              <h2>Selected Slot Detail</h2>
              <div class="panel-subtitle">
                Click any slot to inspect its source-specific listing table, recent alert, and update state.
              </div>
            </div>
          </div>
          ${renderDetail(selectedSlot)}
        </aside>
      </main>

      <div class="footer-note">
        Desktop Viewer v1 is intentionally lightweight: no charts, no predictors, and no heavy analytics yet.
      </div>
    `;

    state.appRoot.querySelectorAll("[data-slot-select]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedSlotNumber = Number(button.getAttribute("data-slot-select"));
        render();
      });
    });

    state.appRoot.querySelectorAll('[data-action="refresh-now"]').forEach((button) => {
      button.addEventListener("click", () => {
        syncData({
          manualRefresh: Boolean(
            (state.statusPayload?.status || state.slotsPayload?.status)?.watchingActive &&
              (state.statusPayload?.status || state.slotsPayload?.status)?.activeEnabledCount > 0
          )
        });
      });
    });

    state.appRoot.querySelectorAll("[data-open-link]").forEach((button) => {
      button.addEventListener("click", () => {
        openExternal(button.getAttribute("data-open-link"));
      });
    });
  }

  function init() {
    state.appRoot = document.getElementById("app");

    if (!state.appRoot) {
      throw new Error("Desktop viewer app root was not found.");
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
      render();
    }, STATUS_REFRESH_MS);
  }

  return {
    init,
    __test: {
      chooseSelectedSlot,
      buildAlertEntries,
      deriveNextCheckLabel,
      deriveNextAlertLabel,
      deriveOverallWatcherStatus,
      describeSlotDataState,
      currentBestPriceLabel
    }
  };
});
