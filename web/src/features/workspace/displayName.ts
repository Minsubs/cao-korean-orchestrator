// Display-only session name helper (feedback #13). Sessions are created with
// an internal `SESSION_PREFIX` ("cao-", see constants.py) baked into the name
// used for every API call. Showing that prefix in the UI is just noise for
// the person reading it, so every *display* surface (Sidebar, Overview,
// Thread/Workspace header, AgentSidePanel session info, Workbench context)
// should route the name through this function first. The raw name (with the
// prefix intact) must still be what's sent to the backend — never call this
// on a value that's about to be used in an API call.
const SESSION_DISPLAY_PREFIX = 'cao-'

export function displaySessionName(name: string): string {
  return name.startsWith(SESSION_DISPLAY_PREFIX) ? name.slice(SESSION_DISPLAY_PREFIX.length) || name : name
}
