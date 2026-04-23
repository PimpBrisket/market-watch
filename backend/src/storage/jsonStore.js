const fs = require("fs/promises");
const path = require("path");

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async exists() {
    try {
      await fs.access(this.filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  async ensureParentDirectory() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
  }

  async read() {
    const raw = await fs.readFile(this.filePath, "utf8");
    return JSON.parse(raw);
  }

  async write(data) {
    await this.ensureParentDirectory();

    const tempPath = `${this.filePath}.tmp`;
    const serialized = `${JSON.stringify(data, null, 2)}\n`;

    await fs.writeFile(tempPath, serialized, "utf8");
    await fs.rename(tempPath, this.filePath);
  }
}

module.exports = {
  JsonStore
};

