function patternMatches(pathWithQuery, pattern) {
  if (!pattern) {
    return false;
  }

  const anchored = pattern.endsWith("$");
  const source = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = source
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  const expression = new RegExp(`^${escaped}${anchored ? "$" : ""}`);
  return expression.test(pathWithQuery);
}

export function parseRobots(body, userAgent) {
  const groups = [];
  let current = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line || !line.includes(":")) {
      continue;
    }

    const separator = line.indexOf(":");
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!current || current.hasRules) {
        current = { agents: [], rules: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (
      current &&
      (field === "allow" || field === "disallow") &&
      value !== ""
    ) {
      current.rules.push({ type: field, path: value });
      current.hasRules = true;
    }
  }

  const normalizedAgent = userAgent.toLowerCase();
  const exactGroups = groups.filter((group) =>
    group.agents.some(
      (agent) => agent !== "*" && normalizedAgent.includes(agent),
    ),
  );
  const matchingGroups =
    exactGroups.length > 0
      ? exactGroups
      : groups.filter((group) => group.agents.includes("*"));

  return matchingGroups.flatMap((group) => group.rules);
}

export function isAllowedByRobots(url, robots) {
  if (robots.denyAll) {
    return false;
  }

  const parsed = new URL(url);
  const pathWithQuery = `${parsed.pathname}${parsed.search}`;
  const matches = robots.rules
    .filter((rule) => patternMatches(pathWithQuery, rule.path))
    .sort((left, right) => {
      const lengthDifference = right.path.length - left.path.length;
      if (lengthDifference !== 0) {
        return lengthDifference;
      }
      return left.type === "allow" ? -1 : 1;
    });

  return matches.length === 0 || matches[0].type === "allow";
}
