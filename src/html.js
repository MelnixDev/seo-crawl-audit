import { parse } from "parse5";

function getAttribute(node, name) {
  const attribute = node.attrs?.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );
  return attribute?.value ?? null;
}

function getText(node) {
  if (node.nodeName === "#text") {
    return node.value ?? "";
  }

  return (node.childNodes ?? []).map(getText).join("");
}

function cleanText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

export function extractSeoData(html) {
  const document = parse(html);
  const result = {
    title: null,
    description: null,
    canonical: null,
    robots: null,
    lang: null,
    h1Count: 0,
    openGraph: {
      title: null,
      description: null,
      image: null,
    },
    links: [],
  };

  function visit(node) {
    const tagName = node.tagName?.toLowerCase();

    if (tagName === "html" && result.lang === null) {
      result.lang = cleanText(getAttribute(node, "lang"));
    }

    if (tagName === "title" && result.title === null) {
      result.title = cleanText(getText(node));
    }

    if (tagName === "h1") {
      result.h1Count += 1;
    }

    if (tagName === "meta") {
      const name = getAttribute(node, "name")?.toLowerCase();
      const property = getAttribute(node, "property")?.toLowerCase();
      const content = cleanText(getAttribute(node, "content"));

      if (name === "description" && result.description === null) {
        result.description = content;
      } else if (name === "robots" && result.robots === null) {
        result.robots = content;
      } else if (property === "og:title" && result.openGraph.title === null) {
        result.openGraph.title = content;
      } else if (
        property === "og:description" &&
        result.openGraph.description === null
      ) {
        result.openGraph.description = content;
      } else if (property === "og:image" && result.openGraph.image === null) {
        result.openGraph.image = content;
      }
    }

    if (tagName === "link") {
      const rel = getAttribute(node, "rel")
        ?.toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

      if (rel?.includes("canonical") && result.canonical === null) {
        result.canonical = cleanText(getAttribute(node, "href"));
      }
    }

    if (tagName === "a") {
      const href = getAttribute(node, "href");
      if (href) {
        result.links.push(href);
      }
    }

    for (const child of node.childNodes ?? []) {
      visit(child);
    }
  }

  visit(document);
  return result;
}
