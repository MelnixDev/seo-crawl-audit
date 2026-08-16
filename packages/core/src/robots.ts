export interface RobotsRule {
  type: "allow" | "disallow";
  path: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  hasRules: boolean;
}

function patternMatches(pathWithQuery: string, pattern: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const source = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(pathWithQuery);
}

export function parseRobots(body: string, userAgent: string): RobotsRule[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const rawLine of body.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (!line || separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || current.hasRules) {
        current = { agents: [], rules: [], hasRules: false };
        groups.push(current);
      }
      if (value) current.agents.push(value.toLowerCase());
      continue;
    }
    if (current && (field === "allow" || field === "disallow") && value) {
      current.rules.push({ type: field, path: value });
      current.hasRules = true;
    }
  }
  const normalizedAgent = userAgent.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((agent) => agent !== "*" && normalizedAgent.includes(agent)));
  const matching = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes("*"));
  return matching.flatMap((group) => group.rules);
}

export function isAllowedByRobots(url: string, robots: { denyAll?: boolean; rules?: RobotsRule[] }): boolean {
  if (robots.denyAll) return false;
  const parsed = new URL(url);
  const pathWithQuery = `${parsed.pathname}${parsed.search}`;
  const matches = (robots.rules ?? [])
    .filter((rule) => patternMatches(pathWithQuery, rule.path))
    .sort((left, right) => right.path.length - left.path.length || (left.type === "allow" ? -1 : 1));
  return matches.length === 0 || matches[0].type === "allow";
}
