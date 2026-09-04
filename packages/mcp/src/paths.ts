import { relative, resolve } from "node:path";

export function workspaceRoot(): string {
  return resolve(process.env.SEO_AUDIT_MCP_ROOT ?? process.cwd());
}

/** Resolve a relative artifact path without allowing writes outside the workspace. */
export function workspacePath(root: string, requested: string | undefined, fallback: string): string {
  const value = requested ?? fallback;
  if (!value || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error("artifact paths must be relative to the workspace");
  }
  const candidate = resolve(root, value);
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || rel.includes("\0")) {
    throw new Error("artifact path must stay inside the workspace");
  }
  return candidate;
}

export function relativeArtifact(root: string, absolute: string): string {
  return relative(root, absolute) || ".";
}
