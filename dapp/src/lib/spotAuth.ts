// Message a merchant signs to act on their own spot (edit / pause / reactivate).
// Dependency-free so client + server can share it. Bound to action + id + time so
// a signature can't be replayed for a different action or spot.
export function spotActionMessage(action: string, spotId: string, timestamp: number): string {
  return `GOODDROPS_SPOT:${action}:${spotId}:${timestamp}`;
}
