export function mapUrlToTarget(url: string, baselineStartUrl: string, targetStartUrl: string): string;
export function mapUrlToTarget(url: null, baselineStartUrl: string, targetStartUrl: string): null;
export function mapUrlToTarget(url: undefined, baselineStartUrl: string, targetStartUrl: string): undefined;
export function mapUrlToTarget(url: string | null | undefined, baselineStartUrl: string, targetStartUrl: string): string | null | undefined {
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

export function mapUrlToBaseline(url: string, baselineStartUrl: string, targetStartUrl: string): string;
export function mapUrlToBaseline(url: null, baselineStartUrl: string, targetStartUrl: string): null;
export function mapUrlToBaseline(url: undefined, baselineStartUrl: string, targetStartUrl: string): undefined;
export function mapUrlToBaseline(url: string | null | undefined, baselineStartUrl: string, targetStartUrl: string): string | null | undefined {
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
