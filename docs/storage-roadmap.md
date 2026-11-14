# Storage roadmap

The 0.17.1 optimizer → independent critic → release manager review separated
measured release costs from larger storage features. No cleanup, data migration
or recurring monitoring is enabled by this plan.

## 0.17.1 acceptance

- Preserve the selected master logo; package 512px production icons and a compact
  offline 128px runtime image. Keep client-relative icon paths valid.
- Keep the existing CLI 512,000-byte budget and MCP budget unchanged.
- Verify actual Codex native loading, tool discovery, a bounded scan and workspace
  rejection with an empty inherited PATH.
- Keep development dependencies, native plugin cache and consumer audit artifacts
  distinct. Do not attribute host disk pressure to the plugin without measurement.

## 0.18 priorities

1. **Storage visibility and failure recovery.** Add a read-only storage/doctor
   summary for the configured workspace: latest artifacts, checkpoint, history,
   comparison output, rebuildable catalog and available space. Recover from
   ENOSPC with actionable messages and preserve prior output/checkpoints. Remove
   only the exact temporary file created by the failed operation, best effort.
2. **Bounded history reads.** Reuse catalog/streamed summaries for CLI trends;
   avoid loading every retained full snapshot to show a short trend. Read selected
   full snapshots only for comparisons, retaining integrity checks and warnings.
3. **Explicit retention and comparison reuse.** Design opt-in keep-last/age/byte
   policies and a dry-run list of owned files. Protect pinned baselines, active
   jobs, current manifests, checkpoints and user reports. Comparison reuse must
   include source digests, engine/rule versions and policy/render options.
4. **Optional archives and coherent layout.** Evaluate compressed cold history
   with compatibility/restore/integrity tests. Document a project-owned directory
   layout and migration path before moving any established CLI/MCP default.

## Evidence limits

The real project review found two externally stored audit evidence sets of about
20.8MB each; it found no default crawler output in the inspected project root.
CLI/UI history growth and successful comparison accumulation are source-based
risks, not evidence of that project already bloating. MCP scans do not
implicitly write the CLI history. Compression ratios from a sample snapshot
are experiments, not throughput or memory guarantees.

User evidence and prior release artifacts are not disposable caches. No broad
prefix-based deletion, shared-cache clearing or automatic migration is approved.
Future acceptance must measure reads, peak memory, artifact bytes and recovery
on representative small/large projects, including partial and interrupted runs.
