import { AuthTerminalOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";

import { resolveEnvironmentOptionLabel } from "../BranchToolbar.logic";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentsWithScope } from "../../state/session";

const LABEL = "New Terminal on…";

/**
 * The chevron half of the new terminal button. The thread's machine comes first, then every
 * other environment. One that cannot take a terminal right now says why.
 */
export function NewTerminalMachineMenu({
  threadEnvironmentId,
  canOpenOnThreadEnvironment,
  onNewTerminal,
  onSelectEnvironment,
}: {
  threadEnvironmentId: EnvironmentId;
  canOpenOnThreadEnvironment: boolean;
  onNewTerminal: () => void;
  onSelectEnvironment: (environmentId: EnvironmentId) => void;
}) {
  const { environments } = useEnvironments();
  const operable = useEnvironmentsWithScope(environments, AuthTerminalOperateScope);

  const options = environments
    .map((environment) => {
      const isThreadEnvironment = environment.environmentId === threadEnvironmentId;
      const isPrimary = environment.entry.target._tag === "PrimaryConnectionTarget";
      return {
        environmentId: environment.environmentId,
        isThreadEnvironment,
        label: resolveEnvironmentOptionLabel({
          isPrimary,
          environmentId: environment.environmentId,
          runtimeLabel: environment.label,
        }),
        machine: resolveEnvironmentMachineKind(environment.serverConfig),
        unavailableReason: isThreadEnvironment
          ? canOpenOnThreadEnvironment
            ? null
            : "No terminal access"
          : environment.connection.phase !== "connected"
            ? "Not connected"
            : environment.serverConfig === null
              ? "Connecting"
              : !operable.has(environment.environmentId)
                ? "No terminal access"
                : null,
      };
    })
    .toSorted(
      (left, right) =>
        Number(right.isThreadEnvironment) - Number(left.isThreadEnvironment) ||
        left.label.localeCompare(right.label),
    );

  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className="inline-flex h-full min-w-4.5 items-center justify-center px-0.5 text-foreground/90 transition-colors hover:bg-accent/70"
            aria-label={LABEL}
          />
        }
      >
        <ChevronDownIcon className="size-3" />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        <MenuGroup>
          <MenuGroupLabel>New terminal on</MenuGroupLabel>
          {options.map((option) => (
            <MenuItem
              key={option.environmentId}
              disabled={option.unavailableReason !== null}
              onClick={() =>
                option.isThreadEnvironment
                  ? onNewTerminal()
                  : onSelectEnvironment(option.environmentId)
              }
            >
              <EnvironmentMachineIcon kind={option.machine} className="size-3" />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.unavailableReason ? (
                <span className="shrink-0 text-muted-foreground text-xs">
                  {option.unavailableReason}
                </span>
              ) : option.isThreadEnvironment ? (
                <span className="shrink-0 text-muted-foreground text-xs">This thread</span>
              ) : null}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
