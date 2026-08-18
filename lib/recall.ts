/**
 * Whether pickers are allowed to read past failures out of the `scents` table
 * before choosing a move. Turning it off is the counterfactual half of the demo:
 * the swarm keeps running, but it stops learning from what already went wrong.
 *
 * Lives on globalThis so the flag survives Next.js module reloads in dev.
 */
const g = globalThis as unknown as { __stigmergyRecallOff?: boolean };

export function recallEnabled(): boolean {
  return g.__stigmergyRecallOff !== true;
}

export function setRecallEnabled(on: boolean): void {
  g.__stigmergyRecallOff = !on;
}
