/** Converts a human (1-based) line number to the internal 0-based representation. */
export function toZeroBased(line: number): number {
  return line - 1;
}

/** Converts an internal 0-based line number to the human (1-based) representation. */
export function toOneBased(line: number): number {
  return line + 1;
}
