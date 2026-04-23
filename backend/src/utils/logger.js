function log(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  const serializedContext =
    Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";

  console.log(`[${timestamp}] [${level}] ${message}${serializedContext}`);
}

module.exports = {
  info(message, context) {
    log("INFO", message, context);
  },
  warn(message, context) {
    log("WARN", message, context);
  },
  error(message, context) {
    log("ERROR", message, context);
  }
};

