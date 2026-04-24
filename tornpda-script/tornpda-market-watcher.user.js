// ==UserScript==
// @name         TornPDA Market Watcher
// @namespace    https://weav3r.dev/
// @version      1.8.6
// @description  Displays processed Torn market watch alerts inside TornPDA with manual controls, item-name resolution, and compact mobile UI.
// @author       Codex
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEYS = {
    backendUrl: "tornpdaMarketWatcher.backendUrl",
    seenEvents: "tornpdaMarketWatcher.seenEvents",
    uiState: "tornpdaMarketWatcher.uiState",
    cachedCollection: "tornpdaMarketWatcher.cachedCollection"
  };
  const SESSION_KEYS = {
    collapsed: "tornpdaMarketWatcher.collapsed",
    viewMode: "tornpdaMarketWatcher.viewMode"
  };
  const PANEL_ID = "tornpda-market-watcher-panel";
  const BANNER_ID = "tornpda-market-watcher-banner";
  const POLL_INTERVAL_MS = 10000;
  const REQUEST_TIMEOUT_MS = 8000;
  const RECENT_ALERT_WINDOW_MS = 45000;
  const DEBUG_LOG_LIMIT = 24;
  const FLUTTER_READY_EVENT = "flutterInAppWebViewPlatformReady";
  const EXAMPLE_BACKEND_URL = "http://YOUR-LAN-IP:3000";
  const EMPTY_CONNECTION_MESSAGE = `Enter the backend base URL only. Example: ${EXAMPLE_BACKEND_URL}`;
  const DEFAULT_SETTINGS = {
    alertCooldownMs: 120000,
    snapshotGroupingWindowMs: 30000
  };
  const HIDDEN_LAUNCHER_OFFSET_PX = 12;
  const AUTO_RESTORE_STALE_MS = 15000;
  const TIMER_TICK_MS = 1000;
  const SOURCE_MODES = {
    MARKET_ONLY: "MARKET_ONLY",
    BAZAAR_ONLY: "BAZAAR_ONLY"
  };
  const SCRIPT_VERSION_FALLBACK = "1.8.6";
  const MINIMUM_COMPATIBLE_BACKEND_VERSION = "1.8.1";
  const ACTIVITY_LOG_LIMIT = 40;

  function extractUserscriptMetadataVersion(source) {
    const match = String(source || "").match(/^\s*\/\/\s*@version\s+([^\s]+)\s*$/m);
    return match?.[1]?.trim() || null;
  }

  function detectInstalledScriptVersion() {
    const candidateSources = [];

    if (document.currentScript?.textContent) {
      candidateSources.push(document.currentScript.textContent);
    }

    document.querySelectorAll("script").forEach((script) => {
      const text = script?.textContent || "";

      if (
        text &&
        (text.includes("// ==UserScript==") || text.includes('const PANEL_ID = "tornpda-market-watcher-panel"'))
      ) {
        candidateSources.push(text);
      }
    });

    for (const source of candidateSources) {
      const version = extractUserscriptMetadataVersion(source);

      if (version) {
        return version;
      }
    }

    return null;
  }

  const SCRIPT_VERSION = detectInstalledScriptVersion() || SCRIPT_VERSION_FALLBACK;

  function createFormState() {
    return {
      mode: null,
      slotNumber: null,
      itemId: "",
      itemName: "",
      targetPrice: "",
      nearMissGap: "",
      sourceMode: SOURCE_MODES.MARKET_ONLY,
      enabled: true,
      busy: false,
      error: null
    };
  }

  function createSettingsFormState(settings = DEFAULT_SETTINGS) {
    return {
      alertCooldownSeconds: String(Math.round((settings.alertCooldownMs || 0) / 1000)),
      snapshotGroupingWindowSeconds: String(
        Math.round((settings.snapshotGroupingWindowMs || 0) / 1000)
      ),
      busy: false,
      error: null
    };
  }

  function createEndpointState(name, url) {
    return {
      name,
      url,
      state: "idle",
      transport: null,
      status: null,
      message: "Not tested yet.",
      responseSnippet: null,
      rawError: null
    };
  }

  function createConnectionState() {
    return {
      status: "idle",
      message: EMPTY_CONNECTION_MESSAGE,
      details: null,
      checkedAt: null,
      tests: {
        health: createEndpointState("health", null),
        status: createEndpointState("status", null),
        slots: createEndpointState("slots", null)
      }
    };
  }

  function createWatcherState() {
    return {
      active: false,
      polling: false,
      status: "INACTIVE",
      timerId: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastSuccessfulAt: null,
      lastError: null,
      lastSkippedAt: null,
      lastReason: null
    };
  }

  function createRequestState() {
    return {
      connectionTest: false,
      manualRefresh: false,
      slotsReload: false,
      restoreSync: false,
      resetAll: false,
      exportSettings: false,
      importSettings: false,
      slotAction: null,
      slotToggle: null
    };
  }

  function createUiState(overrides = {}) {
    return {
      collapsed: true,
      viewMode: "full",
      expandedListingSlots: {},
      appNotificationsEnabled: true,
      activityExpanded: false,
      ...overrides
    };
  }

  function createCompatibilityState() {
    return {
      scriptVersion: SCRIPT_VERSION,
      backendVersion: null,
      minimumCompatibleBackendVersion: MINIMUM_COMPATIBLE_BACKEND_VERSION,
      minimumCompatibleScriptVersion: null,
      compatible: true,
      warning: null
    };
  }

  function createBackupDialogState() {
    return {
      mode: null,
      title: "",
      text: "",
      error: null,
      busy: false
    };
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function trimToLimit(list, limit) {
    return list.slice(Math.max(0, list.length - limit));
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
    if (value === null || value === undefined) {
      return "--";
    }

    return `$${Number(value).toLocaleString()}`;
  }

  function formatTimestamp(value) {
    if (!value) {
      return "--";
    }

    const date = new Date(value);
    return date.toLocaleTimeString([], {
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

  function normalizeVersionParts(version) {
    return String(version || "")
      .trim()
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .slice(0, 3)
      .concat([0, 0, 0])
      .slice(0, 3)
      .map((part) => (Number.isFinite(part) ? part : 0));
  }

  function compareVersions(left, right) {
    const leftParts = normalizeVersionParts(left);
    const rightParts = normalizeVersionParts(right);

    for (let index = 0; index < 3; index += 1) {
      if (leftParts[index] > rightParts[index]) {
        return 1;
      }

      if (leftParts[index] < rightParts[index]) {
        return -1;
      }
    }

    return 0;
  }

  function isVersionAtLeast(actualVersion, minimumVersion) {
    return compareVersions(actualVersion, minimumVersion) >= 0;
  }

  function shortenText(value, limit = 160) {
    const text = String(value ?? "").trim();

    if (!text) {
      return null;
    }

    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  }

  function normalizeSourceMode(value) {
    return value === SOURCE_MODES.BAZAAR_ONLY ? SOURCE_MODES.BAZAAR_ONLY : SOURCE_MODES.MARKET_ONLY;
  }

  function sourceModeLabel(value) {
    return normalizeSourceMode(value) === SOURCE_MODES.BAZAAR_ONLY ? "Bazaar Only" : "Market Only";
  }

  function sourceModeShortLabel(value) {
    return normalizeSourceMode(value) === SOURCE_MODES.BAZAAR_ONLY ? "Bazaar" : "Market";
  }

  function slotSourceMode(slot) {
    return normalizeSourceMode(slot?.sourceMode || slot?.market?.sourceMode);
  }

  function isBazaarMode(slot) {
    return slotSourceMode(slot) === SOURCE_MODES.BAZAAR_ONLY;
  }

  function listingPanelLabel(slot) {
    return isBazaarMode(slot) ? "Bazaar Listings" : "Market Listings";
  }

  function trackedListingNoun(slot) {
    return isBazaarMode(slot) ? "bazaar listing" : "market listing";
  }

  function notificationSourceLabel(notification, slot = null) {
    if (notification?.sourceLabel) {
      return notification.sourceLabel;
    }

    if (notification?.listing?.sourceLabel) {
      return notification.listing.sourceLabel;
    }

    return sourceModeLabel(slotSourceMode(slot));
  }

  function notificationSourceShortLabel(notification, slot = null) {
    return notificationSourceLabel(notification, slot) === "Bazaar Only" ? "Bazaar" : "Market";
  }

  function formatListingOwner(listing) {
    if (!listing) {
      return null;
    }

    const playerName = String(listing.playerName || "").trim();

    if (playerName) {
      return playerName;
    }

    if (Number.isFinite(Number(listing.playerId))) {
      return `Player ${listing.playerId}`;
    }

    return null;
  }

  function notificationAdditionalListingCount(notification) {
    const listingCount = Number(notification?.listingCount) || notification?.listings?.length || 0;
    return listingCount > 1 ? listingCount - 1 : 0;
  }

  function formatPriceComparison(targetPrice, listedPrice, quantity) {
    const safeQuantity = Math.max(1, Number(quantity) || 1);

    if (targetPrice === null || targetPrice === undefined) {
      return formatMoney(listedPrice);
    }

    if (safeQuantity >= 2 && Number.isFinite(Number(listedPrice))) {
      return `${formatMoney(targetPrice)}>${formatMoney(listedPrice)}(${formatMoney(
        Number(listedPrice) * safeQuantity
      )})`;
    }

    return `${formatMoney(targetPrice)}>${formatMoney(listedPrice)}`;
  }

  function formatNotificationHeadline(notification, slot = null) {
    if (!notification) {
      return "";
    }

    const sourceLabel = notificationSourceShortLabel(notification, slot);
    const quantity = Number(notification?.listing?.quantity) || 1;
    const quantityLabel = `${quantity}x`;
    const itemName = slot?.itemName || notification?.listing?.itemName || "Item";
    const targetPrice = slot?.targetPrice ?? notification?.targetPrice ?? null;

    return `[${sourceLabel}] ${quantityLabel} ${itemName} ${formatPriceComparison(
      targetPrice,
      notification.price,
      quantity
    )}`;
  }

  function formatNotificationDetails(notification, slot = null) {
    if (!notification) {
      return "";
    }

    const headline = formatNotificationHeadline(notification, slot);
    const extraCount = notificationAdditionalListingCount(notification);

    if (extraCount > 0) {
      return `${headline}\n+${extraCount} Listings available`;
    }

    return headline;
  }

  function listingDisplayOwner(listing) {
    const owner = formatListingOwner(listing);

    if (owner) {
      return owner;
    }

    if (Number.isFinite(Number(listing?.listingId))) {
      return `Listing ${listing.listingId}`;
    }

    return "Seller unavailable";
  }

  function formatListingUpdated(listing) {
    const rawValue = listing?.contentUpdated ?? listing?.lastChecked ?? null;

    if (rawValue === null || rawValue === undefined) {
      return null;
    }

    const numeric = Number(rawValue);

    if (Number.isFinite(numeric)) {
      const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit"
        });
      }
    }

    return formatTimestamp(rawValue);
  }

  function serializeError(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack || null
      };
    }

    return {
      name: typeof error,
      message: String(error)
    };
  }

  function isLocalHostName(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1";
  }

  function stripKnownApiSuffix(pathname) {
    const suffixes = ["/api/status", "/api/slots", "/api/watches", "/health", "/api"];

    for (const suffix of suffixes) {
      if (pathname === suffix) {
        return "/";
      }

      if (pathname.endsWith(suffix)) {
        const stripped = pathname.slice(0, -suffix.length);
        return stripped || "/";
      }
    }

    return pathname || "/";
  }

  function normalizeBackendUrlInput(rawInput) {
    const trimmed = String(rawInput || "").trim();

    if (!trimmed) {
      return {
        ok: false,
        code: "empty",
        error: EMPTY_CONNECTION_MESSAGE
      };
    }

    let candidate = trimmed;
    const notes = [];

    if (!/^https?:\/\//i.test(candidate)) {
      candidate = `http://${candidate}`;
      notes.push("Added http:// automatically.");
    }

    let parsed;

    try {
      parsed = new URL(candidate);
    } catch (error) {
      return {
        ok: false,
        code: "bad_url_format",
        error: `Bad URL format. Enter the backend base URL only, like ${EXAMPLE_BACKEND_URL}.`
      };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        ok: false,
        code: "bad_url_format",
        error: "Bad URL format. Only http:// or https:// URLs are supported."
      };
    }

    const originalPath = parsed.pathname.replace(/\/+$/, "") || "/";
    const normalizedPath = stripKnownApiSuffix(originalPath);

    if (normalizedPath !== originalPath) {
      notes.push(
        `Removed ${originalPath} because the field expects the base URL only, not a full endpoint path.`
      );
    }

    parsed.pathname = normalizedPath === "/" ? "/" : normalizedPath;
    parsed.search = "";
    parsed.hash = "";

    const baseUrl = parsed.toString().replace(/\/+$/, "");

    if (isLocalHostName(parsed.hostname)) {
      notes.push(
        "localhost or 127.0.0.1 only works on the same device. In TornPDA on your phone, use your computer's LAN IP instead."
      );
    }

    return {
      ok: true,
      baseUrl,
      notes,
      hostname: parsed.hostname
    };
  }

  function buildApiUrl(baseUrl, endpointPath) {
    try {
      return new URL(endpointPath.replace(/^\//, ""), `${baseUrl.replace(/\/+$/, "")}/`).toString();
    } catch (error) {
      return null;
    }
  }

  function sanitizeExpandedListingSlots(value) {
    if (!value || typeof value !== "object") {
      return {};
    }

    return Object.entries(value).reduce((accumulator, [slotNumber, expanded]) => {
      const normalizedSlotNumber = Number.parseInt(slotNumber, 10);

      if (!Number.isInteger(normalizedSlotNumber) || normalizedSlotNumber < 1) {
        return accumulator;
      }

      accumulator[normalizedSlotNumber] = Boolean(expanded);
      return accumulator;
    }, {});
  }

  function loadStoredUiState() {
    const parsed = safeJsonParse(localStorage.getItem(STORAGE_KEYS.uiState) || "null", null);

    if (parsed && typeof parsed === "object") {
      return createUiState({
        // Startup should stay closed even if a prior session ended with the menu open.
        collapsed: true,
        viewMode: parsed.viewMode === "compact" ? "compact" : "full",
        expandedListingSlots: {},
        appNotificationsEnabled: parsed.appNotificationsEnabled !== false,
        activityExpanded: parsed.activityExpanded === true
      });
    }

    return createUiState({
      collapsed: true,
      viewMode: sessionStorage.getItem(SESSION_KEYS.viewMode) === "compact" ? "compact" : "full",
      expandedListingSlots: {},
      appNotificationsEnabled: true,
      activityExpanded: false
    });
  }

  function loadCachedCollection(baseUrl) {
    const parsed = safeJsonParse(localStorage.getItem(STORAGE_KEYS.cachedCollection) || "null", null);

    if (!parsed || typeof parsed !== "object" || !parsed.payload || typeof parsed.payload !== "object") {
      return null;
    }

    const cachedBackend = normalizeBackendUrlInput(parsed.backendUrl || "");
    const currentBackend = normalizeBackendUrlInput(baseUrl || "");

    if (currentBackend.ok && cachedBackend.ok && cachedBackend.baseUrl !== currentBackend.baseUrl) {
      return null;
    }

    return {
      backendUrl: cachedBackend.ok ? cachedBackend.baseUrl : parsed.backendUrl || "",
      lastFetchAt: parsed.lastFetchAt || null,
      payload: parsed.payload
    };
  }

  function hasCachedSlotData(cachedCollection) {
    return Boolean(
      cachedCollection &&
        Array.isArray(cachedCollection.payload?.slots) &&
        cachedCollection.payload.slots.some((slot) => slot && slot.occupied)
    );
  }

  function shouldSyncCachedState(lastFetchAt) {
    if (!lastFetchAt) {
      return true;
    }

    const ageMs = Date.now() - Date.parse(lastFetchAt);

    if (!Number.isFinite(ageMs)) {
      return true;
    }

    return ageMs > AUTO_RESTORE_STALE_MS;
  }

  function hasNativeTornPdaHandler() {
    return Boolean(
      window.flutter_inappwebview &&
        typeof window.flutter_inappwebview.callHandler === "function"
    );
  }

  const initialBackend = normalizeBackendUrlInput(
    localStorage.getItem(STORAGE_KEYS.backendUrl) || ""
  );
  const storedUiState = loadStoredUiState();
  const cachedCollection = loadCachedCollection(
    initialBackend.ok ? initialBackend.baseUrl : localStorage.getItem(STORAGE_KEYS.backendUrl) || ""
  );

  let state = {
    backendInput: initialBackend.ok ? initialBackend.baseUrl : localStorage.getItem(STORAGE_KEYS.backendUrl) || "",
    backendUrl: initialBackend.ok ? initialBackend.baseUrl : "",
    seenEvents: safeJsonParse(localStorage.getItem(STORAGE_KEYS.seenEvents) || "{}", {}),
    slots: [],
    summary: null,
    status: null,
    versions: createCompatibilityState(),
    activityLog: [],
    lastError: initialBackend.ok ? null : initialBackend.error || null,
    lastFetchAt: cachedCollection?.lastFetchAt || null,
    settings: {
      ...DEFAULT_SETTINGS
    },
    settingsForm: createSettingsFormState(DEFAULT_SETTINGS),
    ui: storedUiState,
    requests: createRequestState(),
    connection: createConnectionState(),
    watcher: createWatcherState(),
    form: createFormState(),
    backupDialog: createBackupDialogState(),
    runtime: {
      nativeReady: hasNativeTornPdaHandler(),
      lastTransport: hasNativeTornPdaHandler() ? "tornpda_handler" : "fetch",
      restoredFromCache: false,
      restoreSource: "none",
      initialRestorePending: Boolean(initialBackend.ok),
      autoRestoreReason: null,
      lastRestoreAttemptAt: null,
      menuScrollTop: 0
    },
    debugLog: []
  };

  if (cachedCollection) {
    restoreCachedCollectionIntoState(cachedCollection);
  }

  state.runtime.initialRestorePending =
    Boolean(initialBackend.ok) &&
    (!state.runtime.restoredFromCache || shouldSyncCachedState(state.lastFetchAt));

  persistUiState();

  function pushDebugLog(level, message, context = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };

    state.debugLog = trimToLimit([...state.debugLog, entry], DEBUG_LOG_LIMIT);

    const line = `[TornPDA Market Watcher] ${message}`;

    if (level === "error") {
      console.error(line, context);
    } else if (level === "warn") {
      console.warn(line, context);
    } else {
      console.log(line, context);
    }
  }

  function saveSeenEvents() {
    localStorage.setItem(STORAGE_KEYS.seenEvents, JSON.stringify(state.seenEvents));
  }

  function persistUiState() {
    const payload = {
      collapsed: Boolean(state.ui.collapsed),
      viewMode: state.ui.viewMode === "compact" ? "compact" : "full",
      appNotificationsEnabled: state.ui.appNotificationsEnabled !== false,
      activityExpanded: state.ui.activityExpanded === true
    };

    localStorage.setItem(STORAGE_KEYS.uiState, JSON.stringify(payload));
    sessionStorage.setItem(SESSION_KEYS.collapsed, String(payload.collapsed));
    sessionStorage.setItem(SESSION_KEYS.viewMode, payload.viewMode);
  }

  function buildCachedCollectionPayload() {
    return {
      backendUrl: state.backendUrl || state.backendInput || "",
      lastFetchAt: state.lastFetchAt || null,
      payload: {
        summary: state.summary || null,
        status: state.status || null,
        settings: state.settings || null,
        activityLog: Array.isArray(state.activityLog) ? state.activityLog : [],
        slots: Array.isArray(state.slots) ? state.slots : []
      }
    };
  }

  function persistCachedCollection() {
    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok || !Array.isArray(state.slots) || state.slots.length === 0) {
      return;
    }

    localStorage.setItem(
      STORAGE_KEYS.cachedCollection,
      JSON.stringify({
        ...buildCachedCollectionPayload(),
        backendUrl: normalized.baseUrl
      })
    );
  }

  function restoreCachedCollectionIntoState(cached) {
    if (!cached || !cached.payload) {
      return false;
    }

    applySlotsPayload(
      {
        ...cached.payload,
        versions: null
      },
      cached.lastFetchAt || new Date().toISOString()
    );
    state.runtime.restoredFromCache = hasCachedSlotData(cached);
    state.runtime.restoreSource = state.runtime.restoredFromCache ? "cache" : "empty_cache";
    return state.runtime.restoredFromCache;
  }

  function persistBackendUrl(baseUrl) {
    state.backendUrl = baseUrl;
    state.backendInput = baseUrl;
    localStorage.setItem(STORAGE_KEYS.backendUrl, baseUrl);
  }

  function setCollapsed(value) {
    const panel = document.getElementById(PANEL_ID);

    if (panel && value) {
      state.runtime.menuScrollTop = panel.scrollTop || 0;
    }

    state.ui.collapsed = Boolean(value);
    persistUiState();
    render();

    if (!state.ui.collapsed) {
      const reopenedPanel = document.getElementById(PANEL_ID);
      if (reopenedPanel) {
        reopenedPanel.scrollTop = 0;
      }
      state.runtime.menuScrollTop = 0;
      void maybeRestoreAndSync({ reason: "open_menu", force: true });
    }
  }

  function setViewMode(mode) {
    state.ui.viewMode = mode === "compact" ? "compact" : "full";
    persistUiState();
    closeSlotForm();
    render();
  }

  function syncSettings(settings, { resetForm = true } = {}) {
    if (!settings) {
      return;
    }

    state.settings = {
      alertCooldownMs: Number.isFinite(Number(settings.alertCooldownMs))
        ? Number(settings.alertCooldownMs)
        : state.settings.alertCooldownMs,
      snapshotGroupingWindowMs: Number.isFinite(Number(settings.snapshotGroupingWindowMs))
        ? Number(settings.snapshotGroupingWindowMs)
        : state.settings.snapshotGroupingWindowMs
    };

    if (resetForm) {
      state.settingsForm = createSettingsFormState(state.settings);
    }
  }

  function syncCompatibility(versions) {
    const backendVersion = String(versions?.backendVersion || "").trim() || null;
    const minimumCompatibleScriptVersion =
      String(versions?.minimumCompatibleScriptVersion || "").trim() || null;
    const scriptVersion = detectInstalledScriptVersion() || SCRIPT_VERSION;
    let compatible = true;
    let warning = null;

    if (backendVersion && !isVersionAtLeast(backendVersion, MINIMUM_COMPATIBLE_BACKEND_VERSION)) {
      compatible = false;
      warning = `Version mismatch: backend ${backendVersion} is older than the minimum supported ${MINIMUM_COMPATIBLE_BACKEND_VERSION}. Please update backend or script.`;
    }

    if (
      compatible &&
      minimumCompatibleScriptVersion &&
      !isVersionAtLeast(scriptVersion, minimumCompatibleScriptVersion)
    ) {
      compatible = false;
      warning = `Version mismatch: script ${scriptVersion} is older than the backend requirement ${minimumCompatibleScriptVersion}. Please update backend or script.`;
    }

    state.versions = {
      scriptVersion,
      backendVersion,
      minimumCompatibleBackendVersion: MINIMUM_COMPATIBLE_BACKEND_VERSION,
      minimumCompatibleScriptVersion,
      compatible,
      warning
    };
  }

  function featuresBlockedByCompatibility() {
    return Boolean(state.versions && state.versions.compatible === false);
  }

  function compatibilityWarning() {
    return state.versions?.warning || null;
  }

  function clearWatcherTimer() {
    if (state.watcher.timerId !== null) {
      window.clearInterval(state.watcher.timerId);
      state.watcher.timerId = null;
    }
  }

  function syncWatcherFromStatus(status) {
    clearWatcherTimer();

    const active = status?.watchingActive === true;
    const polling = status?.polling === true;
    const watcherStatus =
      String(status?.watcherStatus || "").trim() ||
      (polling || active ? "WATCHING" : "INACTIVE");

    state.watcher = {
      ...state.watcher,
      active,
      polling,
      status: watcherStatus,
      timerId: null,
      lastStartedAt: status?.lastPollStartedAt || null,
      lastCompletedAt: status?.lastPollCompletedAt || null,
      lastSuccessfulAt: status?.lastPollCompletedAt || null,
      lastError: status?.lastError || null,
      lastReason: status?.lastPollReason || null
    };
  }

  function getWatcherReadiness() {
    if (featuresBlockedByCompatibility()) {
      return {
        canStart: false,
        reason: compatibilityWarning(),
        normalized: null
      };
    }

    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok) {
      return {
        canStart: false,
        reason: normalized.error,
        normalized: null
      };
    }

    if (state.connection.status === "error") {
      return {
        canStart: false,
        reason: "Connection test is currently failing. Fix the backend URL or rerun Connection Test before starting.",
        normalized
      };
    }

    return {
      canStart: true,
      reason: null,
      normalized
    };
  }

  async function ensureNativeTransportReady(timeoutMs = 1000) {
    if (hasNativeTornPdaHandler()) {
      state.runtime.nativeReady = true;
      return true;
    }

    return new Promise((resolve) => {
      let settled = false;

      function finish(value) {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutHandle);
        window.removeEventListener(FLUTTER_READY_EVENT, readyListener);
        state.runtime.nativeReady = value && hasNativeTornPdaHandler();
        resolve(state.runtime.nativeReady);
      }

      function readyListener() {
        finish(true);
      }

      const timeoutHandle = window.setTimeout(() => finish(false), timeoutMs);
      window.addEventListener(FLUTTER_READY_EVENT, readyListener, { once: true });
    });
  }

  function markConnectionTests(partial) {
    state.connection.tests = {
      ...state.connection.tests,
      ...partial
    };
  }

  function classifyNetworkError(error, url, transport) {
    const serialized = serializeError(error);
    const message = String(serialized.message || "");

    if (message.toLowerCase().includes("timed out") || serialized.name === "AbortError") {
      return {
        code: "timeout",
        message: `Timeout while requesting ${url}.`,
        rawError: serialized
      };
    }

    if (message.toLowerCase().includes("load failed")) {
      return {
        code: "network_error",
        message: `Network error while requesting ${url}. TornPDA reported "load failed".`,
        rawError: serialized
      };
    }

    return {
      code: transport === "tornpda_handler" ? "native_request_error" : "network_error",
      message: `Request failed for ${url}. ${serialized.message}`,
      rawError: serialized
    };
  }

  function withTimeout(promise, timeoutMs, timeoutMessage) {
    return new Promise((resolve, reject) => {
      const timeoutHandle = window.setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      Promise.resolve(promise)
        .then((value) => {
          window.clearTimeout(timeoutHandle);
          resolve(value);
        })
        .catch((error) => {
          window.clearTimeout(timeoutHandle);
          reject(error);
        });
    });
  }

  async function performHttpRequest({ url, method = "GET", headers = {}, body = null }) {
    const nativeAvailable = await ensureNativeTransportReady();
    const transport = nativeAvailable ? "tornpda_handler" : "fetch";
    state.runtime.lastTransport = transport;
    pushDebugLog("info", "HTTP request starting", {
      url,
      method,
      transport
    });

    if (transport === "tornpda_handler") {
      try {
        const raw = await withTimeout(
          method === "POST"
            ? window.flutter_inappwebview.callHandler(
                "PDA_httpPost",
                url,
                headers,
                body || ""
              )
            : window.flutter_inappwebview.callHandler("PDA_httpGet", url, headers),
          REQUEST_TIMEOUT_MS,
          `Timed out while waiting for TornPDA native request handler for ${url}.`
        );

        pushDebugLog("info", "HTTP request completed", {
          url,
          method,
          transport,
          status: raw?.status ?? null
        });

        return {
          transport,
          url,
          status: Number.parseInt(raw?.status, 10) || null,
          statusText: raw?.statusText || "",
          text: String(raw?.responseText || ""),
          raw
        };
      } catch (error) {
        const classified = classifyNetworkError(error, url, transport);
        pushDebugLog("error", "HTTP request threw", {
          url,
          method,
          transport,
          error: classified
        });

        return {
          transport,
          url,
          status: null,
          statusText: "",
          text: "",
          raw: null,
          error: classified
        };
      }
    }

    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        cache: "no-store",
        signal: controller.signal
      });
      const text = await response.text();

      pushDebugLog("info", "HTTP request completed", {
        url,
        method,
        transport,
        status: response.status
      });

      return {
        transport,
        url,
        status: response.status,
        statusText: response.statusText,
        text,
        raw: null
      };
    } catch (error) {
      const classified = classifyNetworkError(error, url, transport);
      pushDebugLog("error", "HTTP request threw", {
        url,
        method,
        transport,
        error: classified
      });

      return {
        transport,
        url,
        status: null,
        statusText: "",
        text: "",
        raw: null,
        error: classified
      };
    } finally {
      window.clearTimeout(timeoutHandle);
    }
  }

  async function requestText(url) {
    const response = await performHttpRequest({ url, method: "GET" });

    if (response.error) {
      return {
        ok: false,
        url,
        transport: response.transport,
        status: null,
        error: response.error
      };
    }

    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        url,
        transport: response.transport,
        status: response.status,
        error: {
          code: "non_200_response",
          message: `Non-200 response from ${url}: HTTP ${response.status}.`,
          rawError: response.text || null
        }
      };
    }

    return {
      ok: true,
      url,
      transport: response.transport,
      status: response.status,
      text: response.text
    };
  }

  async function requestJson(url, options = {}) {
    const response = await performHttpRequest({
      url,
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body || null
    });

    if (response.error) {
      return {
        ok: false,
        url,
        transport: response.transport,
        status: null,
        error: response.error
      };
    }

    let parsedPayload = null;

    if (response.text) {
      try {
        parsedPayload = JSON.parse(response.text);
      } catch (error) {
        parsedPayload = null;
      }
    }

    if (response.status < 200 || response.status >= 300) {
      const structuredError = parsedPayload?.error || null;

      return {
        ok: false,
        url,
        transport: response.transport,
        status: response.status,
        error: {
          code: structuredError?.code || "non_200_response",
          message:
            structuredError?.message ||
            `Request failed for ${url}: HTTP ${response.status}.`,
          rawError:
            structuredError?.details
              ? shortenText(JSON.stringify(structuredError.details))
              : shortenText(response.text),
          details: structuredError?.details || null
        }
      };
    }

    if (response.text && parsedPayload === null) {
      const classified = {
        code: "parse_error",
        message: `Parse error for ${url}. Response was not valid JSON.`,
        rawError: shortenText(response.text)
      };

      pushDebugLog("error", "JSON parse failed", {
        url,
        transport: response.transport,
        status: response.status,
        error: classified
      });

      return {
        ok: false,
        url,
        transport: response.transport,
        status: response.status,
        error: classified
      };
    }

    return {
      ok: true,
      url,
      transport: response.transport,
      status: response.status,
      payload: parsedPayload
    };
  }

  function endpointResultFromSuccess(name, url, response, customMessage) {
    return {
      name,
      url,
      state: "success",
      transport: response.transport,
      status: response.status,
      message: customMessage || `OK: HTTP ${response.status}`,
      responseSnippet: null,
      rawError: null
    };
  }

  function endpointResultFromFailure(name, url, response) {
    return {
      name,
      url,
      state: "error",
      transport: response.transport || null,
      status: response.status || null,
      message: response.error?.message || `Request failed for ${url}.`,
      responseSnippet: null,
      rawError: response.error?.rawError ? JSON.stringify(response.error.rawError) : null
    };
  }

  function createEmptySlots(limit) {
    return Array.from({ length: limit }, (_, index) => ({
      slotNumber: index + 1,
      occupied: false,
      enabled: false,
      sourceMode: SOURCE_MODES.MARKET_ONLY,
      sourceLabel: sourceModeLabel(SOURCE_MODES.MARKET_ONLY),
      itemId: null,
      itemName: null,
      targetPrice: null,
      nearMissGap: null,
      nearMissEnabled: false,
      lowestPrice: null,
      lowestAboveTarget: null,
      differenceFromTarget: null,
      state: "EMPTY",
      currentState: "EMPTY",
      trackerStatus: "EMPTY",
      trackerStatusLabel: "EMPTY",
      stale: false,
      coolingDown: false,
      cooldownRemainingMs: 0,
      lastChecked: null,
      alertState: {
        lastAlertedAt: null
      },
      history: {
        trendDirection: "UNKNOWN"
      },
      links: {
        tornMarket: null
      },
      currentListings: [],
      notification: null
    }));
  }

  function normalizeSlotsFromPayload(payload) {
    const slotLimit = payload?.summary?.slotLimit || payload?.status?.slotLimit || 6;
    const fallbackSlots =
      state.slots.length === slotLimit
        ? [...state.slots]
        : createEmptySlots(slotLimit).map((slot, index) => state.slots[index] || slot);
    const slots = fallbackSlots.length ? fallbackSlots : createEmptySlots(slotLimit);
    const incomingSlots = Array.isArray(payload?.slots) ? payload.slots : [];

    incomingSlots.forEach((slot) => {
      if (!slot || !slot.slotNumber || slot.slotNumber > slotLimit) {
        return;
      }

      slots[slot.slotNumber - 1] = slot;
    });

    return slots;
  }

  function applySlotsPayload(payload, fetchedAt) {
    state.slots = normalizeSlotsFromPayload(payload);
    state.activityLog = Array.isArray(payload?.activityLog)
      ? payload.activityLog.slice(0, ACTIVITY_LOG_LIMIT)
      : state.activityLog;
    state.slots.forEach((slot) => {
      if (!slot?.occupied) {
        collapseListingSection(slot.slotNumber);
      }
    });
    state.summary = payload.summary || state.summary || null;
    state.status = payload.status || state.status || null;
    syncWatcherFromStatus(payload.status || null);
    syncCompatibility(payload.versions || null);
    syncSettings(payload.settings || payload.status?.settings || null);
    state.lastFetchAt = fetchedAt;
    state.lastError = null;
    persistCachedCollection();
  }

  function applySingleSlotPayload(slot, fetchedAt = new Date().toISOString()) {
    if (!slot || !slot.slotNumber) {
      return false;
    }

    const slots = state.slots.length ? [...state.slots] : createEmptySlots(6);
    const index = slots.findIndex((entry) => entry.slotNumber === slot.slotNumber);

    if (index === -1) {
      return false;
    }

    slots[index] = slot;
    state.slots = slots;
    if (!slot.occupied) {
      collapseListingSection(slot.slotNumber);
    }
    state.lastFetchAt = fetchedAt;
    persistCachedCollection();
    return true;
  }

  function applyEmptySlotState(slotNumber, fetchedAt = new Date().toISOString()) {
    const slots = state.slots.length ? [...state.slots] : createEmptySlots(6);
    const index = slots.findIndex((entry) => entry.slotNumber === slotNumber);

    if (index === -1) {
      return false;
    }

    slots[index] = createEmptySlots(Math.max(slotNumber, slots.length))[slotNumber - 1];
    state.slots = slots;
    collapseListingSection(slotNumber);
    state.lastFetchAt = fetchedAt;
    persistCachedCollection();
    return true;
  }

  function createMalformedResponseError(url, expectation) {
    return {
      code: "malformed_response",
      message: `The backend response for ${url} was missing ${expectation}.`,
      rawError: null
    };
  }

  function updateConnection(status, message, details) {
    state.connection.status = status;
    state.connection.message = message;
    state.connection.details = details || null;
    state.connection.checkedAt = new Date().toISOString();
  }

  function ensureCompatibleBeforeAction() {
    if (!featuresBlockedByCompatibility()) {
      return true;
    }

    state.lastError = compatibilityWarning();
    updateConnection("error", compatibilityWarning(), "Update the backend or the script so the versions are compatible.");
    render();
    return false;
  }

  async function runConnectionTest({ persistOnSuccess = false } = {}) {
    if (state.requests.connectionTest) {
      return null;
    }

    const normalized = normalizeBackendUrlInput(state.backendInput);

    if (!normalized.ok) {
      updateConnection("error", normalized.error, null);
      state.lastError = normalized.error;
      render();
      return null;
    }

    const healthUrl = buildApiUrl(normalized.baseUrl, "/health");
    const statusUrl = buildApiUrl(normalized.baseUrl, "/api/status");
    const slotsUrl = buildApiUrl(normalized.baseUrl, "/api/slots");

    if (!healthUrl || !statusUrl || !slotsUrl) {
      const message = "Bad URL construction. Could not build one or more endpoint URLs.";
      state.lastError = message;
      updateConnection("error", message, "Check the base backend URL value.");
      render();
      return null;
    }

    state.requests.connectionTest = true;
    markConnectionTests({
      health: createEndpointState("health", healthUrl),
      status: createEndpointState("status", statusUrl),
      slots: createEndpointState("slots", slotsUrl)
    });
    updateConnection(
      "testing",
      "Testing /health, /api/status, and /api/slots with the normalized base URL.",
      `Base URL: ${normalized.baseUrl}${normalized.notes.length ? ` | ${normalized.notes.join(" | ")}` : ""}`
    );
    render();
    try {
      const healthResponse = await requestText(healthUrl);

      markConnectionTests({
        health: healthResponse.ok
          ? {
              ...endpointResultFromSuccess(
                "health",
                healthUrl,
                healthResponse,
                "Health endpoint is reachable."
              ),
              responseSnippet: shortenText(healthResponse.text)
            }
          : endpointResultFromFailure("health", healthUrl, healthResponse)
      });
      render();

      const statusResponse = await requestJson(statusUrl);

      markConnectionTests({
        status: statusResponse.ok
          ? endpointResultFromSuccess(
              "status",
              statusUrl,
              statusResponse,
              "Status endpoint returned valid JSON."
            )
          : endpointResultFromFailure("status", statusUrl, statusResponse)
      });
      render();

      const slotsResponse = await requestJson(slotsUrl);

      markConnectionTests({
        slots: slotsResponse.ok
          ? endpointResultFromSuccess(
              "slots",
              slotsUrl,
              slotsResponse,
              "Slots endpoint returned valid JSON."
            )
          : endpointResultFromFailure("slots", slotsUrl, slotsResponse)
      });

      const canSave = healthResponse.ok || statusResponse.ok;
      const fullSuccess = healthResponse.ok && statusResponse.ok && slotsResponse.ok;

      if (statusResponse.ok && statusResponse.payload?.service !== "tornpda-market-watcher") {
        markConnectionTests({
          status: {
            ...endpointResultFromFailure("status", statusUrl, {
              transport: statusResponse.transport,
              status: statusResponse.status,
              error: {
                code: "unexpected_service",
                message: `Unexpected JSON from ${statusUrl}. This does not look like tornpda-market-watcher.`,
                rawError: JSON.stringify(statusResponse.payload)
              }
            })
          }
        });
      }

      if (statusResponse.ok && statusResponse.payload?.service === "tornpda-market-watcher") {
        state.status = statusResponse.payload.status || state.status;
        syncCompatibility(statusResponse.payload.versions || null);
        state.activityLog = Array.isArray(statusResponse.payload.activityLog)
          ? statusResponse.payload.activityLog.slice(0, ACTIVITY_LOG_LIMIT)
          : state.activityLog;
        syncSettings(statusResponse.payload.settings || null);
      }

      if (slotsResponse.ok && Array.isArray(slotsResponse.payload?.slots)) {
        applySlotsPayload(slotsResponse.payload, new Date().toISOString());
      }

      if (persistOnSuccess && canSave) {
        persistBackendUrl(normalized.baseUrl);
      }

      if (fullSuccess) {
        if (featuresBlockedByCompatibility()) {
          updateConnection(
            "partial",
            compatibilityWarning(),
            `Base URL: ${normalized.baseUrl} | Transport: ${state.runtime.lastTransport}`
          );
          state.lastError = compatibilityWarning();
        } else {
          updateConnection(
            "success",
            "Connection test passed. /health, /api/status, and /api/slots all succeeded.",
            `Base URL: ${normalized.baseUrl} | Transport: ${state.runtime.lastTransport}`
          );
          state.lastError = null;
        }
      } else if (canSave) {
        updateConnection(
          "partial",
          "Partial success. The backend base URL looks valid, but one or more app endpoints still failed.",
          `Base URL: ${normalized.baseUrl} | You can save this base URL, but check the failed endpoint rows below.`
        );
        state.lastError = "Partial connection success. Check failed endpoint rows in the panel.";
      } else {
        updateConnection(
          "error",
          "Connection test failed. See the per-endpoint rows below for exact URLs and errors.",
          `Base URL: ${normalized.baseUrl} | Browser success at /health and /api/status confirms the backend is reachable outside TornPDA.`
        );
        state.lastError = "Connection test failed inside TornPDA.";
      }

      return {
        normalized,
        healthResponse,
        statusResponse,
        slotsResponse
      };
    } finally {
      state.requests.connectionTest = false;
      render();
    }
  }

  function vibrate(type) {
    if (!navigator.vibrate) {
      return;
    }

    navigator.vibrate(type === "BUY_NOW" ? [180, 100, 180] : [120]);
  }

  function appNotificationsEnabled() {
    return state.ui.appNotificationsEnabled !== false;
  }

  function notificationCapabilityLabel() {
    if (!appNotificationsEnabled()) {
      return "Disabled";
    }

    if (typeof Notification === "undefined") {
      return "In-app only";
    }

    if (Notification.permission === "granted") {
      return "System enabled";
    }

    if (Notification.permission === "denied") {
      return "In-app only";
    }

    return "In-app only";
  }

  async function toggleAppNotifications() {
    const nextEnabled = !appNotificationsEnabled();

    state.ui.appNotificationsEnabled = nextEnabled;

    if (nextEnabled && typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch (error) {
        pushDebugLog("warn", "Notification permission request failed", {
          message: error?.message || String(error)
        });
      }
    }

    persistUiState();
    render();
  }

  function fireSystemNotification(triggeredSlots) {
    if (
      !appNotificationsEnabled() ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted" ||
      !triggeredSlots.length
    ) {
      return;
    }

    const lead = triggeredSlots[0];
    const body =
      triggeredSlots.length === 1
        ? formatNotificationDetails(lead.notification, lead)
        : `${triggeredSlots.length} watcher alerts are ready.`;

    try {
      const notification = new Notification("TornPDA Market Watcher", {
        body
      });
      window.setTimeout(() => notification.close(), 7000);
    } catch (error) {
      pushDebugLog("warn", "System notification failed", {
        message: error?.message || String(error)
      });
    }
  }

  function showBanner(triggeredSlots) {
    if (!triggeredSlots.length || !appNotificationsEnabled()) {
      return;
    }

    const existing = document.getElementById(BANNER_ID);

    if (existing) {
      existing.remove();
    }

    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.innerHTML = triggeredSlots
      .map((slot) => {
        const headline = formatNotificationHeadline(slot.notification, slot);
        const extraCount = notificationAdditionalListingCount(slot.notification);

        return `<div><strong>${escapeHtml(headline)}</strong>${
          extraCount > 0
            ? `<div style="margin-top:2px;font-size:12px;font-weight:600;">${escapeHtml(
                `+${extraCount} Listings available`
              )}</div>`
            : ""
        }</div>`;
      })
      .join("");

    Object.assign(banner.style, {
      position: "fixed",
      top: "12px",
      left: "12px",
      right: "12px",
      zIndex: "999999",
      padding: "12px 14px",
      borderRadius: "12px",
      background: "linear-gradient(135deg, #fff6cc, #ffe08a)",
      color: "#241b00",
      boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      border: "1px solid rgba(100,70,0,0.25)",
      fontSize: "14px",
      fontWeight: "600"
    });

    document.body.appendChild(banner);

    const loudestType = triggeredSlots.some((slot) => slot.notification.type === "BUY_NOW")
      ? "BUY_NOW"
      : "NEAR_MISS";

    vibrate(loudestType);
    fireSystemNotification(triggeredSlots);

    window.setTimeout(() => {
      banner.remove();
    }, 7000);
  }

  function stateColor(slot) {
    if (slot.state === "BUY_NOW") {
      return "#d94141";
    }

    if (slot.state === "NEAR_MISS") {
      return "#d28c00";
    }

    return "#4b6475";
  }

  function trackerStatusColor(slot) {
    const status = slot.trackerStatus || (slot.occupied ? "WATCHING" : "EMPTY");

    if (status === "WATCHING") {
      return "#1f6f43";
    }

    if (status === "STALE") {
      return "#a56b00";
    }

    if (status === "ERROR") {
      return "#a33c3c";
    }

    return "#7f8b94";
  }

  function trackerStatusLabel(slot) {
    return (slot.trackerStatusLabel || slot.trackerStatus || "EMPTY").replace("_", " ");
  }

  function marketStateLabel(slot) {
    if (!slot.occupied) {
      return "EMPTY";
    }

    return String(slot.state || "WAIT").replace("_", " ");
  }

  function marketStateDescription(slot) {
    if (!slot.occupied) {
      return "No item assigned yet.";
    }

    if (slot.state === "BUY_NOW") {
      return `Cheapest ${trackedListingNoun(slot)} is at or below your target.`;
    }

    if (slot.state === "NEAR_MISS") {
      return `Closest ${trackedListingNoun(slot)} above target is still within your near-miss gap.`;
    }

    return `Current ${isBazaarMode(slot) ? "bazaar listings" : "market listings"} are above your target.`;
  }

  function formatDifferenceFromTarget(slot) {
    if (slot.differenceFromTarget === null || slot.differenceFromTarget === undefined) {
      return "--";
    }

    if (slot.differenceFromTarget === 0) {
      return "At target";
    }

    const amount = formatMoney(Math.abs(slot.differenceFromTarget));
    return slot.differenceFromTarget < 0
      ? `${amount} below target`
      : `${amount} above target`;
  }

  function formatCompactTime(slot) {
    return formatTimestamp(slot.lastChecked || slot.lastAttemptedAt);
  }

  function formatCooldownRemaining(slot) {
    if (!slot.coolingDown || !slot.cooldownRemainingMs) {
      return null;
    }

    const totalSeconds = Math.ceil(slot.cooldownRemainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
    }

    return `${seconds}s`;
  }

  function isCompactMode() {
    return state.ui.viewMode === "compact";
  }

  function isSlotBusy(slotNumber) {
    return (
      state.form.busy ||
      (state.requests.slotAction && state.requests.slotAction.slotNumber === slotNumber) ||
      state.requests.slotToggle === slotNumber
    );
  }

  function connectionColor() {
    if (state.connection.status === "success") {
      return "#1f6f43";
    }

    if (state.connection.status === "partial" || state.connection.status === "testing") {
      return "#8b5d00";
    }

    if (state.connection.status === "error") {
      return "#a33c3c";
    }

    return "#5f6f7b";
  }

  function watcherColor() {
    if (state.watcher.status === "WATCHING") {
      return "#1f6f43";
    }

    if (state.watcher.status === "ERROR") {
      return "#a33c3c";
    }

    return "#5f6f7b";
  }

  function watcherDetail() {
    if (state.watcher.status === "WATCHING") {
      if (!(state.summary?.activeEnabledCount > 0)) {
        return "Global watching is on, but no enabled slots are active yet.";
      }

      return state.watcher.polling
        ? "Checking the backend now."
        : `Watching is active. Poll interval: ${Math.round(POLL_INTERVAL_MS / 1000)}s.`;
    }

    if (state.watcher.status === "ERROR") {
      return state.watcher.active
        ? `Watching is still active, but the last poll failed. ${state.watcher.lastError || "It will retry on the next interval."}`
        : state.watcher.lastError || "Watcher error.";
    }

    return "Watching is inactive. Connection Test and manual Refresh still work without starting background polling.";
  }

  function activeOccupiedSlots() {
    return (state.slots || []).filter((slot) => slot && slot.occupied && slot.enabled);
  }

  function deriveNextCheckInfo() {
    if (state.watcher.polling) {
      return {
        value: "Checking now",
        detail: "A market poll is currently running."
      };
    }

    if (!state.watcher.active) {
      return {
        value: "Not scheduled",
        detail: "Start Watching or use Refresh Now for the next market check."
      };
    }

    if (!(state.summary?.activeEnabledCount > 0)) {
      return {
        value: "Not scheduled",
        detail: "No enabled slots are active under the current global watching state."
      };
    }

    const lastStartedAtMs = Date.parse(state.watcher.lastStartedAt || "");

    if (!Number.isFinite(lastStartedAtMs)) {
      return {
        value: `Within ${formatDurationShort(POLL_INTERVAL_MS)}`,
        detail: "The next market check will run on the watcher interval."
      };
    }

    const remainingMs = Math.max(0, lastStartedAtMs + POLL_INTERVAL_MS - Date.now());

    return {
      value: remainingMs <= 1000 ? "Ready now" : `In ${formatDurationShort(remainingMs)}`,
      detail: "Next check = next market poll/check."
    };
  }

  function deriveNextAlertInfo() {
    if (!state.watcher.active) {
      return {
        value: "Not scheduled",
        detail: "Start Watching before any slot can actively check for alerts."
      };
    }

    const slots = activeOccupiedSlots();

    if (!slots.length) {
      return {
        value: "Not scheduled",
        detail: "No enabled watched slots can produce alerts right now."
      };
    }

    const activeCooldowns = slots
      .map((slot) => Number(slot.cooldownRemainingMs) || 0)
      .filter((remainingMs) => remainingMs > 0);

    if (activeCooldowns.length) {
      const nextReadyMs = Math.min(...activeCooldowns);
      return {
        value: `In ${formatDurationShort(nextReadyMs)}`,
        detail: "Next alert = next time a watcher alert becomes eligible."
      };
    }

    return {
      value: "Ready now",
      detail: "A newly seen qualifying listing can alert immediately."
    };
  }

  function deriveNextNotificationInfo() {
    if (!appNotificationsEnabled()) {
      return {
        value: "Disabled",
        detail: "App notifications are turned off."
      };
    }

    const alertInfo = deriveNextAlertInfo();

    if (alertInfo.value === "Not scheduled") {
      return {
        value: "Not scheduled",
        detail: "No enabled watched slots can send app notifications right now."
      };
    }

    if (alertInfo.value === "Waiting") {
      return {
        value: "Waiting",
        detail: "Next notification = next time an in-app notification is eligible."
      };
    }

    return {
      value: alertInfo.value,
      detail: "Next notification = next time an in-app or supported system notification is eligible."
    };
  }

  function timingRows() {
    return [
      {
        key: "next-check",
        label: "Next Check",
        info: deriveNextCheckInfo()
      },
      {
        key: "next-alert",
        label: "Next Alert",
        info: deriveNextAlertInfo()
      },
      {
        key: "next-notification",
        label: "Next Notification",
        info: deriveNextNotificationInfo()
      }
    ];
  }

  function renderTimingSection() {
    const rows = timingRows();

    return `
      <div style="margin-top:10px;padding:10px;border-radius:12px;background:rgba(255,255,255,0.82);border:1px solid rgba(13,94,168,0.12);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div style="font-size:12px;font-weight:700;color:#143041;">Timing</div>
          <button data-action="toggle-app-notifications" style="border:none;border-radius:999px;padding:7px 10px;background:${appNotificationsEnabled() ? "#0d5ea8" : "#eef3f7"};color:${appNotificationsEnabled() ? "#fff" : "#12314a"};font-size:11px;font-weight:700;">Notifications: ${appNotificationsEnabled() ? "On" : "Off"}</button>
        </div>
        <div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));gap:8px;">
          ${rows
            .map(
              (row) => `
                <div style="min-width:0;padding:8px;border-radius:10px;background:rgba(238,243,247,0.75);">
                  <div style="font-size:10px;font-weight:700;color:#5f6f7b;letter-spacing:0.02em;">${row.label}</div>
                  <div data-timer-value="${row.key}" style="margin-top:4px;font-size:12px;font-weight:700;color:#143041;">${escapeHtml(row.info.value)}</div>
                  <div data-timer-detail="${row.key}" style="margin-top:3px;font-size:10px;color:#5f6f7b;">${escapeHtml(row.info.detail)}</div>
                </div>
              `
            )
            .join("")}
        </div>
        <div style="margin-top:8px;font-size:10px;color:#5f6f7b;">Notification mode: ${escapeHtml(
          notificationCapabilityLabel()
        )}</div>
      </div>
    `;
  }

  function refreshTimingWidgets() {
    const panel = document.getElementById(PANEL_ID);

    if (!panel || state.ui.collapsed) {
      return;
    }

    timingRows().forEach((row) => {
      const valueNode = panel.querySelector(`[data-timer-value="${row.key}"]`);
      const detailNode = panel.querySelector(`[data-timer-detail="${row.key}"]`);

      if (valueNode) {
        valueNode.textContent = row.info.value;
      }

      if (detailNode) {
        detailNode.textContent = row.info.detail;
      }
    });
  }

  function sourceModeSummary() {
    const occupiedSlots = (state.slots || []).filter((slot) => slot && slot.occupied);
    const marketCount = occupiedSlots.filter((slot) => !isBazaarMode(slot)).length;
    const bazaarCount = occupiedSlots.filter((slot) => isBazaarMode(slot)).length;

    if (!occupiedSlots.length) {
      return "No slots configured";
    }

    return `${marketCount} Market / ${bazaarCount} Bazaar`;
  }

  function slotDataStateInfo(slot) {
    if (!slot?.occupied) {
      return {
        label: "Empty",
        detail: "No item is assigned to this slot.",
        color: "#5f6f7b"
      };
    }

    if (slot.trackerStatus === "ERROR" || (slot.lastError && !slot.lastChecked)) {
      return {
        label: "Fetch failed",
        detail: slot.lastError || "The watcher hit an error before a successful refresh.",
        color: "#a33c3c"
      };
    }

    if (slot.stale) {
      return {
        label: "Stale data",
        detail: "Showing the last known result because the latest backend data is stale.",
        color: "#a56b00"
      };
    }

    if (state.requests.restoreSync || state.requests.manualRefresh) {
      return {
        label: "Loading",
        detail: "Refreshing the latest backend snapshot now.",
        color: "#0d5ea8"
      };
    }

    if (
      slot.enabled &&
      slot.trackerStatus === "WATCHING" &&
      Array.isArray(slot.currentListings) &&
      slot.currentListings.length === 0
    ) {
      return {
        label: "No listings found",
        detail: `The latest ${isBazaarMode(slot) ? "bazaar" : "market"} snapshot returned no current listings.`,
        color: "#5f6f7b"
      };
    }

    return {
      label: "Live listings",
      detail: `Showing the latest ${isBazaarMode(slot) ? "bazaar" : "market"} snapshot.`,
      color: "#1f6f43"
    };
  }

  function renderCompatibilityWarning() {
    if (!featuresBlockedByCompatibility()) {
      return "";
    }

    return `
      <div style="margin-top:10px;padding:10px;border-radius:12px;background:rgba(240,215,215,0.92);border:1px solid rgba(163,60,60,0.25);font-size:11px;color:#6f2424;">
        <strong>Version mismatch:</strong> ${escapeHtml(compatibilityWarning())}
      </div>
    `;
  }

  function renderBackendVersionLabel() {
    if (state.versions?.backendVersion) {
      return state.versions.backendVersion;
    }

    if (
      state.requests.connectionTest ||
      state.requests.restoreSync ||
      state.requests.manualRefresh ||
      state.runtime.initialRestorePending
    ) {
      return "Loading...";
    }

    return "Unknown";
  }

  function renderAboutSection() {
    return `
      <div style="margin-top:10px;padding:10px;border-radius:12px;background:rgba(255,255,255,0.8);border:1px solid rgba(13,94,168,0.12);">
        <div style="font-size:12px;font-weight:700;color:#143041;">About</div>
        <div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:8px;font-size:11px;color:#143041;">
          <div><span style="color:#5f6f7b;">Script</span><br /><strong>${escapeHtml(
            state.versions.scriptVersion || SCRIPT_VERSION || "Unknown"
          )}</strong></div>
          <div><span style="color:#5f6f7b;">Backend</span><br /><strong>${escapeHtml(
            renderBackendVersionLabel()
          )}</strong></div>
          <div><span style="color:#5f6f7b;">Backend URL</span><br /><strong>${escapeHtml(
            state.backendUrl || state.backendInput || "Not set"
          )}</strong></div>
          <div><span style="color:#5f6f7b;">Sources</span><br /><strong>${escapeHtml(
            sourceModeSummary()
          )}</strong></div>
          <div><span style="color:#5f6f7b;">Notifications</span><br /><strong>${escapeHtml(
            appNotificationsEnabled() ? "Enabled" : "Disabled"
          )}</strong></div>
        </div>
      </div>
    `;
  }

  function renderActivitySection() {
    const expanded = state.ui.activityExpanded === true;
    const entries = Array.isArray(state.activityLog) ? state.activityLog.slice(0, ACTIVITY_LOG_LIMIT) : [];

    return `
      <div style="margin-top:10px;padding:10px;border-radius:12px;background:rgba(255,255,255,0.78);border:1px solid rgba(13,94,168,0.12);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div style="font-size:12px;font-weight:700;color:#143041;">Recent Activity</div>
          <button data-action="toggle-activity" style="border:none;border-radius:10px;padding:7px 10px;background:#eef3f7;color:#12314a;font-size:11px;font-weight:700;">${expanded ? "Hide Activity" : "Show Activity"}</button>
        </div>
        ${
          expanded
            ? entries.length
              ? `<div style="margin-top:8px;display:grid;gap:6px;">${entries
                  .map(
                    (entry) => `
                      <div style="padding:8px;border-radius:10px;background:rgba(238,243,247,0.7);font-size:11px;color:#143041;">
                        <div style="font-weight:700;">${escapeHtml(entry.message || entry.type || "Activity")}</div>
                        <div style="margin-top:3px;color:#5f6f7b;">${escapeHtml(
                          formatTimestamp(entry.timestamp)
                        )}${entry.slotNumber ? ` | Slot ${escapeHtml(String(entry.slotNumber))}` : ""}${entry.itemName ? ` | ${escapeHtml(entry.itemName)}` : ""}</div>
                      </div>
                    `
                  )
                  .join("")}</div>`
              : `<div style="margin-top:8px;font-size:11px;color:#5f6f7b;">No recent activity yet.</div>`
            : `<div style="margin-top:6px;font-size:11px;color:#5f6f7b;">Recent slot changes, alerts, and listing changes are available here.</div>`
        }
      </div>
    `;
  }

  function renderBackupDialog() {
    if (!state.backupDialog.mode) {
      return "";
    }

    const exportMode = state.backupDialog.mode === "export";

    return `
      <div style="margin-top:10px;padding:10px;border-radius:12px;background:rgba(13,94,168,0.06);border:1px solid rgba(13,94,168,0.15);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div style="font-size:12px;font-weight:700;color:#143041;">${escapeHtml(
            state.backupDialog.title
          )}</div>
          <button data-action="close-backup-dialog" style="border:none;border-radius:10px;padding:7px 10px;background:#eef3f7;color:#12314a;font-size:11px;font-weight:700;">Close</button>
        </div>
        <div style="margin-top:6px;font-size:11px;color:#5f6f7b;">${
          exportMode
            ? "This JSON includes backend slot settings plus the local UI preferences that make restores smoother."
            : "Paste an exported JSON backup here. The backend slot data will be validated before replacing the current configuration."
        }</div>
        <textarea data-action="backup-dialog-text" ${exportMode ? "readonly" : ""} style="margin-top:8px;width:100%;min-height:180px;box-sizing:border-box;border:1px solid rgba(13,94,168,0.18);border-radius:10px;padding:10px;font-size:11px;font-family:Consolas, monospace;">${escapeHtml(
          state.backupDialog.text
        )}</textarea>
        ${
          state.backupDialog.error
            ? `<div style="margin-top:8px;font-size:11px;color:#a33c3c;">${escapeHtml(
                state.backupDialog.error
              )}</div>`
            : ""
        }
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
          ${
            exportMode
              ? `<button data-action="copy-backup-dialog" style="border:none;border-radius:10px;padding:8px 10px;background:#0d5ea8;color:#fff;font-size:12px;font-weight:700;">Copy JSON</button>`
              : `<button data-action="apply-import-backup" ${
                  state.backupDialog.busy ? "disabled" : ""
                } style="border:none;border-radius:10px;padding:8px 10px;background:${
                  state.backupDialog.busy ? "#d5dce2" : "#0d5ea8"
                };color:${state.backupDialog.busy ? "#61707c" : "#fff"};font-size:12px;font-weight:700;">${
                  state.backupDialog.busy ? "Importing..." : "Apply Import"
                }</button>`
          }
        </div>
      </div>
    `;
  }

  function restoreDetail() {
    if (state.requests.restoreSync) {
      return state.runtime.restoredFromCache
        ? "Showing the last saved UI state while syncing the latest backend data."
        : "Restoring the latest backend state now.";
    }

    if (state.runtime.restoredFromCache && state.runtime.initialRestorePending && state.ui.collapsed) {
      return "Saved slot state is ready locally and will sync when you open the menu.";
    }

    if (state.runtime.restoredFromCache) {
      return `Restored saved slot state from ${formatTimestamp(state.lastFetchAt)}.`;
    }

    if (state.runtime.initialRestorePending && !state.ui.collapsed) {
      return "Preparing to restore slot state from the backend.";
    }

    return "Slot data comes from the backend. Local storage only keeps the last good UI snapshot for faster restore.";
  }

  function watcherButtonStyle(kind, disabled) {
    const palette =
      kind === "start"
        ? {
            background: "#1f6f43",
            color: "#fff"
          }
        : {
            background: "#f0d7d7",
            color: "#6f2424"
          };

    return `border:none;border-radius:10px;padding:8px 10px;background:${disabled ? "#d5dce2" : palette.background};color:${disabled ? "#61707c" : palette.color};font-size:12px;font-weight:700;opacity:${disabled ? "0.7" : "1"};`;
  }

  function openExternalLink(url, contextLabel = "external link") {
    if (!url) {
      return;
    }

    pushDebugLog("info", `Opening ${contextLabel}`, {
      url,
      contextLabel
    });
    window.location.assign(url);
  }

  function renderEndpointDiagnostics() {
    return ["health", "status", "slots"]
      .map((key) => {
        const test = state.connection.tests[key];
        const color =
          test.state === "success"
            ? "#1f6f43"
            : test.state === "error"
              ? "#a33c3c"
              : "#5f6f7b";

        return `
          <div style="margin-top:8px;padding:8px;border-radius:10px;background:rgba(255,255,255,0.75);border:1px solid rgba(13,94,168,0.12);">
            <div style="font-size:11px;font-weight:700;color:${color};">${escapeHtml(
              test.name.toUpperCase()
            )}: ${escapeHtml(test.message)}</div>
            <div style="margin-top:4px;font-size:11px;color:#5f6f7b;word-break:break-all;">URL: ${escapeHtml(
              test.url || "--"
            )}</div>
            <div style="margin-top:2px;font-size:11px;color:#5f6f7b;">Transport: ${escapeHtml(
              test.transport || "--"
            )} | HTTP: ${escapeHtml(test.status ?? "--")}</div>
            ${
              test.responseSnippet
                ? `<div style="margin-top:4px;font-size:11px;color:#5f6f7b;">Response: ${escapeHtml(
                    test.responseSnippet
                  )}</div>`
                : ""
            }
            ${
              test.rawError
                ? `<div style="margin-top:4px;font-size:11px;color:#a33c3c;word-break:break-word;">Raw error: ${escapeHtml(
                    test.rawError
                  )}</div>`
                : ""
            }
          </div>
        `;
      })
      .join("");
  }

  function renderAlertSettings() {
    const buttonsDisabled = state.settingsForm.busy || featuresBlockedByCompatibility();

    return `
      <div style="margin-top:10px;padding:10px;border-radius:12px;background:rgba(255,255,255,0.78);border:1px solid rgba(13,94,168,0.12);">
        <div style="font-size:12px;font-weight:700;color:#143041;">Alert Timing</div>
        <div style="margin-top:4px;font-size:11px;color:#5f6f7b;">
          Snapshot window groups qualifying listings before alerting. Notification cooldown controls how often repeat alerts can open a new group.
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:8px;margin-top:10px;">
          <label style="display:block;font-size:11px;">
            <span style="display:block;margin-bottom:4px;color:#5f6f7b;">Snapshot Grouping Window (seconds)</span>
            <input data-settings-field="snapshotGroupingWindowSeconds" type="number" min="0" value="${escapeHtml(
              state.settingsForm.snapshotGroupingWindowSeconds
            )}" style="width:100%;box-sizing:border-box;border:1px solid rgba(13,94,168,0.2);border-radius:10px;padding:8px;font-size:12px;" />
          </label>
          <label style="display:block;font-size:11px;">
            <span style="display:block;margin-bottom:4px;color:#5f6f7b;">Notification Cooldown (seconds)</span>
            <input data-settings-field="alertCooldownSeconds" type="number" min="0" value="${escapeHtml(
              state.settingsForm.alertCooldownSeconds
            )}" style="width:100%;box-sizing:border-box;border:1px solid rgba(13,94,168,0.2);border-radius:10px;padding:8px;font-size:12px;" />
          </label>
        </div>
        ${
          state.settingsForm.error
            ? `<div style="margin-top:8px;font-size:11px;color:#a33c3c;">${escapeHtml(
                state.settingsForm.error
              )}</div>`
            : ""
        }
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button data-action="save-settings" ${buttonsDisabled ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${buttonsDisabled ? "#d5dce2" : "#0d5ea8"};color:${buttonsDisabled ? "#61707c" : "#fff"};font-size:12px;font-weight:700;">${
            state.settingsForm.busy ? "Saving..." : "Save Alert Settings"
          }</button>
          <button data-action="reset-settings" ${buttonsDisabled ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${buttonsDisabled ? "#d5dce2" : "#d9e8f6"};color:${buttonsDisabled ? "#61707c" : "#12314a"};font-size:12px;font-weight:700;">Reset Fields</button>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#5f6f7b;">
          Current backend values: grouping ${escapeHtml(
            String(Math.round((state.settings.snapshotGroupingWindowMs || 0) / 1000))
          )}s | cooldown ${escapeHtml(
            String(Math.round((state.settings.alertCooldownMs || 0) / 1000))
          )}s
        </div>
      </div>
    `;
  }

  function slotActionLabel(slotNumber, fallback) {
    if (!state.requests.slotAction || state.requests.slotAction.slotNumber !== slotNumber) {
      return fallback;
    }

    if (state.requests.slotAction.action === "add" || state.requests.slotAction.action === "save") {
      return "Saving...";
    }

    if (state.requests.slotAction.action === "delete") {
      return "Deleting...";
    }

    return fallback;
  }

  function slotToggleLabel(slot) {
    if (state.requests.slotToggle === slot.slotNumber) {
      return slot.enabled ? "Turning Off..." : "Turning On...";
    }

    return slot.enabled ? "Turn Off" : "Turn On";
  }

  function areListingsExpanded(slotNumber) {
    if (Object.prototype.hasOwnProperty.call(state.ui.expandedListingSlots, slotNumber)) {
      return Boolean(state.ui.expandedListingSlots[slotNumber]);
    }

    return false;
  }

  function setListingsExpanded(slotNumber, expanded) {
    state.ui.expandedListingSlots = {
      ...state.ui.expandedListingSlots,
      [slotNumber]: Boolean(expanded)
    };
    render();
  }

  function collapseListingSection(slotNumber) {
    if (!Object.prototype.hasOwnProperty.call(state.ui.expandedListingSlots, slotNumber)) {
      return;
    }

    const nextExpandedListingSlots = { ...state.ui.expandedListingSlots };
    delete nextExpandedListingSlots[slotNumber];
    state.ui.expandedListingSlots = nextExpandedListingSlots;
  }

  function toggleActivityExpanded() {
    state.ui.activityExpanded = !state.ui.activityExpanded;
    persistUiState();
    render();
  }

  function closeBackupDialog() {
    state.backupDialog = createBackupDialogState();
    render();
  }

  function buildUiBackupPayload(backendBackup) {
    return {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      application: {
        scriptVersion: SCRIPT_VERSION,
        backendVersion: state.versions.backendVersion || null,
        minimumCompatibleBackendVersion: MINIMUM_COMPATIBLE_BACKEND_VERSION,
        minimumCompatibleScriptVersion: state.versions.minimumCompatibleScriptVersion || null
      },
      backend: backendBackup?.backend || {
        settings: state.settings,
        slots: state.slots
      },
      uiPreferences: {
        backendUrl: state.backendUrl || state.backendInput || "",
        viewMode: state.ui.viewMode === "compact" ? "compact" : "full",
        appNotificationsEnabled: appNotificationsEnabled()
      }
    };
  }

  async function openExportDialog() {
    if (!ensureCompatibleBeforeAction()) {
      return;
    }

    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok) {
      state.lastError = normalized.error;
      render();
      return;
    }

    const endpoint = buildApiUrl(normalized.baseUrl, "/api/backup/export");

    if (!endpoint) {
      state.lastError = "Bad URL construction for export request.";
      render();
      return;
    }

    state.requests.exportSettings = true;
    state.backupDialog = {
      mode: "export",
      title: "Export Settings",
      text: "",
      error: null,
      busy: true
    };
    render();

    try {
      const result = await requestJson(endpoint);

      if (!result.ok || !result.payload?.backup) {
        state.backupDialog.error = result.error?.message || "Export failed.";
        state.lastError = state.backupDialog.error;
        updateConnection("error", state.backupDialog.error, `Requested URL: ${endpoint}`);
        return;
      }

      state.backupDialog = {
        mode: "export",
        title: "Export Settings",
        text: JSON.stringify(buildUiBackupPayload(result.payload.backup), null, 2),
        error: null,
        busy: false
      };
      updateConnection("success", "Export is ready.", `Requested URL: ${endpoint}`);
    } finally {
      state.requests.exportSettings = false;
      render();
    }
  }

  function openImportDialog() {
    if (!ensureCompatibleBeforeAction()) {
      return;
    }

    state.backupDialog = {
      mode: "import",
      title: "Import Settings",
      text: "",
      error: null,
      busy: false
    };
    render();
  }

  function validateImportedBackup(parsed) {
    if (!parsed || typeof parsed !== "object") {
      return {
        ok: false,
        error: "Imported backup must be a JSON object."
      };
    }

    if (!parsed.backend || typeof parsed.backend !== "object") {
      return {
        ok: false,
        error: "Imported backup is missing the backend section."
      };
    }

    if (!Array.isArray(parsed.backend.slots)) {
      return {
        ok: false,
        error: "Imported backup is missing backend.slots."
      };
    }

    return {
      ok: true
    };
  }

  async function applyImportedBackup() {
    if (!ensureCompatibleBeforeAction()) {
      return;
    }

    const parsed = safeJsonParse(state.backupDialog.text || "", null);
    const validation = validateImportedBackup(parsed);

    if (!validation.ok) {
      state.backupDialog.error = validation.error;
      render();
      return;
    }

    const backendUrlCandidate =
      parsed.uiPreferences?.backendUrl || state.backendUrl || state.backendInput || "";
    const normalized = normalizeBackendUrlInput(backendUrlCandidate);

    if (!normalized.ok) {
      state.backupDialog.error = normalized.error;
      render();
      return;
    }

    const endpoint = buildApiUrl(normalized.baseUrl, "/api/backup/import");

    if (!endpoint) {
      state.backupDialog.error = "Bad URL construction for import request.";
      render();
      return;
    }

    state.requests.importSettings = true;
    state.backupDialog.busy = true;
    state.backupDialog.error = null;
    render();

    try {
      const result = await requestJson(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          backup: parsed.backend
        })
      });

      if (!result.ok) {
        state.backupDialog.error = result.error.message;
        state.lastError = result.error.message;
        updateConnection("error", result.error.message, `Requested URL: ${endpoint}`);
        return;
      }

      persistBackendUrl(normalized.baseUrl);
      state.ui.viewMode =
        parsed.uiPreferences?.viewMode === "compact" ? "compact" : state.ui.viewMode;
      state.ui.appNotificationsEnabled = parsed.uiPreferences?.appNotificationsEnabled !== false;
      persistUiState();
      applySlotsPayload(result.payload, new Date().toISOString());
      closeSlotForm();
      updateConnection("success", "Imported backup applied successfully.", `Requested URL: ${endpoint}`);
      state.lastError = null;
      closeBackupDialog();
    } finally {
      state.requests.importSettings = false;
      state.backupDialog.busy = false;
      render();
    }
  }

  async function copyBackupDialogText() {
    if (!state.backupDialog.text) {
      return;
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(state.backupDialog.text);
        updateConnection("success", "Export JSON copied to the clipboard.", null);
        render();
        return;
      } catch (error) {
        pushDebugLog("warn", "Clipboard copy failed", {
          message: error?.message || String(error)
        });
      }
    }

    updateConnection("partial", "Clipboard copy is unavailable here. Select the JSON text manually.", null);
    render();
  }

  function buildSourceToggle(slot, compactMode = false) {
    if (!slot?.occupied) {
      return "";
    }

    const selectedMode = slotSourceMode(slot);
    const busy = isSlotBusy(slot.slotNumber) || featuresBlockedByCompatibility();
    const baseStyle =
      "border:none;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:700;";
    const selectedStyle = "background:#0d5ea8;color:#fff;";
    const idleStyle = "background:#eef3f7;color:#12314a;";
    const wrapperStyle = compactMode
      ? "margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;"
      : "margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;";

    return `
      <div style="${wrapperStyle}">
        <span style="font-size:11px;color:#5f6f7b;align-self:center;">Source:</span>
        <button data-slot-action="set-source" data-slot="${slot.slotNumber}" data-source-mode="${SOURCE_MODES.MARKET_ONLY}" ${busy ? "disabled" : ""} style="${baseStyle}${selectedMode === SOURCE_MODES.MARKET_ONLY ? selectedStyle : idleStyle}">${compactMode ? "Market" : "Market Only"}</button>
        <button data-slot-action="set-source" data-slot="${slot.slotNumber}" data-source-mode="${SOURCE_MODES.BAZAAR_ONLY}" ${busy ? "disabled" : ""} style="${baseStyle}${selectedMode === SOURCE_MODES.BAZAAR_ONLY ? selectedStyle : idleStyle}">${compactMode ? "Bazaar" : "Bazaar Only"}</button>
      </div>
    `;
  }

  function buildListingsMarkup(slot, compactMode = false) {
    if (!slot?.occupied) {
      return "";
    }

    const listings = Array.isArray(slot.currentListings) ? slot.currentListings : [];
    const expanded = areListingsExpanded(slot.slotNumber);
    const label = listingPanelLabel(slot);
    const toggleLabel = expanded ? `Hide ${label}` : `Show ${label}`;
    const summaryText =
      Number.isFinite(Number(slot.market?.totalListings)) && slot.market.totalListings > listings.length
        ? `Showing ${listings.length} of ${slot.market.totalListings} current ${isBazaarMode(slot) ? "bazaar" : "market"} listings.`
        : listings.length > 0
          ? `${listings.length} current ${isBazaarMode(slot) ? "bazaar" : "market"} listing${listings.length === 1 ? "" : "s"} found.`
          : `No current ${isBazaarMode(slot) ? "bazaar" : "market"} listings were returned for this item.`;
    const header = `
      <div style="margin-top:${compactMode ? "8px" : "10px"};display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <div style="font-size:11px;color:#5f6f7b;">${escapeHtml(summaryText)}</div>
        <button data-listings-toggle="${slot.slotNumber}" style="border:none;border-radius:10px;padding:7px 10px;background:#eef3f7;color:#12314a;font-size:11px;font-weight:700;">${toggleLabel}</button>
      </div>
    `;

    if (!expanded) {
      return header;
    }

    if (!listings.length) {
      return `${header}<div style="margin-top:8px;font-size:11px;color:#5f6f7b;">Try Refresh Now if you expect active ${escapeHtml(
        isBazaarMode(slot) ? "bazaar sellers" : "market rows"
      )} but none were returned in the current snapshot.</div>`;
    }

    const rows = listings
      .map((listing) => {
        const openButton = isBazaarMode(slot)
          ? listing?.bazaarUrl
            ? `<button data-external-url="${escapeHtml(
                listing.bazaarUrl
              )}" data-link-context="seller bazaar" style="border:none;border-radius:9px;padding:6px 8px;background:#0d5ea8;color:#fff;font-size:11px;font-weight:700;">Open Bazaar</button>`
            : `<span style="font-size:10px;color:#7a8893;">Link unavailable</span>`
          : `<span style="font-size:10px;color:#7a8893;">Use Open market below for the full page.</span>`;
        const rowTitle = isBazaarMode(slot)
          ? listingDisplayOwner(listing)
          : `Market Listing ${String(listing.position || "--")}`;
        const rowMeta = isBazaarMode(slot)
          ? `Qty ${escapeHtml(String(listing.quantity ?? "--"))}${formatListingUpdated(listing) ? ` | Updated ${escapeHtml(formatListingUpdated(listing))}` : ""}`
          : `Qty ${escapeHtml(String(listing.quantity ?? "--"))}${formatListingUpdated(listing) ? ` | Updated ${escapeHtml(formatListingUpdated(listing))}` : ""}${listing.listingId ? ` | ${escapeHtml(listing.listingId)}` : ""}`;

        return `
          <div style="padding:8px 0;border-top:1px solid rgba(13,94,168,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
              <div style="min-width:0;">
                <div style="font-size:12px;font-weight:700;color:#143041;word-break:break-word;">${escapeHtml(
                  rowTitle
                )}</div>
                <div style="margin-top:2px;font-size:11px;color:#5f6f7b;">${rowMeta}</div>
              </div>
              <div style="text-align:right;flex-shrink:0;">
                <div style="font-size:12px;font-weight:700;color:#0d5ea8;">${formatMoney(
                  listing.price
                )}</div>
                <div style="margin-top:2px;font-size:11px;color:#5f6f7b;">Total ${formatMoney(
                  Number(listing.price) * Number(listing.quantity)
                )}</div>
              </div>
            </div>
            <div style="margin-top:8px;display:flex;justify-content:flex-end;gap:8px;align-items:center;flex-wrap:wrap;">
              ${openButton}
            </div>
          </div>
        `;
      })
      .join("");

    return `
      ${header}
      <div style="margin-top:8px;max-height:${compactMode ? "220px" : "260px"};overflow:auto;padding:0 8px;border-radius:10px;background:rgba(255,255,255,0.75);border:1px solid rgba(13,94,168,0.12);">
        ${rows}
      </div>
    `;
  }

  function buildSlotEditor() {
    if (!state.form.slotNumber) {
      return "";
    }

    const actionLabel = state.form.mode === "add" ? "Add Item" : "Save Changes";
    const saveDisabled =
      state.form.busy || state.requests.slotsReload || featuresBlockedByCompatibility();

    return `
      <div style="margin-top:10px;padding:10px;border-radius:12px;background:rgba(13,94,168,0.06);border:1px solid rgba(13,94,168,0.15);">
        <div style="font-size:12px;font-weight:700;margin-bottom:8px;">${actionLabel} For Slot ${state.form.slotNumber}</div>
        <div style="margin-bottom:8px;font-size:11px;color:#5f6f7b;">Enter an item ID, an item name, or both. Name matching is case-insensitive. Near-miss gap 0 disables near-miss alerts.</div>
        <div style="display:grid;grid-template-columns:1fr;gap:8px;">
          <label style="display:block;font-size:11px;">
            <span style="display:block;margin-bottom:4px;color:#5f6f7b;">Item ID (optional)</span>
            <input data-form-field="itemId" type="number" min="1" value="${escapeHtml(
              state.form.itemId
            )}" placeholder="372" style="width:100%;box-sizing:border-box;border:1px solid rgba(13,94,168,0.2);border-radius:10px;padding:9px;font-size:12px;" />
          </label>
          <label style="display:block;font-size:11px;">
            <span style="display:block;margin-bottom:4px;color:#5f6f7b;">Item Name (optional)</span>
            <input data-form-field="itemName" type="text" value="${escapeHtml(
              state.form.itemName
            )}" placeholder="Empty Box" style="width:100%;box-sizing:border-box;border:1px solid rgba(13,94,168,0.2);border-radius:10px;padding:9px;font-size:12px;" />
          </label>
          <label style="display:block;font-size:11px;">
            <span style="display:block;margin-bottom:4px;color:#5f6f7b;">Target Price</span>
            <input data-form-field="targetPrice" type="number" min="0" value="${escapeHtml(
              state.form.targetPrice
            )}" style="width:100%;box-sizing:border-box;border:1px solid rgba(13,94,168,0.2);border-radius:10px;padding:9px;font-size:12px;" />
          </label>
          <label style="display:block;font-size:11px;">
            <span style="display:block;margin-bottom:4px;color:#5f6f7b;">Near-Miss Gap</span>
            <input data-form-field="nearMissGap" type="number" min="0" value="${escapeHtml(
              state.form.nearMissGap
            )}" placeholder="0 disables near-miss" style="width:100%;box-sizing:border-box;border:1px solid rgba(13,94,168,0.2);border-radius:10px;padding:9px;font-size:12px;" />
          </label>
        </div>
        <div style="margin-top:10px;">
          <div style="margin-bottom:4px;font-size:11px;color:#5f6f7b;">Source Mode</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <button type="button" data-form-source="${SOURCE_MODES.MARKET_ONLY}" style="border:none;border-radius:10px;padding:9px 10px;background:${normalizeSourceMode(state.form.sourceMode) === SOURCE_MODES.MARKET_ONLY ? "#0d5ea8" : "#eef3f7"};color:${normalizeSourceMode(state.form.sourceMode) === SOURCE_MODES.MARKET_ONLY ? "#fff" : "#12314a"};font-size:12px;font-weight:700;">Market Only</button>
            <button type="button" data-form-source="${SOURCE_MODES.BAZAAR_ONLY}" style="border:none;border-radius:10px;padding:9px 10px;background:${normalizeSourceMode(state.form.sourceMode) === SOURCE_MODES.BAZAAR_ONLY ? "#0d5ea8" : "#eef3f7"};color:${normalizeSourceMode(state.form.sourceMode) === SOURCE_MODES.BAZAAR_ONLY ? "#fff" : "#12314a"};font-size:12px;font-weight:700;">Bazaar Only</button>
          </div>
          <div style="margin-top:4px;font-size:11px;color:#5f6f7b;">Market Only tracks true item market listings only. Bazaar Only tracks seller bazaars only.</div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:#143041;">
          <input data-form-field="enabled" type="checkbox" ${state.form.enabled ? "checked" : ""} />
          Start this slot enabled
        </label>
        ${
          state.form.error
            ? `<div style="margin-top:8px;font-size:11px;color:#a33c3c;">${escapeHtml(
                state.form.error
              )}</div>`
            : ""
        }
        <div style="margin-top:8px;font-size:11px;color:#5f6f7b;">Refresh Now above runs one backend poll. Reload Saved Slots below only re-reads the current backend state without starting active watching.</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button data-action="submit-slot" ${saveDisabled ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${saveDisabled ? "#d5dce2" : "#0d5ea8"};color:${saveDisabled ? "#61707c" : "#fff"};font-size:12px;font-weight:700;">${state.form.busy ? "Saving..." : actionLabel}</button>
          <button data-action="cancel-slot" ${state.form.busy ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${state.form.busy ? "#d5dce2" : "#d9e8f6"};color:#12314a;font-size:12px;font-weight:700;">Cancel</button>
          <button data-action="reload-slots" ${state.requests.slotsReload || state.form.busy || featuresBlockedByCompatibility() ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${state.requests.slotsReload || state.form.busy || featuresBlockedByCompatibility() ? "#d5dce2" : "#eef3f7"};color:#12314a;font-size:12px;font-weight:700;">${state.requests.slotsReload ? "Reloading..." : "Reload Saved Slots"}</button>
        </div>
      </div>
    `;
  }

  function buildSlotCard(slot) {
    const trackerBadgeColor = trackerStatusColor(slot);
    const marketBadgeColor = stateColor(slot);
    const isEditingThisSlot = state.form.slotNumber === slot.slotNumber;
    const busy = isSlotBusy(slot.slotNumber) || featuresBlockedByCompatibility();
    const cooldownText = formatCooldownRemaining(slot);
    const dataState = slotDataStateInfo(slot);
    const slotStatusText =
      trackerStatusLabel(slot) === "WATCHING"
        ? marketStateDescription(slot)
        : trackerStatusLabel(slot) === "IDLE"
          ? "Tracker is stored but polling is turned off."
          : trackerStatusLabel(slot) === "STALE"
            ? "Last backend update failed or is out of date."
            : trackerStatusLabel(slot) === "ERROR"
              ? "Tracker hit an error before a successful refresh."
              : "Slot is empty and ready for a new item.";

    if (!slot.occupied) {
      const card = document.createElement("div");
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div>
            <div style="font-weight:700;font-size:14px;">Slot ${slot.slotNumber}</div>
            <div style="font-size:11px;color:#5f6f7b;">Empty slot ready for a new watch item</div>
          </div>
          <span style="padding:4px 8px;border-radius:999px;background:${trackerBadgeColor};color:#fff;font-size:11px;font-weight:700;letter-spacing:0.04em;">EMPTY</span>
        </div>
        <div style="margin-top:10px;font-size:12px;color:#5f6f7b;">
          Add an item into this slot. Filled slots count against the 6-slot limit. Empty slots remain available.
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;">
          <button data-slot-action="add" data-slot="${slot.slotNumber}" ${state.form.busy || featuresBlockedByCompatibility() ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${state.form.busy || featuresBlockedByCompatibility() ? "#d5dce2" : "#0d5ea8"};color:${state.form.busy || featuresBlockedByCompatibility() ? "#61707c" : "#fff"};font-size:12px;font-weight:700;">Add Item</button>
        </div>
        ${isEditingThisSlot ? buildSlotEditor() : ""}
      `;

      Object.assign(card.style, {
        border: "1px dashed rgba(95,111,123,0.45)",
        borderRadius: "12px",
        padding: "12px",
        background: "linear-gradient(180deg, rgba(252,253,254,0.98), rgba(246,249,251,0.98))",
        boxShadow: "0 8px 18px rgba(0,0,0,0.05)"
      });

      return card;
    }

    const eventText =
      slot.notification && slot.notification.ageMs <= RECENT_ALERT_WINDOW_MS
        ? `<div style="font-size:11px;color:#6a4d00;">
            <strong>Recent alert:</strong> ${escapeHtml(
              formatNotificationHeadline(slot.notification, slot)
            )}
            ${
              notificationAdditionalListingCount(slot.notification) > 0
                ? `<div style="margin-top:2px;">${escapeHtml(
                    `+${notificationAdditionalListingCount(slot.notification)} Listings available`
                  )}</div>`
                : ""
            }
            <div style="margin-top:2px;color:#8a6b00;">${formatTimestamp(
              slot.notification.timestamp
            )}</div>
          </div>`
        : "";

    const card = document.createElement("div");
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;font-size:14px;">Slot ${slot.slotNumber}: ${escapeHtml(
      slot.itemName
    )}</div>
          <div style="font-size:11px;color:#5f6f7b;">Item ${slot.itemId} | Source ${escapeHtml(
      sourceModeLabel(slotSourceMode(slot))
    )}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          <span style="padding:4px 8px;border-radius:999px;background:#0d5ea8;color:#fff;font-size:11px;font-weight:700;letter-spacing:0.04em;">${escapeHtml(
      sourceModeShortLabel(slotSourceMode(slot))
    )}</span>
          <span style="padding:4px 8px;border-radius:999px;background:${trackerBadgeColor};color:#fff;font-size:11px;font-weight:700;letter-spacing:0.04em;">${escapeHtml(
      trackerStatusLabel(slot)
    )}</span>
          <span style="padding:4px 8px;border-radius:999px;background:${marketBadgeColor};color:#fff;font-size:11px;font-weight:700;letter-spacing:0.04em;">${escapeHtml(
      marketStateLabel(slot)
    )}</span>
        </div>
      </div>
      <div style="margin-top:8px;font-size:11px;color:#5f6f7b;">${escapeHtml(slotStatusText)}</div>
      <div style="margin-top:6px;font-size:11px;color:${dataState.color};"><strong>${escapeHtml(
      dataState.label
    )}:</strong> ${escapeHtml(dataState.detail)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;font-size:12px;">
        <div>Target: <strong>${formatMoney(slot.targetPrice)}</strong></div>
        <div>Gap: <strong>${formatMoney(slot.nearMissGap)}</strong></div>
        <div>Lowest: <strong>${formatMoney(slot.lowestPrice)}</strong></div>
        <div>Lowest above: <strong>${formatMoney(slot.lowestAboveTarget)}</strong></div>
        <div>Price vs target: <strong>${escapeHtml(formatDifferenceFromTarget(slot))}</strong></div>
        <div>Checked: <strong>${formatTimestamp(slot.lastChecked)}</strong></div>
      </div>
      <div style="margin-top:8px;font-size:11px;color:#5f6f7b;">
        Tracking ${escapeHtml(sourceModeLabel(slotSourceMode(slot)))} | ${
          isBazaarMode(slot)
            ? `Current bazaar listings ${escapeHtml(
                String(slot.market?.fetchedListings ?? slot.currentListings?.length ?? 0)
              )}${slot.market?.hasMoreListings ? ` of ${escapeHtml(String(slot.market?.totalListings ?? 0))}` : ""}`
            : `Market rows ${escapeHtml(String(slot.market?.fetchedListings ?? slot.currentListings?.length ?? 0))}${Number.isFinite(Number(slot.market?.totalItems)) ? ` | Total items ${escapeHtml(String(slot.market.totalItems))}` : ""}`
        }
      </div>
      <div style="margin-top:8px;font-size:11px;color:${slot.stale ? "#a33c3c" : "#5f6f7b"};">
        ${slot.nearMissEnabled === false ? "Near-miss off" : "Near-miss on"}${slot.alertState?.pendingGroup ? ` | Alert grouping until ${formatTimestamp(slot.alertState.pendingGroup.windowEndsAt)}` : ""}${cooldownText ? ` | Cooling down ${cooldownText}` : ""}${slot.alertState?.lastAlertedAt ? ` | Last alert ${formatTimestamp(slot.alertState.lastAlertedAt)}` : ""}${slot.lastError ? ` | ${escapeHtml(slot.lastError)}` : ""}
      </div>
      ${eventText}
      ${buildSourceToggle(slot, false)}
      ${buildListingsMarkup(slot, false)}
      <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-size:11px;color:#5f6f7b;">Trend: ${escapeHtml(
          slot.history?.trendDirection || "UNKNOWN"
        )}</div>
        ${
          slot.links?.tornMarket && !isBazaarMode(slot)
            ? `<button data-market-url="${escapeHtml(
                slot.links.tornMarket
              )}" style="border:none;border-radius:10px;padding:8px 10px;background:#0d5ea8;color:#fff;font-size:12px;font-weight:700;">Open market</button>`
            : `<span style="font-size:11px;color:#5f6f7b;">${isBazaarMode(slot) ? "Bazaar links are shown per seller below." : "No market link"}</span>`
        }
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button data-slot-action="toggle-enabled" data-slot="${slot.slotNumber}" ${busy ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${busy ? "#d5dce2" : slot.enabled ? "#eef3f7" : "#dfead6"};color:#12314a;font-size:12px;font-weight:700;">${escapeHtml(
      slotToggleLabel(slot)
    )}</button>
        <button data-slot-action="edit" data-slot="${slot.slotNumber}" ${busy ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${busy ? "#d5dce2" : "#0d5ea8"};color:${busy ? "#61707c" : "#fff"};font-size:12px;font-weight:700;">Edit</button>
        <button data-slot-action="remove" data-slot="${slot.slotNumber}" ${busy ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${busy ? "#d5dce2" : "#f0d7d7"};color:${busy ? "#61707c" : "#6f2424"};font-size:12px;font-weight:700;">${escapeHtml(
      slotActionLabel(slot.slotNumber, "Remove")
    )}</button>
      </div>
      ${isEditingThisSlot ? buildSlotEditor() : ""}
    `;

    Object.assign(card.style, {
      border: `1px solid ${slot.stale ? "rgba(163,60,60,0.35)" : "rgba(13,94,168,0.12)"}`,
      borderRadius: "12px",
      padding: "12px",
      background: slot.stale
        ? "linear-gradient(180deg, rgba(255,245,245,0.98), rgba(255,250,250,0.98))"
        : "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,250,253,0.98))",
      boxShadow: "0 8px 18px rgba(0,0,0,0.08)"
    });

    return card;
  }

  function buildCompactSlotCard(slot) {
    const card = document.createElement("div");
    const busy = isSlotBusy(slot.slotNumber);
    const cooldownText = formatCooldownRemaining(slot);
    const compactChecked = formatCompactTime(slot);
    const dataState = slotDataStateInfo(slot);

    if (!slot.occupied) {
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div>
            <div style="font-size:13px;font-weight:700;">Slot ${slot.slotNumber}</div>
            <div style="margin-top:2px;font-size:11px;color:#5f6f7b;">Empty</div>
          </div>
          <span style="padding:4px 8px;border-radius:999px;background:${trackerStatusColor(slot)};color:#fff;font-size:10px;font-weight:700;">EMPTY</span>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#5f6f7b;">Last checked: ${compactChecked}</div>
      `;
    } else {
      const eventText =
        slot.notification && slot.notification.ageMs <= RECENT_ALERT_WINDOW_MS
          ? `<div style="margin-top:8px;font-size:11px;color:#6a4d00;">
              <strong>Recent alert:</strong> ${escapeHtml(
                formatNotificationHeadline(slot.notification, slot)
              )}
              ${
                notificationAdditionalListingCount(slot.notification) > 0
                  ? `<div style="margin-top:2px;">${escapeHtml(
                      `+${notificationAdditionalListingCount(slot.notification)} Listings available`
                    )}</div>`
                  : ""
              }
            </div>`
          : "";

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div>
            <div style="font-size:13px;font-weight:700;">Slot ${slot.slotNumber}: ${escapeHtml(
        slot.itemName
      )}</div>
            <div style="margin-top:2px;font-size:11px;color:#5f6f7b;">Item ${slot.itemId} | ${escapeHtml(
        sourceModeLabel(slotSourceMode(slot))
      )}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
            <span style="padding:4px 8px;border-radius:999px;background:#0d5ea8;color:#fff;font-size:10px;font-weight:700;">${escapeHtml(
        sourceModeShortLabel(slotSourceMode(slot))
      )}</span>
            <span style="padding:4px 8px;border-radius:999px;background:${trackerStatusColor(slot)};color:#fff;font-size:10px;font-weight:700;">${escapeHtml(
        trackerStatusLabel(slot)
      )}</span>
            <span style="padding:4px 8px;border-radius:999px;background:${stateColor(slot)};color:#fff;font-size:10px;font-weight:700;">${escapeHtml(
        marketStateLabel(slot)
      )}</span>
          </div>
        </div>
        <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:#143041;">
          <div>Lowest: <strong>${formatMoney(slot.lowestPrice)}</strong></div>
          <div>Target: <strong>${formatMoney(slot.targetPrice)}</strong></div>
          <div>Vs target: <strong>${escapeHtml(formatDifferenceFromTarget(slot))}</strong></div>
          <div>Checked: <strong>${compactChecked}</strong></div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:${slot.stale || slot.lastError ? "#a33c3c" : "#5f6f7b"};">
          ${slot.nearMissEnabled === false ? "Near-miss off" : "Near-miss on"}${cooldownText ? ` | Cooling down ${cooldownText}` : ""}${slot.lastError ? ` | ${escapeHtml(slot.lastError)}` : ""}
        </div>
        <div style="margin-top:6px;font-size:11px;color:${dataState.color};">${escapeHtml(
          dataState.label
        )}</div>
        ${eventText}
        ${buildSourceToggle(slot, true)}
        ${buildListingsMarkup(slot, true)}
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button data-slot-action="toggle-enabled" data-slot="${slot.slotNumber}" ${busy ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${busy ? "#d5dce2" : slot.enabled ? "#eef3f7" : "#dfead6"};color:#12314a;font-size:12px;font-weight:700;">${escapeHtml(
        slotToggleLabel(slot)
      )}</button>
          ${
            slot.links?.tornMarket && !isBazaarMode(slot)
              ? `<button data-market-url="${escapeHtml(
                  slot.links.tornMarket
                )}" style="border:none;border-radius:10px;padding:8px 10px;background:#0d5ea8;color:#fff;font-size:12px;font-weight:700;">Open market</button>`
              : ""
          }
        </div>
      `;
    }

    Object.assign(card.style, {
      border: `1px solid ${slot.stale ? "rgba(163,60,60,0.35)" : "rgba(13,94,168,0.12)"}`,
      borderRadius: "12px",
      padding: "10px",
      background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,250,253,0.98))",
      boxShadow: "0 6px 16px rgba(0,0,0,0.06)"
    });

    return card;
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);

    if (panel) {
      return panel;
    }

    panel = document.createElement("section");
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: "fixed",
      right: "12px",
      bottom: "12px",
      width: "min(430px, calc(100vw - 24px))",
      maxHeight: "80vh",
      overflow: "auto",
      zIndex: "999998",
      borderRadius: "18px",
      background: "linear-gradient(180deg, rgba(244,249,253,0.98), rgba(235,243,249,0.98))",
      border: "1px solid rgba(13,94,168,0.18)",
      boxShadow: "0 20px 50px rgba(0,0,0,0.28)",
      fontFamily: "'Segoe UI', Tahoma, sans-serif",
      color: "#143041",
      backdropFilter: "blur(10px)"
    });

    document.body.appendChild(panel);
    return panel;
  }

  function bindFormFieldHandlers(panel) {
    panel.querySelectorAll("[data-form-field]").forEach((element) => {
      element.addEventListener("input", (event) => {
        const field = event.currentTarget.getAttribute("data-form-field");

        if (field === "enabled") {
          state.form.enabled = Boolean(event.currentTarget.checked);
        } else {
          state.form[field] = event.currentTarget.value;
        }
      });

      if (element.type === "checkbox") {
        element.addEventListener("change", (event) => {
          state.form.enabled = Boolean(event.currentTarget.checked);
        });
      }
    });

    panel.querySelectorAll("[data-form-source]").forEach((element) => {
      element.onclick = () => {
        state.form.sourceMode = normalizeSourceMode(
          element.getAttribute("data-form-source")
        );
        render();
      };
    });
  }

  async function saveSettings() {
    if (!ensureCompatibleBeforeAction()) {
      return;
    }

    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok) {
      state.settingsForm.error = normalized.error;
      state.lastError = normalized.error;
      render();
      return;
    }

    const alertCooldownSeconds = Number.parseInt(state.settingsForm.alertCooldownSeconds, 10);
    const snapshotGroupingWindowSeconds = Number.parseInt(
      state.settingsForm.snapshotGroupingWindowSeconds,
      10
    );

    if (!Number.isInteger(alertCooldownSeconds) || alertCooldownSeconds < 0) {
      state.settingsForm.error = "Cooldown must be 0 or more seconds.";
      render();
      return;
    }

    if (
      !Number.isInteger(snapshotGroupingWindowSeconds) ||
      snapshotGroupingWindowSeconds < 0
    ) {
      state.settingsForm.error = "Snapshot window must be 0 or more seconds.";
      render();
      return;
    }

    const endpoint = buildApiUrl(normalized.baseUrl, "/api/settings");

    if (!endpoint) {
      state.settingsForm.error = "Bad URL construction for settings save.";
      render();
      return;
    }

    state.settingsForm.busy = true;
    state.settingsForm.error = null;
    render();
    try {
      const result = await requestJson(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          alertCooldownMs: alertCooldownSeconds * 1000,
          snapshotGroupingWindowMs: snapshotGroupingWindowSeconds * 1000
        })
      });

      if (!result.ok) {
        state.settingsForm.error = result.error.message;
        state.lastError = result.error.message;
        return;
      }

      syncSettings(result.payload?.settings || null);
      persistCachedCollection();
      state.settingsForm.error = null;
      updateConnection("success", "Alert settings saved.", `Requested URL: ${endpoint}`);
    } finally {
      state.settingsForm.busy = false;
      render();
    }
  }

  function render() {
    const panel = ensurePanel();
    const slotsMarkup = document.createElement("div");
    const watcherReadiness = getWatcherReadiness();
    const canStartWatching =
      watcherReadiness.canStart && !state.watcher.active && !state.watcher.polling;
    const canStopWatching = state.watcher.active || state.watcher.polling;
    const compactMode = isCompactMode();
    const modeButtonLabel = compactMode ? "Manage Mode" : "Compact Mode";
    const featureBlock = featuresBlockedByCompatibility();

    if (state.ui.collapsed) {
      panel.onscroll = null;
      panel.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;">
          <button data-action="expand-panel" style="border:none;border-radius:999px;padding:12px 14px;background:#0d5ea8;color:#fff;font-size:12px;font-weight:700;box-shadow:0 12px 24px rgba(0,0,0,0.22);">Open Menu</button>
        </div>
      `;
      Object.assign(panel.style, {
        width: "auto",
        maxHeight: "none",
        overflow: "visible",
        borderRadius: "999px",
        background: "transparent",
        border: "none",
        boxShadow: "none",
        backdropFilter: "none"
      });
      panel.style.left = `${HIDDEN_LAUNCHER_OFFSET_PX}px`;
      panel.style.right = "auto";
      panel.style.bottom = `${HIDDEN_LAUNCHER_OFFSET_PX}px`;
      panel.style.top = "auto";
      panel.querySelector('[data-action="expand-panel"]').onclick = () => setCollapsed(false);
      return;
    }

    Object.assign(panel.style, {
      width: "min(430px, calc(100vw - 24px))",
      maxHeight: "80vh",
      overflow: "auto",
      borderRadius: "18px",
      background: "linear-gradient(180deg, rgba(244,249,253,0.98), rgba(235,243,249,0.98))",
      border: "1px solid rgba(13,94,168,0.18)",
      boxShadow: "0 20px 50px rgba(0,0,0,0.28)",
      backdropFilter: "blur(10px)",
      WebkitOverflowScrolling: "touch",
      overscrollBehavior: "contain",
      touchAction: "pan-y",
      pointerEvents: "auto"
    });
    panel.style.right = "12px";
    panel.style.left = "auto";
    panel.style.bottom = "12px";
    panel.style.top = "auto";

    panel.innerHTML = `
      <div style="position:sticky;top:0;z-index:3;padding:10px 12px;border-bottom:1px solid rgba(13,94,168,0.12);background:linear-gradient(180deg, rgba(244,249,253,0.99), rgba(237,244,249,0.98));backdrop-filter:blur(10px);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div>
            <div style="font-size:15px;font-weight:800;">Market Watcher</div>
            <div style="font-size:11px;color:#5f6f7b;">${compactMode ? "Compact tracker view. Switch to Manage Mode for setup, editing, and reset tools." : "Base backend URL only. Start Watching is required before any backend polling occurs. Reload Saved Slots only re-reads current backend output."}</div>
          </div>
          <button data-action="collapse-panel" aria-label="Hide Menu" title="Hide Menu" style="align-self:flex-start;border:none;border-radius:999px;padding:6px 10px;background:#d9e8f6;color:#12314a;font-size:15px;font-weight:800;line-height:1;min-width:34px;">▴</button>
        </div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
          <button data-action="toggle-mode" style="border:none;border-radius:10px;padding:8px 10px;background:#eef3f7;color:#12314a;font-size:12px;font-weight:700;">${modeButtonLabel}</button>
          <button data-action="manual-refresh" ${state.requests.manualRefresh || featureBlock || !state.watcher.active ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${state.requests.manualRefresh || featureBlock || !state.watcher.active ? "#d5dce2" : "#0d5ea8"};color:${state.requests.manualRefresh || featureBlock || !state.watcher.active ? "#61707c" : "#fff"};font-size:12px;font-weight:700;">${state.requests.manualRefresh ? "Refreshing..." : "Refresh Now"}</button>
        </div>
      </div>
      <div style="padding:12px 12px 0;">
        <div style="margin-top:10px;padding:10px;border-radius:12px;background:rgba(255,255,255,0.82);border:1px solid rgba(13,94,168,0.12);">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
            <div>
              <div style="font-size:11px;color:#5f6f7b;">Watcher Status</div>
              <div style="margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="padding:4px 8px;border-radius:999px;background:${watcherColor()};color:#fff;font-size:11px;font-weight:700;letter-spacing:0.04em;">${escapeHtml(
      state.watcher.status
    )}</span>
                <span style="font-size:11px;color:#5f6f7b;">${escapeHtml(watcherDetail())}</span>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button data-action="start-watching" ${canStartWatching ? "" : "disabled"} style="${watcherButtonStyle(
                "start",
                !canStartWatching
              )}">Start Watching</button>
              <button data-action="stop-watching" ${canStopWatching ? "" : "disabled"} style="${watcherButtonStyle(
                "stop",
                !canStopWatching
              )}">Stop Watching</button>
            </div>
          </div>
          <div style="margin-top:8px;display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#5f6f7b;">
            <span>Checking: ${state.watcher.polling ? "Yes" : "No"}</span>
            <span>Last started: ${formatTimestamp(state.watcher.lastStartedAt)}</span>
            <span>Last completed: ${formatTimestamp(state.watcher.lastCompletedAt)}</span>
            <span>Last success: ${formatTimestamp(state.watcher.lastSuccessfulAt)}</span>
            <span>Updated: ${formatTimestamp(state.lastFetchAt)}</span>
          </div>
          <div style="margin-top:6px;font-size:11px;color:${state.watcher.status === "ERROR" ? "#a33c3c" : "#5f6f7b"};">
            ${escapeHtml(
              state.watcher.lastError ||
                watcherReadiness.reason ||
                "Global Start Watching enables backend polling. Stop Watching disables all slot activity even if slot toggles remain on."
            )}
          </div>
          <div style="margin-top:6px;font-size:11px;color:${state.requests.restoreSync ? "#0d5ea8" : "#5f6f7b"};">
            ${escapeHtml(restoreDetail())}
          </div>
        </div>
        ${renderTimingSection()}
        ${renderCompatibilityWarning()}
        ${renderAboutSection()}
        ${
          compactMode
            ? `<div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#5f6f7b;">
                <span>Filled: ${state.summary?.occupiedCount ?? 0}/${state.summary?.slotLimit ?? 6}</span>
                <span>Enabled: ${state.summary?.enabledCount ?? 0}</span>
                <span>Updated: ${formatTimestamp(
                  state.lastFetchAt || state.watcher.lastSuccessfulAt
                )}</span>
              </div>`
            : `<div style="margin-top:10px;padding:10px;border-radius:12px;background:rgba(255,255,255,0.75);border:1px solid rgba(13,94,168,0.12);">
                <label style="display:block;font-size:11px;font-weight:700;color:#143041;">
                  Base Backend URL
                  <input data-action="backend-input" type="text" value="${escapeHtml(
                    state.backendInput
                  )}" placeholder="${escapeHtml(
        EXAMPLE_BACKEND_URL
      )}" style="margin-top:6px;width:100%;box-sizing:border-box;border:1px solid rgba(13,94,168,0.2);border-radius:10px;padding:9px 10px;font-size:12px;" />
                </label>
                <div style="margin-top:6px;font-size:11px;color:#5f6f7b;">
                  Example: <strong>${escapeHtml(EXAMPLE_BACKEND_URL)}</strong>. Do not enter <code>/health</code> or <code>/api/status</code> manually.
                </div>
                <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
                  <button data-action="save-backend" ${state.requests.connectionTest ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${state.requests.connectionTest ? "#d5dce2" : "#0d5ea8"};color:${state.requests.connectionTest ? "#61707c" : "#fff"};font-size:12px;font-weight:700;">${state.requests.connectionTest ? "Testing..." : "Save URL"}</button>
                  <button data-action="test-backend" ${state.requests.connectionTest ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${state.requests.connectionTest ? "#d5dce2" : "#d9e8f6"};color:#12314a;font-size:12px;font-weight:700;">${state.requests.connectionTest ? "Testing..." : "Connection Test"}</button>
                  <button data-action="export-settings" ${state.requests.exportSettings || featureBlock ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${state.requests.exportSettings || featureBlock ? "#d5dce2" : "#eef3f7"};color:#12314a;font-size:12px;font-weight:700;">${state.requests.exportSettings ? "Exporting..." : "Export Settings"}</button>
                  <button data-action="import-settings" ${state.requests.importSettings || featureBlock ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${state.requests.importSettings || featureBlock ? "#d5dce2" : "#eef3f7"};color:#12314a;font-size:12px;font-weight:700;">Import Settings</button>
                </div>
                <div style="margin-top:8px;font-size:11px;color:${connectionColor()};">${escapeHtml(
        state.connection.message
      )}</div>
                ${
                  state.connection.details
                    ? `<div style="margin-top:4px;font-size:11px;color:#5f6f7b;">${escapeHtml(
                        state.connection.details
                      )}</div>`
                    : ""
                }
                <div style="margin-top:6px;font-size:11px;color:#5f6f7b;">Last transport used: ${escapeHtml(
                  state.runtime.lastTransport
                )}</div>
                ${renderEndpointDiagnostics()}
              </div>
              ${renderAlertSettings()}
              <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:#5f6f7b;">
                <span>Filled: ${state.summary?.occupiedCount ?? 0}/${state.summary?.slotLimit ?? 6}</span>
                <span>Empty: ${state.summary?.emptyCount ?? 6}</span>
                <span>Enabled: ${state.summary?.enabledCount ?? 0}</span>
                <span>Buy now: ${state.summary?.buyNowCount ?? 0}</span>
                <span>Near miss: ${state.summary?.nearMissCount ?? 0}</span>
                <span>Stale: ${state.summary?.staleCount ?? 0}</span>
              </div>
              <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
                <button data-action="reset-all" ${state.requests.resetAll || featureBlock ? "disabled" : ""} style="border:none;border-radius:10px;padding:8px 10px;background:${state.requests.resetAll || featureBlock ? "#d5dce2" : "#f0d7d7"};color:${state.requests.resetAll || featureBlock ? "#61707c" : "#6f2424"};font-size:12px;font-weight:700;">${state.requests.resetAll ? "Resetting..." : "Reset All Slots"}</button>
              </div>`
        }
        ${compactMode ? "" : renderActivitySection()}
        ${compactMode ? "" : renderBackupDialog()}
        ${
          state.lastError
            ? `<div style="margin-top:8px;font-size:11px;color:#a33c3c;">${escapeHtml(
                state.lastError
              )}</div>`
            : ""
        }
      </div>
    `;

    slotsMarkup.style.padding = "12px";
    slotsMarkup.style.display = "grid";
    slotsMarkup.style.gap = compactMode ? "8px" : "10px";

    const visibleSlots = state.slots.length ? state.slots : createEmptySlots(6);

    visibleSlots.forEach((slot) => {
      slotsMarkup.appendChild(compactMode ? buildCompactSlotCard(slot) : buildSlotCard(slot));
    });

    panel.appendChild(slotsMarkup);
    panel.onscroll = () => {
      state.runtime.menuScrollTop = panel.scrollTop || 0;
    };

    panel.querySelector('[data-action="collapse-panel"]').onclick = () => setCollapsed(true);
    panel.querySelector('[data-action="toggle-mode"]').onclick = () =>
      setViewMode(compactMode ? "full" : "compact");
    panel.querySelector('[data-action="manual-refresh"]').onclick = () => {
      void manualRefreshNow();
    };
    panel.querySelector('[data-action="start-watching"]').onclick = () => {
      void startWatching();
    };
    panel.querySelector('[data-action="stop-watching"]').onclick = () => stopWatching("manual");
    panel.querySelector('[data-action="toggle-app-notifications"]').onclick = () => {
      void toggleAppNotifications();
    };
    const exportButton = panel.querySelector('[data-action="export-settings"]');
    if (exportButton) {
      exportButton.onclick = () => {
        void openExportDialog();
      };
    }
    const importButton = panel.querySelector('[data-action="import-settings"]');
    if (importButton) {
      importButton.onclick = () => {
        openImportDialog();
      };
    }
    const toggleActivityButton = panel.querySelector('[data-action="toggle-activity"]');
    if (toggleActivityButton) {
      toggleActivityButton.onclick = () => toggleActivityExpanded();
    }
    const closeBackupButton = panel.querySelector('[data-action="close-backup-dialog"]');
    if (closeBackupButton) {
      closeBackupButton.onclick = () => closeBackupDialog();
    }
    const copyBackupButton = panel.querySelector('[data-action="copy-backup-dialog"]');
    if (copyBackupButton) {
      copyBackupButton.onclick = () => {
        void copyBackupDialogText();
      };
    }
    const applyImportButton = panel.querySelector('[data-action="apply-import-backup"]');
    if (applyImportButton) {
      applyImportButton.onclick = () => {
        void applyImportedBackup();
      };
    }
    const backupTextArea = panel.querySelector('[data-action="backup-dialog-text"]');
    if (backupTextArea) {
      backupTextArea.oninput = (event) => {
        state.backupDialog.text = event.currentTarget.value;
      };
    }

    if (!compactMode) {
      panel.querySelector('[data-action="save-backend"]').onclick = () =>
        runConnectionTest({ persistOnSuccess: true });
      panel.querySelector('[data-action="test-backend"]').onclick = () =>
        runConnectionTest({ persistOnSuccess: false });
      panel.querySelector('[data-action="save-settings"]').onclick = () => {
        void saveSettings();
      };
      panel.querySelector('[data-action="reset-settings"]').onclick = () => {
        state.settingsForm = createSettingsFormState(state.settings);
        render();
      };
      panel.querySelector('[data-action="reset-all"]').onclick = () => {
        void resetAllSlots();
      };

      const backendInput = panel.querySelector('[data-action="backend-input"]');
      backendInput.oninput = (event) => {
        state.backendInput = event.currentTarget.value;
      };

      panel.querySelectorAll("[data-settings-field]").forEach((element) => {
        element.addEventListener("input", (event) => {
          const field = event.currentTarget.getAttribute("data-settings-field");
          state.settingsForm[field] = event.currentTarget.value;
        });
      });
    }

    panel.querySelectorAll("[data-slot-action]").forEach((button) => {
      button.onclick = () => {
        const slotNumber = Number(button.getAttribute("data-slot"));
        const action = button.getAttribute("data-slot-action");
        const slot = (state.slots.length ? state.slots : createEmptySlots(6)).find(
          (entry) => entry.slotNumber === slotNumber
        );

        if (!slot) {
          return;
        }

        if (action === "add") {
          openAddForm(slotNumber);
        } else if (action === "edit") {
          openEditForm(slot);
        } else if (action === "remove") {
          void clearSlot(slot);
        } else if (action === "toggle-enabled") {
          void toggleSlotEnabled(slot);
        } else if (action === "set-source") {
          void toggleSlotSource(slot, button.getAttribute("data-source-mode"));
        }
      };
    });

    panel.querySelectorAll("[data-market-url]").forEach((button) => {
      button.onclick = () => {
        openExternalLink(button.getAttribute("data-market-url"), "Torn market link");
      };
    });

    panel.querySelectorAll("[data-external-url]").forEach((button) => {
      button.onclick = () => {
        openExternalLink(
          button.getAttribute("data-external-url"),
          button.getAttribute("data-link-context") || "external link"
        );
      };
    });

    panel.querySelectorAll("[data-listings-toggle]").forEach((button) => {
      button.onclick = () => {
        const slotNumber = Number(button.getAttribute("data-listings-toggle"));
        setListingsExpanded(slotNumber, !areListingsExpanded(slotNumber));
      };
    });

    const submitButton = panel.querySelector('[data-action="submit-slot"]');

    if (submitButton) {
      submitButton.onclick = submitSlotForm;
    }

    const cancelButton = panel.querySelector('[data-action="cancel-slot"]');

    if (cancelButton) {
      cancelButton.onclick = closeSlotForm;
    }

    const reloadButton = panel.querySelector('[data-action="reload-slots"]');

    if (reloadButton) {
      reloadButton.onclick = () => {
        void refresh(true);
      };
    }

    bindFormFieldHandlers(panel);
  }

  function openAddForm(slotNumber) {
    collapseListingSection(slotNumber);
    state.form = {
      mode: "add",
      slotNumber,
      itemId: "",
      itemName: "",
      targetPrice: "",
      nearMissGap: "0",
      sourceMode: SOURCE_MODES.MARKET_ONLY,
      enabled: true,
      busy: false,
      error: null
    };
    render();
  }

  function openEditForm(slot) {
    collapseListingSection(slot.slotNumber);
    state.form = {
      mode: "edit",
      slotNumber: slot.slotNumber,
      itemId: String(slot.itemId || ""),
      itemName: slot.itemName || "",
      targetPrice: String(slot.targetPrice ?? ""),
      nearMissGap: String(slot.nearMissGap ?? ""),
      sourceMode: slotSourceMode(slot),
      enabled: Boolean(slot.enabled),
      busy: false,
      error: null
    };
    render();
  }

  function closeSlotForm() {
    state.form = createFormState();
    render();
  }

  function validateSlotForm() {
    const rawItemId = String(state.form.itemId || "").trim();
    const itemId = rawItemId ? Number.parseInt(rawItemId, 10) : null;
    const targetPrice = Number.parseInt(state.form.targetPrice, 10);
    const nearMissGap = Number.parseInt(state.form.nearMissGap, 10);
    const itemName = String(state.form.itemName || "").trim();

    if (!rawItemId && !itemName) {
      return { ok: false, error: "Enter an item ID or item name." };
    }

    if (rawItemId && (!Number.isInteger(itemId) || itemId <= 0)) {
      return { ok: false, error: "Item ID must be a positive integer." };
    }

    if (!Number.isInteger(targetPrice) || targetPrice < 0) {
      return { ok: false, error: "Target price must be a non-negative integer." };
    }

    if (!Number.isInteger(nearMissGap) || nearMissGap < 0) {
      return { ok: false, error: "Near-miss gap must be a non-negative integer." };
    }

    return {
      ok: true,
      payload: {
        itemId: itemId ?? "",
        itemName,
        targetPrice,
        nearMissGap,
        sourceMode: normalizeSourceMode(state.form.sourceMode),
        enabled: Boolean(state.form.enabled)
      }
    };
  }

  async function submitSlotForm() {
    if (!ensureCompatibleBeforeAction()) {
      return;
    }

    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok) {
      state.form.error = normalized.error;
      state.lastError = normalized.error;
      render();
      return;
    }

    const validation = validateSlotForm();

    if (!validation.ok) {
      state.form.error = validation.error;
      render();
      return;
    }

    const endpoint =
      state.form.mode === "add"
        ? buildApiUrl(normalized.baseUrl, `/api/slot/${state.form.slotNumber}/watch`)
        : buildApiUrl(normalized.baseUrl, `/api/slot/${state.form.slotNumber}/update`);
    const method = "POST";

    if (!endpoint) {
      state.form.error = "Bad URL construction for slot save request.";
      render();
      return;
    }

    if (state.form.busy) {
      return;
    }

    const activeSlotNumber = state.form.slotNumber;
    state.form.busy = true;
    state.requests.slotAction = {
      slotNumber: activeSlotNumber,
      action: state.form.mode === "add" ? "add" : "save"
    };
    state.form.error = null;
    state.lastError = null;
    render();

    try {
      const result = await requestJson(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(validation.payload)
      });

      if (!result.ok) {
        state.form.error = result.error.message;
        state.lastError = result.error.message;
        updateConnection("error", result.error.message, `Requested URL: ${endpoint}`);
        return;
      }

      if (!result.payload?.slot?.slotNumber) {
        const malformedError = createMalformedResponseError(endpoint, "slot data");
        state.form.error = malformedError.message;
        state.lastError = malformedError.message;
        updateConnection("error", malformedError.message, `Requested URL: ${endpoint}`);
        return;
      }

      applySingleSlotPayload(result.payload.slot);
      updateConnection(
        "success",
        `Slot ${activeSlotNumber} saved successfully.`,
        `Requested URL: ${endpoint}`
      );
      state.form = createFormState();
      render();

      const syncResult = await syncSlotsFromBackend({
        successMessage: `Slot ${activeSlotNumber} is now up to date.`
      });

      if (!syncResult.ok) {
        state.lastError = `Slot ${activeSlotNumber} was saved, but reloading the latest slot state failed. Use Reload Saved Slots to retry.`;
        updateConnection(
          "partial",
          state.lastError,
          `Requested URL: ${endpoint}`
        );
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed unexpectedly.";
      state.form.error = message;
      state.lastError = message;
      updateConnection("error", message, `Requested URL: ${endpoint}`);
    } finally {
      state.form.busy = false;
      state.requests.slotAction = null;
      render();
    }
  }

  async function clearSlot(slot) {
    if (!ensureCompatibleBeforeAction()) {
      return;
    }

    const confirmed = window.confirm(
      `Remove ${slot.itemName} from slot ${slot.slotNumber} and reopen that slot?`
    );

    if (!confirmed) {
      return;
    }

    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok) {
      state.lastError = normalized.error;
      render();
      return;
    }

    const endpoint = buildApiUrl(normalized.baseUrl, `/api/slot/${slot.slotNumber}/clear`);

    if (!endpoint) {
      state.lastError = "Bad URL construction for slot delete request.";
      render();
      return;
    }

    state.requests.slotAction = {
      slotNumber: slot.slotNumber,
      action: "delete"
    };
    state.lastError = null;
    render();

    try {
      const result = await requestJson(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: "{}"
      });

      if (!result.ok) {
        state.lastError = result.error.message;
        updateConnection("error", result.error.message, `Requested URL: ${endpoint}`);
        return;
      }

      applyEmptySlotState(slot.slotNumber);
      state.form = createFormState();
      render();

      const syncResult = await syncSlotsFromBackend({
        successMessage: `Slot ${slot.slotNumber} was cleared successfully.`
      });

      if (!syncResult.ok) {
        state.lastError = `Slot ${slot.slotNumber} was cleared, but reloading the latest slot state failed.`;
        updateConnection("partial", state.lastError, `Requested URL: ${endpoint}`);
      }
    } finally {
      state.requests.slotAction = null;
      render();
    }
  }

  async function toggleSlotEnabled(slot) {
    if (!ensureCompatibleBeforeAction()) {
      return;
    }

    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok) {
      state.lastError = normalized.error;
      render();
      return;
    }

    const endpoint = buildApiUrl(normalized.baseUrl, `/api/slot/${slot.slotNumber}/enabled`);

    if (!endpoint) {
      state.lastError = "Bad URL construction for slot toggle request.";
      render();
      return;
    }

    state.requests.slotToggle = slot.slotNumber;
    state.lastError = null;
    render();

    try {
      const result = await requestJson(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          enabled: !slot.enabled
        })
      });

      if (!result.ok) {
        state.lastError = result.error.message;
        updateConnection("error", result.error.message, `Requested URL: ${endpoint}`);
        return;
      }

      if (result.payload?.slot?.slotNumber) {
        applySingleSlotPayload(result.payload.slot);
      }

      const syncResult = await syncSlotsFromBackend({
        successMessage: `Slot ${slot.slotNumber} is now ${slot.enabled ? "off" : "on"}.`
      });

      if (!syncResult.ok) {
        state.lastError = `Slot ${slot.slotNumber} was updated, but reloading the latest slot state failed.`;
        updateConnection("partial", state.lastError, `Requested URL: ${endpoint}`);
      }
    } finally {
      state.requests.slotToggle = null;
      render();
    }
  }

  async function toggleSlotSource(slot, nextSourceMode) {
    if (!ensureCompatibleBeforeAction()) {
      return;
    }

    const normalizedSourceMode = normalizeSourceMode(nextSourceMode);

    if (!slot.occupied || slotSourceMode(slot) === normalizedSourceMode) {
      return;
    }

    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok) {
      state.lastError = normalized.error;
      render();
      return;
    }

    const endpoint = buildApiUrl(normalized.baseUrl, `/api/slot/${slot.slotNumber}/update`);

    if (!endpoint) {
      state.lastError = "Bad URL construction for source switch request.";
      render();
      return;
    }

    state.requests.slotAction = {
      slotNumber: slot.slotNumber,
      action: "source"
    };
    collapseListingSection(slot.slotNumber);
    state.lastError = null;
    render();

    try {
      const result = await requestJson(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          itemId: slot.itemId,
          itemName: slot.itemName,
          targetPrice: slot.targetPrice,
          nearMissGap: slot.nearMissGap,
          sourceMode: normalizedSourceMode,
          enabled: slot.enabled
        })
      });

      if (!result.ok) {
        state.lastError = result.error.message;
        updateConnection("error", result.error.message, `Requested URL: ${endpoint}`);
        return;
      }

      if (result.payload?.slot?.slotNumber) {
        applySingleSlotPayload(result.payload.slot);
      }

      const syncResult = await syncSlotsFromBackend({
        successMessage: `Slot ${slot.slotNumber} now tracks ${sourceModeLabel(normalizedSourceMode)}.`
      });

      if (!syncResult.ok) {
        state.lastError = `Slot ${slot.slotNumber} source was updated, but reloading the latest slot state failed.`;
        updateConnection("partial", state.lastError, `Requested URL: ${endpoint}`);
      }
    } finally {
      state.requests.slotAction = null;
      render();
    }
  }

  async function resetAllSlots() {
    if (!ensureCompatibleBeforeAction()) {
      return;
    }

    const confirmed = window.confirm(
      "Clear all 6 slots and make them empty again? Global settings will be kept."
    );

    if (!confirmed) {
      return;
    }

    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok) {
      state.lastError = normalized.error;
      render();
      return;
    }

    const endpoint = buildApiUrl(normalized.baseUrl, "/api/slots/reset");

    if (!endpoint) {
      state.lastError = "Bad URL construction for reset-all request.";
      render();
      return;
    }

    state.requests.resetAll = true;
    state.lastError = null;
    render();

    try {
      const result = await requestJson(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: "{}"
      });

      if (!result.ok) {
        state.lastError = result.error.message;
        updateConnection("error", result.error.message, `Requested URL: ${endpoint}`);
        return;
      }

      state.slots = createEmptySlots(6);
      state.lastFetchAt = new Date().toISOString();
      state.form = createFormState();
      render();

      const syncResult = await syncSlotsFromBackend({
        successMessage: "All slots were reset successfully."
      });

      if (!syncResult.ok) {
        state.lastError = "All slots were cleared, but reloading the latest slot state failed.";
        updateConnection("partial", state.lastError, `Requested URL: ${endpoint}`);
      }
    } finally {
      state.requests.resetAll = false;
      render();
    }
  }

  function collectFreshTriggers(slots) {
    return slots.filter((slot) => {
      if (!slot.occupied) {
        return false;
      }

      const eventId = slot.notification?.eventId;

      if (!eventId || slot.notification.ageMs > RECENT_ALERT_WINDOW_MS) {
        return false;
      }

      const slotKey = `slot-${slot.slotNumber}`;

      if (state.seenEvents[slotKey] === eventId) {
        return false;
      }

      state.seenEvents[slotKey] = eventId;
      return true;
    });
  }

  async function syncSlotsFromBackend({ successMessage = null, showReloadState = false } = {}) {
    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok) {
      state.lastError = normalized.error;
      updateConnection("error", normalized.error, null);
      render();

      return {
        ok: false,
        error: normalized.error
      };
    }

    const slotsUrl = buildApiUrl(normalized.baseUrl, "/api/slots");

    if (!slotsUrl) {
      state.lastError = "Bad URL construction for /api/slots.";
      render();
      return {
        ok: false,
        error: state.lastError
      };
    }

    if (showReloadState) {
      state.requests.slotsReload = true;
      render();
    }
    try {
      const result = await requestJson(slotsUrl);

      if (!result.ok) {
        state.lastError = result.error.message;
        markConnectionTests({
          slots: endpointResultFromFailure("slots", slotsUrl, result)
        });
        updateConnection(
          "error",
          result.error.message,
          `Last attempted slots URL: ${slotsUrl}`
        );
        return {
          ok: false,
          error: result.error.message,
          transport: result.transport || null,
          url: slotsUrl
        };
      }

      if (!Array.isArray(result.payload?.slots)) {
        const malformedError = createMalformedResponseError(slotsUrl, "a slots array");
        state.lastError = malformedError.message;
        updateConnection("error", malformedError.message, `Last attempted slots URL: ${slotsUrl}`);
        return {
          ok: false,
          error: malformedError.message,
          transport: result.transport || null,
          url: slotsUrl
        };
      }

      applySlotsPayload(result.payload, new Date().toISOString());
      state.runtime.restoredFromCache = Array.isArray(state.slots) && state.slots.length > 0;
      state.runtime.restoreSource = "backend_sync";
      state.runtime.initialRestorePending = false;
      state.runtime.autoRestoreReason = null;
      markConnectionTests({
        slots: endpointResultFromSuccess(
          "slots",
          slotsUrl,
          result,
          "Slots endpoint returned valid JSON."
        )
      });
      updateConnection(
        featuresBlockedByCompatibility() ? "partial" : "success",
        featuresBlockedByCompatibility()
          ? compatibilityWarning()
          : successMessage || `Loaded current slot state from ${slotsUrl}.`,
        `Transport: ${result.transport}`
      );

      const freshTriggers = collectFreshTriggers(state.slots);
      saveSeenEvents();

      if (freshTriggers.length) {
        showBanner(freshTriggers);
      } else if (showReloadState) {
        pushDebugLog("info", "Manual refresh completed", {
          url: slotsUrl,
          transport: result.transport
        });
      }

      return {
        ok: true,
        transport: result.transport,
        url: slotsUrl
      };
    } finally {
      if (showReloadState) {
        state.requests.slotsReload = false;
      }
      render();
    }
  }

  async function maybeRestoreAndSync({ reason = "auto_restore", force = false } = {}) {
    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok) {
      state.runtime.initialRestorePending = false;
      return {
        ok: false,
        skipped: true,
        error: normalized.error
      };
    }

    if (state.ui.collapsed && !force) {
      state.runtime.initialRestorePending = true;
      state.runtime.autoRestoreReason = reason;
      return {
        ok: false,
        skipped: true
      };
    }

    if (
      state.requests.restoreSync ||
      state.requests.manualRefresh ||
      state.requests.connectionTest ||
      state.requests.slotsReload ||
      state.watcher.polling
    ) {
      return {
        ok: false,
        skipped: true
      };
    }

    const needsSync =
      force ||
      state.runtime.initialRestorePending ||
      !state.runtime.restoredFromCache ||
      shouldSyncCachedState(state.lastFetchAt);

    if (!needsSync) {
      state.runtime.initialRestorePending = false;
      state.runtime.autoRestoreReason = null;
      return {
        ok: true,
        skipped: true,
        usedCache: true
      };
    }

    state.requests.restoreSync = true;
    state.runtime.autoRestoreReason = reason;
    state.runtime.lastRestoreAttemptAt = new Date().toISOString();
    render();

    try {
      const result = await syncSlotsFromBackend({
        successMessage:
          reason === "open_menu"
            ? "Current slot state restored after opening the menu."
            : "Current slot state restored automatically."
      });

      if (result.ok) {
        state.runtime.initialRestorePending = false;
        state.runtime.restoredFromCache = Array.isArray(state.slots) && state.slots.length > 0;
        state.runtime.restoreSource = "backend_sync";
        state.runtime.autoRestoreReason = null;
      } else {
        state.runtime.initialRestorePending = true;
      }

      return result;
    } finally {
      state.requests.restoreSync = false;
      render();
    }
  }

  async function refresh(manual) {
    pushDebugLog("info", manual ? "Reload slots requested" : "Slots refresh requested", {
      manual,
      watcherActive: state.watcher.active,
      watcherStatus: state.watcher.status
    });

    return syncSlotsFromBackend({
      showReloadState: Boolean(manual),
      successMessage: manual ? "Current saved slot state reloaded." : null
    });
  }

  async function manualRefreshNow() {
    if (!ensureCompatibleBeforeAction()) {
      return;
    }

    if (state.requests.manualRefresh) {
      return;
    }

    if (!state.watcher.active) {
      state.lastError = "Global watching is stopped. Start Watching before running a backend poll.";
      updateConnection(
        "partial",
        state.lastError,
        "Reload Saved Slots still works while watching is stopped."
      );
      render();
      return;
    }

    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok) {
      state.lastError = normalized.error;
      updateConnection("error", normalized.error, null);
      render();
      return;
    }

    const endpoint = buildApiUrl(normalized.baseUrl, "/api/refresh");

    if (!endpoint) {
      state.lastError = "Bad URL construction for manual refresh.";
      render();
      return;
    }

    state.requests.manualRefresh = true;
    updateConnection(
      "testing",
      "Running one backend poll now. This does not start continuous watching.",
      `Requested URL: ${endpoint}`
    );
    render();
    try {
      const result = await requestJson(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: "{}"
      });

      if (!result.ok) {
        state.lastError = result.error.message;
        updateConnection("error", result.error.message, `Requested URL: ${endpoint}`);
        return;
      }

      if (Array.isArray(result.payload?.slots)) {
        applySlotsPayload(result.payload, new Date().toISOString());
        state.runtime.restoredFromCache = Array.isArray(state.slots) && state.slots.length > 0;
        state.runtime.restoreSource = "backend_sync";
        state.runtime.initialRestorePending = false;
        state.runtime.autoRestoreReason = null;
      }

      const syncResult = await syncSlotsFromBackend({
        successMessage: "Manual refresh finished. Tracker data now reflects the latest backend poll."
      });

      if (!syncResult.ok) {
        state.lastError = "The backend poll finished, but reloading the latest slot state failed.";
        updateConnection("partial", state.lastError, `Requested URL: ${endpoint}`);
      }
    } finally {
      state.requests.manualRefresh = false;
      render();
    }
  }

  async function runWatchPollCycle(reason = "interval") {
    if (!state.watcher.active) {
      state.watcher.lastSkippedAt = new Date().toISOString();
      pushDebugLog("info", "Poll cycle skipped because watching is inactive", {
        reason
      });
      render();
      return {
        ok: false,
        skipped: true
      };
    }

    if (state.watcher.polling) {
      pushDebugLog("warn", "Poll cycle skipped because a previous poll is still running", {
        reason
      });
      return {
        ok: false,
        skipped: true
      };
    }

    state.watcher.polling = true;
    state.watcher.status = "WATCHING";
    state.watcher.lastStartedAt = new Date().toISOString();
    state.watcher.lastReason = reason;
    render();

    const refreshResult = await refresh(false);

    state.watcher.polling = false;
    state.watcher.lastCompletedAt = new Date().toISOString();

    if (!state.watcher.active) {
      pushDebugLog("info", "Poll cycle finished after watching was stopped", {
        reason,
        ok: Boolean(refreshResult?.ok)
      });
      render();
      return refreshResult;
    }

    if (refreshResult?.ok) {
      state.watcher.status = "WATCHING";
      state.watcher.lastSuccessfulAt = state.watcher.lastCompletedAt;
      state.watcher.lastError = null;
      pushDebugLog("info", "Watch poll cycle completed", {
        reason,
        url: refreshResult.url,
        transport: refreshResult.transport
      });
    } else if (!refreshResult?.skipped) {
      state.watcher.status = "ERROR";
      state.watcher.lastError = refreshResult?.error || "Watch poll failed.";
      pushDebugLog("error", "Watch poll cycle failed", {
        reason,
        error: state.watcher.lastError
      });
    }

    render();
    return refreshResult;
  }

  async function startWatching() {
    if (!ensureCompatibleBeforeAction()) {
      return;
    }

    const readiness = getWatcherReadiness();

    if (!readiness.canStart) {
      state.watcher.status = "ERROR";
      state.watcher.lastError = readiness.reason;
      state.lastError = readiness.reason;
      pushDebugLog("warn", "Watching start blocked", {
        reason: readiness.reason
      });
      render();
      return;
    }

    if (state.watcher.active || state.watcher.polling) {
      pushDebugLog("warn", "Watching start ignored because watcher is already active", {
        status: state.watcher.status
      });
      render();
      return;
    }

    persistBackendUrl(readiness.normalized.baseUrl);
    const endpoint = buildApiUrl(readiness.normalized.baseUrl, "/api/watching/start");

    if (!endpoint) {
      state.lastError = "Bad URL construction for start-watching request.";
      render();
      return;
    }

    state.requests.manualRefresh = true;
    state.watcher.lastError = null;
    pushDebugLog("info", "Watching started", {
      baseUrl: readiness.normalized.baseUrl,
      endpoint
    });
    render();

    try {
      const result = await requestJson(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: "{}"
      });

      if (!result.ok) {
        state.lastError = result.error.message;
        state.watcher.status = "ERROR";
        state.watcher.lastError = result.error.message;
        updateConnection("error", result.error.message, `Requested URL: ${endpoint}`);
        return;
      }

      applySlotsPayload(result.payload, new Date().toISOString());
      state.runtime.restoredFromCache = Array.isArray(state.slots) && state.slots.length > 0;
      state.runtime.restoreSource = "backend_sync";
      state.runtime.initialRestorePending = false;
      state.runtime.autoRestoreReason = null;
      updateConnection(
        "success",
        "Global watching started. Enabled slots will now poll on the backend interval.",
        `Requested URL: ${endpoint}`
      );
    } finally {
      state.requests.manualRefresh = false;
      render();
    }
  }

  async function stopWatching(reason = "manual") {
    if (!state.watcher.active && !state.watcher.polling && state.watcher.timerId === null) {
      pushDebugLog("info", "Watching stop requested while already inactive", {
        reason
      });
      render();
      return;
    }

    const normalized = normalizeBackendUrlInput(state.backendUrl || state.backendInput);

    if (!normalized.ok) {
      state.lastError = normalized.error;
      render();
      return;
    }

    const endpoint = buildApiUrl(normalized.baseUrl, "/api/watching/stop");

    if (!endpoint) {
      state.lastError = "Bad URL construction for stop-watching request.";
      render();
      return;
    }

    clearWatcherTimer();
    state.requests.manualRefresh = true;
    pushDebugLog("info", "Watching stopped", {
      reason,
      endpoint
    });
    render();

    try {
      const result = await requestJson(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: "{}"
      });

      if (!result.ok) {
        state.lastError = result.error.message;
        updateConnection("error", result.error.message, `Requested URL: ${endpoint}`);
        return;
      }

      applySlotsPayload(result.payload, new Date().toISOString());
      state.runtime.restoredFromCache = Array.isArray(state.slots) && state.slots.length > 0;
      state.runtime.restoreSource = "backend_sync";
      state.runtime.initialRestorePending = false;
      state.runtime.autoRestoreReason = null;
      updateConnection(
        "success",
        "Global watching stopped. Slots remain stored as preferences, but no backend polling is active.",
        `Requested URL: ${endpoint}`
      );
    } finally {
      state.requests.manualRefresh = false;
      render();
    }
  }

  window.addEventListener(FLUTTER_READY_EVENT, () => {
    state.runtime.nativeReady = hasNativeTornPdaHandler();
    pushDebugLog("info", "TornPDA platform ready event received", {
      nativeReady: state.runtime.nativeReady
    });
    render();

    if (state.backendUrl) {
      void maybeRestoreAndSync({
        reason: state.ui.collapsed ? "tornpda_ready_hidden" : "tornpda_ready",
        force: true
      });
    }
  });

  if (window.__tornPdaMarketWatcherTimingIntervalId) {
    window.clearInterval(window.__tornPdaMarketWatcherTimingIntervalId);
  }

  window.__tornPdaMarketWatcherTimingIntervalId = window.setInterval(() => {
    refreshTimingWidgets();
  }, TIMER_TICK_MS);

  pushDebugLog("info", "Script initialized", {
    nativeReady: state.runtime.nativeReady,
    savedBackendUrl: state.backendUrl || null
  });

  render();

  if (state.backendUrl) {
    void maybeRestoreAndSync({
      reason: state.ui.collapsed ? "init_hidden" : "init_open",
      force: true
    });
  }
})();
