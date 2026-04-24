(function () {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error?.message || `Request failed: ${path}`);
    }

    return payload;
  }

  function render(target, payload, slotsPayload) {
    const backend = payload?.backend || {};
    const counts = backend.counts || {};
    const intervals = backend.intervals || {};
    const recentErrors = Array.isArray(backend.recentErrors) ? backend.recentErrors : [];

    target.innerHTML = `
      <header class="viewer-header">
        <div class="viewer-title">
          <h1>Viewer Health</h1>
          <p>Diagnostic page for backend status, viewer asset health, and current watcher runtime state.</p>
        </div>
        <div class="header-actions">
          <a class="button secondary" href="/viewer">Back to Viewer</a>
        </div>
      </header>

      <div class="health-grid">
        <section class="health-card">
          <span class="label">Backend Status</span>
          <span class="value">${escapeHtml(backend.lastError ? "Degraded" : "Reachable")}</span>
          <div class="panel-subtitle">Viewer shell loaded and diagnostics fetched successfully.</div>
        </section>
        <section class="health-card">
          <span class="label">Viewer Status</span>
          <span class="value">${escapeHtml(payload?.viewer?.status || "Unknown")}</span>
          <div class="panel-subtitle">Assets: ${escapeHtml(payload?.viewer?.assets?.script || "--")}</div>
        </section>
        <section class="health-card">
          <span class="label">Backend Version</span>
          <span class="value">${escapeHtml(backend.version || "--")}</span>
          <div class="panel-subtitle">Generated ${escapeHtml(formatDateTime(payload?.generatedAt))}</div>
        </section>
        <section class="health-card">
          <span class="label">Watcher Global State</span>
          <span class="value">${backend.watchingActive ? "Watching" : "Stopped"}</span>
          <div class="panel-subtitle">Active polling: ${backend.polling ? "Yes" : "No"}</div>
        </section>
        <section class="health-card">
          <span class="label">Last Successful Status Check</span>
          <span class="value">${escapeHtml(formatDateTime(backend.lastSuccessfulStatusCheckAt))}</span>
          <div class="panel-subtitle">Last backend poll ${escapeHtml(formatDateTime(backend.lastPollCompletedAt))}</div>
        </section>
        <section class="health-card">
          <span class="label">Configured Intervals</span>
          <span class="value">${escapeHtml(String(intervals.pollIntervalMs || "--"))}ms</span>
          <div class="panel-subtitle">
            Timeout ${escapeHtml(String(intervals.requestTimeoutMs || "--"))}ms | Stale ${escapeHtml(
              String(intervals.staleAfterMs || "--")
            )}ms
          </div>
        </section>
        <section class="health-card">
          <span class="label">Occupied Slots</span>
          <span class="value">${escapeHtml(String(counts.occupiedSlots ?? slotsPayload?.summary?.occupiedCount ?? 0))}</span>
          <div class="panel-subtitle">Enabled ${escapeHtml(String(counts.enabledSlots ?? 0))}</div>
        </section>
        <section class="health-card">
          <span class="label">Active Enabled Slots</span>
          <span class="value">${escapeHtml(String(counts.activeEnabledSlots ?? 0))}</span>
          <div class="panel-subtitle">Matches current watching state</div>
        </section>
        <section class="health-card">
          <span class="label">Current Error</span>
          <span class="value">${escapeHtml(backend.lastError || "None")}</span>
          <div class="panel-subtitle">Most recent backend-side error signal</div>
        </section>
      </div>

      <section class="panel" style="margin-top: 18px;">
        <div class="panel-head">
          <div>
            <h2>Recent Backend / Viewer Errors</h2>
            <div class="panel-subtitle">Focused diagnostics instead of a main-view connection wall.</div>
          </div>
        </div>
        ${
          recentErrors.length
            ? `<div class="health-log">${escapeHtml(
                recentErrors
                  .map(
                    (entry) =>
                      `${formatDateTime(entry.timestamp)} [${entry.source}] ${entry.message}`
                  )
                  .join("\n")
              )}</div>`
            : `<div class="empty-state">No recent backend or viewer errors were reported.</div>`
        }
      </section>
    `;
  }

  async function init() {
    const root = document.getElementById("health-app");

    if (!root) {
      return;
    }

    try {
      const [healthPayload, slotsPayload] = await Promise.all([
        fetchJson("/viewer/health.json"),
        fetchJson("/api/slots")
      ]);
      render(root, healthPayload, slotsPayload);
    } catch (error) {
      root.innerHTML = `
        <div class="boot-shell panel bad">
          <h1>Viewer Health</h1>
          <p>Error loading diagnostics</p>
          <p class="panel-subtitle">${escapeHtml(error?.message || "Unknown health-page error.")}</p>
        </div>
      `;
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
