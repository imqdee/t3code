import type { ThreadRemoteTerminals } from "../terminalUiStateStore";

/**
 * The drawer's terminal list to reconcile against, in the client's order with new server
 * terminals last. Remote tabs leave only through a close or their shell exiting: another
 * machine's metadata can lag an open or vanish with its server, and a tab dropped here could
 * never be found again.
 */
export function drawerServerTerminalIds(input: {
  readonly localIds: readonly string[];
  readonly remoteTerminals: ThreadRemoteTerminals;
  readonly clientIds: readonly string[];
}): string[] {
  const local = input.localIds.filter((id) => input.remoteTerminals[id] === undefined);
  const kept = new Set([...local, ...Object.keys(input.remoteTerminals)]);
  return [
    ...input.clientIds.filter((id) => kept.has(id)),
    ...local.filter((id) => !input.clientIds.includes(id)),
  ];
}
