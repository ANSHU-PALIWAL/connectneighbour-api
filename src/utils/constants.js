// 🌍 Universal Radius Standard (150 km) across ConnectNeighbour
const MAX_DISCOVERY_RADIUS_METERS = 150000; // 150 km in meters

/**
 * Parses and safely clamps radius queries between 1,000m (1 km) and 150,000m (150 km).
 * Defaults to 150,000m if unprovided or invalid.
 */
const getValidDistance = (queryDistance) => {
  if (!queryDistance) return MAX_DISCOVERY_RADIUS_METERS;
  const parsed = parseInt(queryDistance, 10);
  if (isNaN(parsed) || !Number.isFinite(parsed)) {
    return MAX_DISCOVERY_RADIUS_METERS;
  }
  return Math.min(Math.max(parsed, 1000), MAX_DISCOVERY_RADIUS_METERS);
};

module.exports = {
  MAX_DISCOVERY_RADIUS_METERS,
  getValidDistance,
};
