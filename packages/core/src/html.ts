import { parse } from "parse5";

type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
};

function getAttribute(node: HtmlNode, name: string): string | null {
  return node.attrs?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function getText(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(getText).join("");
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

export interface ExtractedSeoData {
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  lang: string | null;
  h1Count: number;
  openGraph: { title: string | null; description: string | null; image: string | null };
  twitter: { card: string | null; title: string | null; description: string | null; image: string | null };
  hreflang: Array<{ lang: string; url: string }>;
  jsonLd: Array<{ valid: boolean; value?: unknown; error?: string }>;
  images: Array<{ src: string | null; alt: string | null }>;
  links: string[];
  wordCount: number;
  visibleText: string;
}

export function extractSeoData(html: string): ExtractedSeoData {
  const document = parse(html) as unknown as HtmlNode;
  const result: ExtractedSeoData = {
    title: null,
    description: null,
    canonical: null,
    robots: null,
    lang: null,
    h1Count: 0,
    openGraph: { title: null, description: null, image: null },
    twitter: { card: null, title: null, description: null, image: null },
    hreflang: [],
    jsonLd: [],
    images: [],
    links: [],
    wordCount: 0,
    visibleText: "",
  };
  const textParts: string[] = [];

  function visit(node: HtmlNode, hidden = false): void {
    const tagName = node.tagName?.toLowerCase();
    const excludesText = hidden || tagName === "script" || tagName === "style" || tagName === "noscript" || tagName === "template";

    if (node.nodeName === "#text" && !excludesText) {
      const text = cleanText(node.value);
      if (text) textParts.push(text);
    }
    if (tagName === "html" && result.lang === null) result.lang = cleanText(getAttribute(node, "lang"));
    if (tagName === "title" && result.title === null) result.title = cleanText(getText(node));
    if (tagName === "h1") result.h1Count += 1;

    if (tagName === "meta") {
      const name = getAttribute(node, "name")?.toLowerCase();
      const property = getAttribute(node, "property")?.toLowerCase();
      const content = cleanText(getAttribute(node, "content"));
      if (name === "description" && result.description === null) result.description = content;
      else if (name === "robots" && result.robots === null) result.robots = content;
      else if (property === "og:title" && result.openGraph.title === null) result.openGraph.title = content;
      else if (property === "og:description" && result.openGraph.description === null) result.openGraph.description = content;
      else if (property === "og:image" && result.openGraph.image === null) result.openGraph.image = content;
      else if (name === "twitter:card" && result.twitter.card === null) result.twitter.card = content;
      else if (name === "twitter:title" && result.twitter.title === null) result.twitter.title = content;
      else if (name === "twitter:description" && result.twitter.description === null) result.twitter.description = content;
      else if (name === "twitter:image" && result.twitter.image === null) result.twitter.image = content;
    }

    if (tagName === "link") {
      const rel = getAttribute(node, "rel")?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
      if (rel.includes("canonical") && result.canonical === null) result.canonical = cleanText(getAttribute(node, "href"));
      if (rel.includes("alternate")) {
        const lang = cleanText(getAttribute(node, "hreflang"));
        const url = cleanText(getAttribute(node, "href"));
        if (lang && url) result.hreflang.push({ lang, url });
      }
    }

    if (tagName === "a") {
      const href = getAttribute(node, "href");
      if (href) result.links.push(href);
    }
    if (tagName === "img") {
      result.images.push({ src: cleanText(getAttribute(node, "src")), alt: getAttribute(node, "alt") });
    }
    if (tagName === "script" && getAttribute(node, "type")?.toLowerCase() === "application/ld+json") {
      const source = getText(node).trim();
      if (source) {
        try {
          result.jsonLd.push({ valid: true, value: JSON.parse(source) });
        } catch (error) {
          result.jsonLd.push({ valid: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    for (const child of node.childNodes ?? []) visit(child, excludesText);
  }

  visit(document);
  result.visibleText = textParts.join(" ");
  result.wordCount = result.visibleText ? result.visibleText.split(/\s+/u).length : 0;
  return result;
}
