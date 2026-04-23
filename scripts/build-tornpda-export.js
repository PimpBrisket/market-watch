const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const userscriptPath = path.join(repoRoot, "tornpda-script", "tornpda-market-watcher.user.js");
const exportPath = path.join(repoRoot, "tornpda-script", "tornpda-market-watcher.json");

function parseHeader(source) {
  const meta =
    /((?:^|\n)\s*\/\/\x20==UserScript==)([\s\S]*?\n)\s*\/\/\x20==\/UserScript==|$/.exec(source)?.[0] ||
    "";

  if (!meta.trim()) {
    throw new Error("No userscript header found.");
  }

  const metaMatches = meta.matchAll(/^(?:^|\n)\s*\/\/\x20(@\S+)(.*)$/gm);
  const metaMap = { "@match": [] };

  for (const match of metaMatches) {
    const key = match[1]?.trim().toLowerCase();
    const value = match[2]?.trim() || "";

    if (!key) {
      continue;
    }

    if (key === "@match") {
      metaMap["@match"].push(value);
    } else {
      metaMap[key] = value;
    }
  }

  return {
    name: metaMap["@name"] || null,
    version: metaMap["@version"] || null,
    matches: metaMap["@match"].length ? metaMap["@match"] : ["*"],
    time: metaMap["@run-at"] === "document-start" ? "start" : "end",
    source
  };
}

function buildExportEntry(source) {
  const meta = parseHeader(source);
  const runtimeVersion =
    /const\s+SCRIPT_VERSION\s*=\s*"([^"]+)"/.exec(source)?.[1] || null;

  if (!meta.name || !meta.version) {
    throw new Error("Userscript header must include @name and @version.");
  }

  if (!runtimeVersion) {
    throw new Error("Userscript source must define SCRIPT_VERSION.");
  }

  if (runtimeVersion !== meta.version) {
    throw new Error(
      `Userscript @version (${meta.version}) must match SCRIPT_VERSION (${runtimeVersion}).`
    );
  }

  return {
    enabled: true,
    matches: meta.matches,
    name: meta.name,
    version: meta.version,
    edited: false,
    source: meta.source,
    url: null,
    updateStatus: "noRemote",
    isExample: false,
    time: meta.time,
    customApiKey: "",
    customApiKeyCandidate: false
  };
}

function validateExportShape(data) {
  if (!Array.isArray(data)) {
    throw new Error("TornPDA export must be a JSON array.");
  }

  const allowedKeys = new Set([
    "enabled",
    "matches",
    "name",
    "version",
    "edited",
    "source",
    "url",
    "updateStatus",
    "isExample",
    "time",
    "customApiKey",
    "customApiKeyCandidate"
  ]);

  const booleanFields = ["enabled", "edited", "isExample", "customApiKeyCandidate"];

  data.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Entry ${index} must be a JSON object.`);
    }

    for (const key of Object.keys(entry)) {
      if (!allowedKeys.has(key)) {
        throw new Error(`Entry ${index} has unsupported key "${key}".`);
      }
    }

    for (const field of booleanFields) {
      if (typeof entry[field] !== "boolean") {
        throw new Error(`Entry ${index} field "${field}" must be boolean, got ${entry[field] === null ? "null" : typeof entry[field]}.`);
      }
    }

    if (!Array.isArray(entry.matches) || entry.matches.some((value) => typeof value !== "string")) {
      throw new Error(`Entry ${index} field "matches" must be a string array.`);
    }

    ["name", "version", "source", "updateStatus", "time", "customApiKey"].forEach((field) => {
      if (typeof entry[field] !== "string") {
        throw new Error(`Entry ${index} field "${field}" must be a string.`);
      }
    });

    if (!(typeof entry.url === "string" || entry.url === null)) {
      throw new Error(`Entry ${index} field "url" must be a string or null.`);
    }
  });

  return booleanFields;
}

function main() {
  const source = fs.readFileSync(userscriptPath, "utf8");
  const exportData = [buildExportEntry(source)];
  const booleanFields = validateExportShape(exportData);
  fs.writeFileSync(exportPath, `${JSON.stringify(exportData, null, 2)}\n`);

  console.log(`Wrote ${path.relative(repoRoot, exportPath)}`);
  exportData.forEach((entry, index) => {
    const boolSummary = booleanFields.map((field) => `${field}=${entry[field]}`).join(", ");
    console.log(`entry ${index}: ${boolSummary}`);
  });
}

main();
