import { createFileRoute } from "@tanstack/react-router";
import { parseThreadFindQuery } from "../components/chat/threadFind";

export interface ThreadRouteSearch {
  /** Opens thread find with this query, then leaves the URL. Set by thread search results. */
  readonly find?: string;
}

// The view lives in the `_chat` layout (see ThreadRouteView) so a draft's
// promotion onto this route keeps the same ChatView mounted.
export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (raw: Record<string, unknown>): ThreadRouteSearch => {
    const find = parseThreadFindQuery(raw.find);
    return find ? { find } : {};
  },
  component: () => null,
});
