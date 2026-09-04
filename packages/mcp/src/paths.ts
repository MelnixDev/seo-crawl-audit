import { dirname, relative, resolve } from "node:path";
import { lstat, realpath } from "node:fs/promises";

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

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

/** Reject existing files or parent directories that resolve through a symlink outside the workspace. */
export async function assertRealWorkspacePath(root: string, candidate: string): Promise<void> {
  const realRoot = await realpath(root);
  let current = candidate;
  while (true) {
    try {
      const realCandidate = await realpath(current);
      if (!inside(realRoot, realCandidate)) throw new Error("artifact path must not escape the workspace through a symlink");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw new Error("artifact path must not escape the workspace through an unresolved symlink");
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}
