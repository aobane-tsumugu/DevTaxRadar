// UTF-8 bytes of the complete JSON, not JavaScript UTF-16 code units.
export const WORKSPACE_BODY_LIMIT = 2 * 1024 * 1024
// A recovery record holds both the accepted base and the outgoing request.
export const WORKSPACE_ATTEMPT_LIMIT = 2 * WORKSPACE_BODY_LIMIT + 64 * 1024

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength
}
