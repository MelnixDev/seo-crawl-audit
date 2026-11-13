import { dirname, relative, resolve, isAbsolute, sep, win32 } from "node:path";
import { lstat, realpath } from "node:fs/promises";

const nativePaths = { relative, resolve, isAbsolute, sep };

export function workspaceRoot(): string {
  return resolve(process.env.SEO_AUDIT_MCP_ROOT ?? process.cwd());
}

/** Resolve a relative artifact path without allowing writes outside the workspace. */
export function workspacePath(root: string, requested: string | undefined, fallback: string, paths = nativePaths): string {
  const value = requested ?? fallback;
  if (!value || paths.isAbsolute(value) || win32.isAbsolute(value)) {
    throw new Error("artifact paths must be relative to the workspace");
  }
  const candidate = paths.resolve(root, value);
  const rel = paths.relative(root, candidate);
  if (paths.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${paths.sep}`) || rel.includes("\0")) {
    throw new Error("artifact path must stay inside the workspace");
  }
  return candidate;
}

export function relativeArtifact(root: string, absolute: string): string {
  return relative(root, absolute) || ".";
}

export function insideWorkspace(root: string, candidate: string, paths = nativePaths): boolean {
  const rel = paths.relative(root, candidate);
  return rel === "" || (!paths.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${paths.sep}`));
}

/** Reject existing files or parent directories that resolve through a symlink outside the workspace. */
export async function assertRealWorkspacePath(root: string, candidate: string): Promise<void> {
  const realRoot = await realpath(root);
  let current = candidate;
  while (true) {
    try {
      const realCandidate = await realpath(current);
      if (!insideWorkspace(realRoot, realCandidate)) throw new Error("artifact path must not escape the workspace through a symlink");
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
