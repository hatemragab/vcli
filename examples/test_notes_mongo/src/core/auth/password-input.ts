/** App policy: preserve Unicode exactly; bound UTF16 units and UTF8 bytes without truncation. */
export function validPasswordInput(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 12 &&
    value.length <= 128 &&
    !/[\uD800-\uDFFF]/u.test(value) &&
    Buffer.byteLength(value, 'utf8') <= 256
  );
}
