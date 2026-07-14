export function isVersionBelow(version, minimum) {
  const current = version
    .match(/\d+(?:\.\d+)*/)?.[0]
    .split('.')
    .map(Number);
  const required = minimum.split('.').map(Number);

  if (!current) return false;

  for (let i = 0; i < required.length; i++) {
    const currentPart = current[i] ?? 0;
    if (currentPart !== required[i]) return currentPart < required[i];
  }

  return false;
}
