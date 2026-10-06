export type ShutdownStep = readonly [
  name: string,
  action: () => unknown | Promise<unknown>,
];

/** A failed save or cleanup must not leave later plugin registrations alive. */
export async function runShutdownSteps(
  steps: readonly ShutdownStep[],
  reportError: (name: string, error: unknown) => void,
): Promise<void> {
  for (const [name, action] of steps) {
    try {
      await action();
    } catch (error) {
      try {
        reportError(name, error);
      } catch {
        // Logging can also depend on resources already torn down.
      }
    }
  }
}
