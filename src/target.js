export function mapUrlToTarget(url, baselineStartUrl, targetStartUrl) {
  if (!url) {
    return url;
  }

  const mapped = new URL(url);
  const baselineOrigin = new URL(baselineStartUrl).origin;
  const targetOrigin = new URL(targetStartUrl).origin;

  if (mapped.origin === baselineOrigin) {
    const target = new URL(targetOrigin);
    mapped.protocol = target.protocol;
    mapped.host = target.host;
  }

  return mapped.href;
}

export function mapUrlToBaseline(url, baselineStartUrl, targetStartUrl) {
  if (!url) {
    return url;
  }

  const mapped = new URL(url);
  const baselineOrigin = new URL(baselineStartUrl).origin;
  const targetOrigin = new URL(targetStartUrl).origin;

  if (mapped.origin === targetOrigin) {
    const baseline = new URL(baselineOrigin);
    mapped.protocol = baseline.protocol;
    mapped.host = baseline.host;
  }

  return mapped.href;
}
