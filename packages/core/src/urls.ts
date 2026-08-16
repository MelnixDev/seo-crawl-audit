// @ts-nocheck -- public overloads are declared by generated TypeScript output.
const SKIPPED_EXTENSIONS =
  /\.(?:avif|bmp|css|csv|docx?|eot|gif|gz|ico|jpe?g|js|json|map|mp3|mp4|mov|ogg|otf|pdf|png|pptx?|rar|rss|svg|tar|tiff?|ttf|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i;

export function normalizeUrl(input, base, { includeQuery = false } = {}) {
  let url;

  try {
    url = base ? new URL(input, base) : new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  url.hash = "";

  if (!includeQuery) {
    url.search = "";
  }

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.href;
}

export function isSameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

export function isCrawlableUrl(url) {
  try {
    const parsed = new URL(url);
    return !SKIPPED_EXTENSIONS.test(parsed.pathname);
  } catch {
    return false;
  }
}
