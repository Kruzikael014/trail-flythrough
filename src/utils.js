export function haversine(a, b) {
  const R = 6371;
  const dLa = (b.lat - a.lat) * Math.PI / 180;
  const dLo = (b.lon - a.lon) * Math.PI / 180;
  const s =
    Math.sin(dLa / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function styleUrl(s, key) {
  return `https://api.maptiler.com/maps/${s}/style.json?key=${key}`;
}
