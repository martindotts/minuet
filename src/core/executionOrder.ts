import { Step, sortByOrder } from './model';

export interface ExecutionOrderResult {
  /** Steps renumbered: executed steps in hit order, then the rest in their previous order. */
  steps: Step[];
  /** Steps that were not hit during the run (they keep their relative order, at the end). */
  notHit: Step[];
  /** True when the resulting order differs from the current one. */
  changed: boolean;
}

/** Ids from `hits` that still exist, first occurrence only. */
function knownHits(steps: readonly Step[], hits: readonly string[]): string[] {
  const ids = new Set(steps.map((a) => a.id));
  return [...new Set(hits)].filter((id) => ids.has(id));
}

/** Reorders the tour following the order in which execution stopped on each step. */
export function orderByExecution(steps: readonly Step[], hits: readonly string[]): ExecutionOrderResult {
  const current = sortByOrder(steps);
  const byId = new Map(current.map((a) => [a.id, a]));
  const hitIds = knownHits(current, hits);
  const hitSet = new Set(hitIds);
  const executed = hitIds.map((id) => byId.get(id) as Step);
  const notHit = current.filter((a) => !hitSet.has(a.id));
  const ordered = [...executed, ...notHit].map((a, i) => (a.order === i + 1 ? a : { ...a, order: i + 1 }));
  const changed = ordered.some((a, i) => a.id !== current[i].id);
  return { steps: ordered, notHit, changed };
}

/** True when the steps hit during the run appear in increasing tour order. */
export function isInExecutionOrder(steps: readonly Step[], hits: readonly string[]): boolean {
  const orderOf = new Map(steps.map((a) => [a.id, a.order]));
  const orders = knownHits(steps, hits).map((id) => orderOf.get(id) as number);
  return orders.every((order, i) => i === 0 || order > orders[i - 1]);
}
