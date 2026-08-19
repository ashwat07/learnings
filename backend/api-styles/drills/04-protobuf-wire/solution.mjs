/**
 * Drill 04 — the protobuf wire format.
 *
 * The starting point encodes each field with a fixed 4-byte length prefix and a JSON payload.
 * It round-trips, it is simple, and it is missing every property that makes protobuf worth
 * using: it is not compact, and a reader cannot skip a field it does not understand — so the
 * producer and the consumer must be deployed together, forever.
 *
 * THE FORMAT
 *
 * A message is a sequence of (tag, value) pairs. Nothing else — no field names, no schema, no
 * framing. The tag is a varint:
 *
 *     tag = (fieldNumber << 3) | wireType
 *
 *     wireType 0   varint            int32, int64, uint, bool, enum, sint (zigzagged)
 *     wireType 1   fixed 64-bit      double, fixed64
 *     wireType 2   length-delimited  string, bytes, embedded message, packed repeated
 *     wireType 5   fixed 32-bit      float, fixed32
 *
 * A VARINT is base-128, little-endian groups of 7 bits, with the high bit of each byte meaning
 * "another byte follows". So 1 is one byte and 300 is two, which is why a protobuf message with
 * small numbers is so much smaller than the JSON that spells them out in decimal.
 *
 * ZIGZAG (for sint32/sint64) maps signed to unsigned so that small NEGATIVE numbers stay small:
 *
 *     encoded = (n << 1) ^ (n >> 31)      ...  0 -> 0, -1 -> 1, 1 -> 2, -2 -> 3
 *
 * Without it, a plain int32 of -1 is sign-extended to 64 bits and costs TEN bytes.
 *
 * THE PROPERTY THAT MATTERS MOST is that wireType is in the tag. A reader that meets a field
 * number it has never heard of still knows HOW MUCH TO SKIP — and that is the entire basis of
 * being able to deploy a producer and a consumer independently.
 */

export function encodeVarint(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(Number(n));
  return buf;
}

export function decodeVarint(buf, offset = 0) {
  return { value: buf.readUInt32LE(offset), offset: offset + 4 };
}

export function encode(schema, obj) {
  const parts = [];
  for (const [num, field] of Object.entries(schema)) {
    const value = obj[field.name];
    if (value === undefined) continue;
    const payload = Buffer.from(JSON.stringify(value), 'utf8');
    const header = Buffer.alloc(8);
    header.writeUInt32LE(Number(num), 0);
    header.writeUInt32LE(payload.length, 4);
    parts.push(header, payload);
  }
  return Buffer.concat(parts);
}

export function decode(schema, buf) {
  const out = {};
  let offset = 0;
  while (offset < buf.length) {
    const num = buf.readUInt32LE(offset);
    const len = buf.readUInt32LE(offset + 4);
    const payload = buf.subarray(offset + 8, offset + 8 + len);
    offset += 8 + len;
    const field = schema[num];
    if (!field) throw new Error(`unknown field ${num}`);   // <- and there goes your rollout
    out[field.name] = JSON.parse(payload.toString('utf8'));
  }
  return out;
}
