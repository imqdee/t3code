import { AuthTerminalOperateScope } from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readEnvironmentScope } from "../../state/session";
import { terminalEnvironment } from "../../state/terminal";
import { type PendingRemoteClose, useTerminalUiStateStore } from "../../terminalUiStateStore";

const inFlight = new Set<string>();

/**
 * Closes a terminal this client opened on another environment. The close is recorded before it
 * is sent and forgotten only once it lands, so a reload, an offline machine or a failed request
 * leaves it queued for `RemoteTerminalCloseCoordinator`: nothing else would ever end that shell.
 */
export async function closeRemoteTerminalSession(target: PendingRemoteClose): Promise<void> {
  const store = useTerminalUiStateStore.getState();
  store.queueRemoteClose(target);
  const key = JSON.stringify([target.environmentId, target.threadId, target.terminalId]);
  if (inFlight.has(key) || !readEnvironmentScope(target.environmentId, AuthTerminalOperateScope)) {
    return;
  }
  inFlight.add(key);
  try {
    const result = await runAtomCommand(
      appAtomRegistry,
      terminalEnvironment.close,
      {
        environmentId: target.environmentId,
        input: { threadId: target.threadId, terminalId: target.terminalId, deleteHistory: true },
      },
      { label: "terminal close", reportFailure: false },
    );
    if (result._tag === "Success") store.forgetRemoteClose(target);
  } finally {
    inFlight.delete(key);
  }
}
