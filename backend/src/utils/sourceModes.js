const SOURCE_MODES = {
  MARKET_ONLY: "MARKET_ONLY",
  BAZAAR_ONLY: "BAZAAR_ONLY"
};

function normalizeSourceMode(value, fallback = SOURCE_MODES.MARKET_ONLY) {
  if (value === SOURCE_MODES.BAZAAR_ONLY) {
    return SOURCE_MODES.BAZAAR_ONLY;
  }

  if (value === SOURCE_MODES.MARKET_ONLY) {
    return SOURCE_MODES.MARKET_ONLY;
  }

  return fallback;
}

function sourceModeLabel(value) {
  return normalizeSourceMode(value) === SOURCE_MODES.BAZAAR_ONLY
    ? "Bazaar Only"
    : "Market Only";
}

function sourceModeShortLabel(value) {
  return normalizeSourceMode(value) === SOURCE_MODES.BAZAAR_ONLY ? "Bazaar" : "Market";
}

function sourceTypeFromMode(value) {
  return normalizeSourceMode(value) === SOURCE_MODES.BAZAAR_ONLY ? "bazaar" : "item_market";
}

module.exports = {
  SOURCE_MODES,
  normalizeSourceMode,
  sourceModeLabel,
  sourceModeShortLabel,
  sourceTypeFromMode
};
