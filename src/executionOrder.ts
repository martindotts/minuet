import { Annotation, sortByOrder } from './model';

export interface ExecutionOrderResult {
  /** Annotations renumbered: executed steps in hit order, then the rest in their previous order. */
  annotations: Annotation[];
  /** Steps that were not hit during the run (they keep their relative order, at the end). */
  notHit: Annotation[];
  /** True when the resulting order differs from the current one. */
  changed: boolean;
}

/** Ids from `hits` that still exist, first occurrence only. */
function knownHits(annotations: readonly Annotation[], hits: readonly string[]): string[] {
  const ids = new Set(annotations.map((a) => a.id));
  return [...new Set(hits)].filter((id) => ids.has(id));
}

/** Reorders the tour following the order in which execution stopped on each step. */
export function orderByExecution(annotations: readonly Annotation[], hits: readonly string[]): ExecutionOrderResult {
  const current = sortByOrder(annotations);
  const byId = new Map(current.map((a) => [a.id, a]));
  const hitIds = knownHits(current, hits);
  const hitSet = new Set(hitIds);
  const executed = hitIds.map((id) => byId.get(id) as Annotation);
  const notHit = current.filter((a) => !hitSet.has(a.id));
  const ordered = [...executed, ...notHit].map((a, i) => (a.order === i + 1 ? a : { ...a, order: i + 1 }));
  const changed = ordered.some((a, i) => a.id !== current[i].id);
  return { annotations: ordered, notHit, changed };
}

/** True when the steps hit during the run appear in increasing tour order. */
export function isInExecutionOrder(annotations: readonly Annotation[], hits: readonly string[]): boolean {
  const orderOf = new Map(annotations.map((a) => [a.id, a.order]));
  const orders = knownHits(annotations, hits).map((id) => orderOf.get(id) as number);
  return orders.every((order, i) => i === 0 || order > orders[i - 1]);
}
