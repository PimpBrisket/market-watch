const os = require("os");

function getLocalIpv4Candidates() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    for (const address of addresses || []) {
      if (!address || address.family !== "IPv4" || address.internal) {
        continue;
      }

      candidates.push({
        interfaceName,
        address: address.address,
        cidr: address.cidr || null
      });
    }
  }

  return candidates;
}

function getNetworkDiagnostics(config) {
  const localIpv4Candidates = getLocalIpv4Candidates();
  const localhostBaseUrl = `http://127.0.0.1:${config.port}`;
  const localhostStatusUrl = `${localhostBaseUrl}/api/status`;
  const localhostHealthUrl = `${localhostBaseUrl}/health`;
  const lanBaseUrls = localIpv4Candidates.map((candidate) => ({
    interfaceName: candidate.interfaceName,
    address: candidate.address,
    cidr: candidate.cidr,
    baseUrl: `http://${candidate.address}:${config.port}`,
    statusUrl: `http://${candidate.address}:${config.port}/api/status`,
    healthUrl: `http://${candidate.address}:${config.port}/health`
  }));

  return {
    bindHost: config.host,
    port: config.port,
    localhostBaseUrl,
    localhostStatusUrl,
    localhostHealthUrl,
    lanBaseUrls,
    preferredLanBaseUrl: lanBaseUrls[0]?.baseUrl || null,
    preferredLanStatusUrl: lanBaseUrls[0]?.statusUrl || null,
    preferredLanHealthUrl: lanBaseUrls[0]?.healthUrl || null
  };
}

module.exports = {
  getNetworkDiagnostics
};
