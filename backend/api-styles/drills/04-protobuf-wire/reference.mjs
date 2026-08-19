/** Drill 04 — reference. */

const WIRE = { VARINT: 0, FIXED64: 1, LEN: 2, FIXED32: 5 };

const wireTypeOf = (type) => (type === 'string' || type === 'message' || type === 'bytes' ? WIRE.LEN : WIRE.VARINT);

export function encodeVarint(n) {
  let v = BigInt(n);
  if (v < 0n) v += 1n << 64n;          // two's complement, which is why a negative int32 is 10 bytes
  const bytes = [];
  do {
    let byte = Number(v & 0x7fn);      // seven bits at a time, least significant first
    v >>= 7n;
    if (v > 0n) byte |= 0x80;          // the continuation bit
    bytes.push(byte);
  } while (v > 0n);
  return Buffer.from(bytes);
}

export function decodeVarint(buf, offset = 0) {
  let value = 0n, shift = 0n;
  for (;;) {
    if (offset >= buf.length) throw new Error('truncated varint');
    const byte = buf[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
    if (shift > 63n) throw new Error('varint too long');   // a hostile input can otherwise loop
  }
  const asNumber = value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  return { value: asNumber, offset };
}

// (n << 1) ^ (n >> 31) with BigInt, so it is correct past 2^31 too.
const zigzag = (n) => { const v = BigInt(n); return v >= 0n ? v * 2n : -v * 2n - 1n; };
const unzigzag = (n) => { const v = BigInt(n); return Number(v % 2n === 0n ? v / 2n : -((v + 1n) / 2n)); };

const tag = (fieldNumber, wireType) => encodeVarint((fieldNumber << 3) | wireType);

function encodeValue(field, value) {
  switch (field.type) {
    case 'int32':
    case 'int64':
    case 'uint32':
      return encodeVarint(value);
    case 'sint32':
    case 'sint64':
      return encodeVarint(zigzag(value));
    case 'bool':
      return encodeVarint(value ? 1 : 0);
    case 'string': {
      // The length is in BYTES. Buffer.byteLength, never string.length — an emoji is one
      // character and four bytes, and getting this wrong truncates the payload of every message
      // that contains one.
      const body = Buffer.from(value, 'utf8');
      return Buffer.concat([encodeVarint(body.length), body]);
    }
    case 'bytes':
      return Buffer.concat([encodeVarint(value.length), Buffer.from(value)]);
    case 'message': {
      const body = encode(field.message, value);
      return Buffer.concat([encodeVarint(body.length), body]);
    }
    default:
      throw new Error(`unsupported type ${field.type}`);
  }
}

const isDefault = (field, value) =>
  value === undefined || value === null ||
  (field.type === 'string' && value === '') ||
  (field.type === 'bool' && value === false) ||
  (/int/.test(field.type) && value === 0);

export function encode(schema, obj) {
  const parts = [];
  // Sorted by field number. Not required by the spec — a decoder must accept any order — but it
  // makes the output deterministic, which is what lets you hash, cache or diff a message.
  const nums = Object.keys(schema).map(Number).sort((a, b) => a - b);

  for (const num of nums) {
    const field = schema[num];
    const value = obj[field.name];
    if (value === undefined || value === null) continue;

    if (field.repeated) {
      for (const item of value) {
        parts.push(tag(num, wireTypeOf(field.type)), encodeValue(field, item));
      }
      continue;
    }

    // proto3: a field at its default value is NOT WRITTEN. That is where the compactness comes
    // from — a message with twenty optional fields and three set costs three fields — and it is
    // also why proto3 cannot tell "unset" from "zero" without the `optional` keyword, which
    // wraps the field in a presence bit. If the difference matters to your API (a nullable
    // price, a boolean the user has not answered), you must say `optional`.
    if (isDefault(field, value)) continue;

    parts.push(tag(num, wireTypeOf(field.type)), encodeValue(field, value));
  }
  return Buffer.concat(parts);
}

export function decode(schema, buf) {
  const out = {};
  // Defaults first, so a caller never has to write `msg.count ?? 0`.
  for (const field of Object.values(schema)) {
    if (field.repeated) out[field.name] = [];
    else if (field.type === 'string') out[field.name] = '';
    else if (field.type === 'bool') out[field.name] = false;
    else if (/int/.test(field.type)) out[field.name] = 0;
  }

  let offset = 0;
  while (offset < buf.length) {
    const t = decodeVarint(buf, offset);
    offset = t.offset;
    const fieldNumber = Number(t.value) >>> 3;
    const wireType = Number(t.value) & 0x07;
    const field = schema[fieldNumber];

    // THE LINE THAT MAKES INDEPENDENT DEPLOYS POSSIBLE.
    //
    // An unknown field is not an error. The wire type in the tag says exactly how many bytes to
    // step over, so a reader built last year can consume a message written today, keep every
    // field it understands, and ignore the rest. Rejecting unknown fields — which is what a
    // hand-rolled format and a strict JSON schema both do by default — means the producer and
    // the consumer must be deployed together, which means they must be released together, which
    // means you no longer have two services.
    //
    // (Real implementations RETAIN the unknown bytes and re-emit them on serialise, so a proxy
    // that reads and rewrites a message does not silently strip fields it never knew about.)
    if (!field) { offset = skip(buf, offset, wireType); continue; }

    // A known field number with the WRONG wire type means the two ends disagree about the
    // schema — someone changed a type or reused a number. Skipping is the safe choice; throwing
    // is also defensible. Silently reinterpreting the bytes is not.
    if (wireType !== wireTypeOf(field.type)) { offset = skip(buf, offset, wireType); continue; }

    let value;
    if (wireType === WIRE.VARINT) {
      const v = decodeVarint(buf, offset);
      offset = v.offset;
      value = field.type === 'bool' ? Boolean(v.value)
        : /^sint/.test(field.type) ? unzigzag(v.value)
        : Number(v.value);
    } else {
      const len = decodeVarint(buf, offset);
      offset = len.offset;
      const body = buf.subarray(offset, offset + Number(len.value));
      offset += Number(len.value);
      value = field.type === 'message' ? decode(field.message, body)
        : field.type === 'bytes' ? Buffer.from(body)
        : body.toString('utf8');
    }

    if (field.repeated) out[field.name].push(value);
    else out[field.name] = value;
  }
  return out;
}

function skip(buf, offset, wireType) {
  switch (wireType) {
    case WIRE.VARINT: return decodeVarint(buf, offset).offset;
    case WIRE.FIXED64: return offset + 8;
    case WIRE.FIXED32: return offset + 4;
    case WIRE.LEN: {
      const len = decodeVarint(buf, offset);
      return len.offset + Number(len.value);
    }
    default: throw new Error(`cannot skip wire type ${wireType}`);
  }
}

/*
THE SCHEMA-EVOLUTION RULES, AND WHY EACH ONE IS WHAT IT IS

  SAFE
    · add a new field with a NEW number. Old readers skip it (the line above).
    · remove a field — but `reserved 4, 7;` and `reserved "old_name";` so nobody reuses them.
    · rename a field. The NAME IS NOT ON THE WIRE. Only the number is.
    · int32 <-> int64 <-> uint32 <-> bool: all wire type 0, all compatible in practice.

  NOT SAFE
    · REUSE A FIELD NUMBER. This is the one that corrupts data rather than failing. Old messages
      still contain field 2, the new reader still reads field 2, and if the wire type happens to
      match it will happily give you nonsense. `reserved` exists solely to make this impossible.
    · change between wire types (string <-> int32). Better: it usually fails loudly.
    · change sint32 <-> int32. Same wire type, different meaning: every negative number becomes
      a different negative number. Silent.
    · change a field from `optional` to `required` (proto2) or add required at all. This is why
      proto3 deleted `required` from the language.

FIELD NUMBERS 1-15 ARE SPECIAL
Their tag fits in ONE byte (4 bits of field number, 3 of wire type, 1 continuation). 16-2047 take
two. So the fields you send on every message belong in 1-15, and that is a design decision you
make once, at the start, because you cannot renumber later.

WHY gRPC IS FAST, HONESTLY
Three separate things, and people credit the wrong one:
  1. protobuf is compact and parses without allocating a DOM the way JSON does — worth maybe
     2-5x on payload size and more on parse time.
  2. HTTP/2 multiplexes many calls over one connection, so no per-request handshake and no
     head-of-line blocking at the TCP level.
  3. THE SCHEMA IS SHARED AND CHECKED. This is the one that matters most and has nothing to do
     with speed: `buf breaking` can tell you in CI that a change would break an existing client,
     which no amount of OpenAPI discipline reliably achieves.

And the cost: it is not human-readable, `curl` cannot call it, and browsers cannot speak it
without a proxy (grpc-web) or a translating layer (connect). That is the actual trade — not
milliseconds.
*/
