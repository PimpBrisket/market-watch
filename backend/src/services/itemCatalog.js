const fs = require("fs");

function normalizeItemName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function createNameNotFoundMessage(itemName, sourceLabel) {
  return `Item name "${itemName}" was not found in the bundled catalog (${sourceLabel}).`;
}

function createAmbiguousMessage(itemName, matches, sourceLabel) {
  const preview = matches
    .slice(0, 5)
    .map((item) => `${item.itemName} [${item.itemId}]`)
    .join(", ");

  return `Item name "${itemName}" matched multiple items in the bundled catalog (${sourceLabel}): ${preview}.`;
}

class ItemCatalog {
  constructor({ catalogFile }) {
    const raw = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    this.source = raw.source || {
      label: "bundled item catalog",
      url: null,
      fetchedAt: null
    };
    this.items = Array.isArray(raw.items) ? raw.items : [];
    this.byId = new Map();
    this.byNormalizedName = new Map();

    this.items.forEach((item) => {
      const normalizedName = normalizeItemName(item.itemName || item.normalizedName);
      const normalizedItem = {
        itemId: Number.parseInt(item.itemId, 10),
        itemName: String(item.itemName || "").trim(),
        normalizedName
      };

      if (!Number.isInteger(normalizedItem.itemId) || !normalizedItem.itemName) {
        return;
      }

      this.byId.set(normalizedItem.itemId, normalizedItem);

      const existing = this.byNormalizedName.get(normalizedName) || [];
      existing.push(normalizedItem);
      this.byNormalizedName.set(normalizedName, existing);
    });
  }

  getSummary() {
    return {
      itemCount: this.byId.size,
      sourceLabel: this.source.label,
      sourceUrl: this.source.url,
      fetchedAt: this.source.fetchedAt
    };
  }

  getById(itemId) {
    const normalizedItemId = Number.parseInt(itemId, 10);

    if (!Number.isInteger(normalizedItemId) || normalizedItemId <= 0) {
      return null;
    }

    return this.byId.get(normalizedItemId) || null;
  }

  searchByName(itemName) {
    const normalized = normalizeItemName(itemName);

    if (!normalized) {
      return [];
    }

    return [...(this.byNormalizedName.get(normalized) || [])];
  }

  resolve({ itemId, itemName }) {
    const trimmedName = String(itemName || "").trim();
    const parsedItemId =
      itemId === null || itemId === undefined || itemId === ""
        ? null
        : Number.parseInt(itemId, 10);

    if (!parsedItemId && !trimmedName) {
      throw new Error("Enter an item ID or an item name.");
    }

    if (parsedItemId !== null) {
      if (!Number.isInteger(parsedItemId) || parsedItemId <= 0) {
        throw new Error("Item ID must be a positive integer.");
      }

      const catalogMatch = this.getById(parsedItemId);

      if (trimmedName) {
        const byName = this.searchByName(trimmedName);

        if (!byName.length) {
          if (
            catalogMatch &&
            normalizeItemName(trimmedName) === normalizeItemName(catalogMatch.itemName)
          ) {
            return {
              itemId: parsedItemId,
              itemName: catalogMatch.itemName,
              resolutionSource: "catalog_id"
            };
          }

          throw new Error(
            createNameNotFoundMessage(trimmedName, this.source.label)
          );
        }

        if (byName.length > 1) {
          throw new Error(
            createAmbiguousMessage(trimmedName, byName, this.source.label)
          );
        }

        if (byName[0].itemId !== parsedItemId) {
          throw new Error(
            `Item ID ${parsedItemId} does not match item name "${trimmedName}".`
          );
        }
      }

      return {
        itemId: parsedItemId,
        itemName: catalogMatch?.itemName || trimmedName || `Item ${parsedItemId}`,
        resolutionSource: catalogMatch ? "catalog_id" : "item_id_only"
      };
    }

    const byName = this.searchByName(trimmedName);

    if (!byName.length) {
      throw new Error(createNameNotFoundMessage(trimmedName, this.source.label));
    }

    if (byName.length > 1) {
      throw new Error(createAmbiguousMessage(trimmedName, byName, this.source.label));
    }

    return {
      itemId: byName[0].itemId,
      itemName: byName[0].itemName,
      resolutionSource: "catalog_name"
    };
  }
}

module.exports = {
  ItemCatalog,
  normalizeItemName
};
