export const title = 'The protobuf wire format, by hand';
export const task = `gRPC is HTTP/2 plus protobuf, and protobuf is the half that decides what you
can change later. Implement enough of the wire format to see why.

  encodeVarint(n) -> Buffer          base-128, 7 bits per byte, high bit = "more follows"
  decodeVarint(buf, offset) -> { value, offset }
  encode(schema, obj) -> Buffer
  decode(schema, buf) -> obj

A schema here is { <fieldNumber>: { name, type, repeated? , message? } } with types
'int32' | 'sint32' | 'string' | 'bool' | 'message'.

The checks include real byte sequences from the protobuf specification, and — more importantly —
what happens when the two ends disagree about the schema. That is the part that decides whether
you can deploy a producer and a consumer independently.`;
export const passIf = 'the bytes match the spec, messages round-trip, and a field the reader has never heard of is skipped rather than fatal';

const hex = (b) => Buffer.from(b).toString('hex').replace(/(..)/g, '$1 ').trim();

const Address = {
  1: { name: 'street', type: 'string' },
  2: { name: 'zip', type: 'string' },
};

const Person = {
  1: { name: 'id', type: 'int32' },
  2: { name: 'name', type: 'string' },
  3: { name: 'active', type: 'bool' },
  4: { name: 'scores', type: 'int32', repeated: true },
  5: { name: 'address', type: 'message', message: Address },
  6: { name: 'balance', type: 'sint32' },
};

export async function check(s) {
  const need = ['encodeVarint', 'decodeVarint', 'encode', 'decode'];
  const missing = need.filter((k) => typeof s[k] !== 'function');
  if (missing.length) return [{ check: `exports ${need.join(', ')}`, actual: `missing ${missing.join(', ')}`, pass: false }];

  const out = [];
  const guard = (label, fn) => {
    try { const r = fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 64), pass: false }); }
  };

  // The canonical example from the protobuf documentation.
  guard('varint 150 encodes as 96 01 (the example from the spec)', () => {
    const got = hex(s.encodeVarint(150));
    return got === '96 01' || `got ${got}`;
  });

  guard('varints round-trip across the byte boundaries', () => {
    for (const n of [0, 1, 127, 128, 255, 300, 16383, 16384, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
      const buf = s.encodeVarint(n);
      const { value, offset } = s.decodeVarint(buf, 0);
      if (Number(value) !== n) return `${n} -> ${hex(buf)} -> ${value}`;
      if (offset !== buf.length) return `${n}: consumed ${offset} of ${buf.length} bytes`;
    }
    return true;
  });

  guard('a small number is ONE byte — this is the whole point', () => {
    return s.encodeVarint(1).length === 1 && s.encodeVarint(127).length === 1 && s.encodeVarint(128).length === 2
      ? true : `1 -> ${s.encodeVarint(1).length}B, 127 -> ${s.encodeVarint(127).length}B, 128 -> ${s.encodeVarint(128).length}B`;
  });

  guard('field 1 = 150 encodes as 08 96 01', () => {
    const got = hex(s.encode({ 1: { name: 'a', type: 'int32' } }, { a: 150 }));
    return got === '08 96 01' || `got ${got} — the tag byte is (fieldNumber << 3) | wireType`;
  });

  guard('field 2 = "testing" encodes as 12 07 74 65 73 74 69 6e 67', () => {
    const got = hex(s.encode({ 2: { name: 'b', type: 'string' } }, { b: 'testing' }));
    return got === '12 07 74 65 73 74 69 6e 67' || `got ${got}`;
  });

  guard('a whole message round-trips', () => {
    const person = { id: 42, name: 'Ada Lovelace', active: true, scores: [10, 20, 30], balance: -7 };
    const buf = s.encode(Person, person);
    const back = s.decode(Person, buf);
    for (const [k, v] of Object.entries(person)) {
      if (JSON.stringify(back[k]) !== JSON.stringify(v)) return `${k}: ${JSON.stringify(back[k])} != ${JSON.stringify(v)}`;
    }
    return true;
  });

  guard('a nested message round-trips', () => {
    const person = { id: 1, name: 'x', address: { street: '12 Main St', zip: 'EC1A' } };
    const back = s.decode(Person, s.encode(Person, person));
    return (back.address?.street === '12 Main St' && back.address?.zip === 'EC1A')
      ? true : JSON.stringify(back.address);
  });

  guard('UTF-8 survives — length is in BYTES, not characters', () => {
    const back = s.decode(Person, s.encode(Person, { id: 1, name: 'héllo 日本 🎉' }));
    return back.name === 'héllo 日本 🎉' || `got ${JSON.stringify(back.name)}`;
  });

  guard('sint32 zigzags: -1 is one byte, not ten', () => {
    const zig = s.encode({ 6: { name: 'balance', type: 'sint32' } }, { balance: -1 });
    const plain = s.encode({ 1: { name: 'n', type: 'int32' } }, { n: -1 });
    // zigzag: -1 -> 1, so tag + 0x01 = 2 bytes total.
    if (zig.length !== 2) return `sint32 -1 took ${zig.length} bytes (want 2: tag + 0x01)`;
    const back = s.decode({ 6: { name: 'balance', type: 'sint32' } }, zig);
    if (back.balance !== -1) return `sint32 -1 decoded as ${back.balance}`;
    return plain.length >= zig.length ? true : `plain int32 -1 (${plain.length}B) should not beat zigzag (${zig.length}B)`;
  });

  guard('a repeated field with no values emits nothing', () => {
    const buf = s.encode(Person, { id: 1, scores: [] });
    const back = s.decode(Person, buf);
    return JSON.stringify(back.scores ?? []) === '[]' ? true : JSON.stringify(back.scores);
  });

  // proto3's most surprising rule.
  guard('a zero value is NOT written — and decodes back to the default', () => {
    const withZero = s.encode(Person, { id: 0, name: '', active: false });
    const empty = s.encode(Person, {});
    if (withZero.length !== 0) return `{id:0, name:"", active:false} produced ${withZero.length} bytes; proto3 omits defaults`;
    if (empty.length !== 0) return `{} produced ${empty.length} bytes`;
    const back = s.decode(Person, withZero);
    return (back.id === 0 && back.name === '' && back.active === false)
      ? true : `decoded to ${JSON.stringify(back)}`;
  });

  // THE compatibility lesson.
  guard('a field the reader has never heard of is SKIPPED, not fatal', () => {
    // The producer has been deployed with a new field 9; the consumer has not.
    const NewPerson = { ...Person, 9: { name: 'nickname', type: 'string' } };
    const buf = s.encode(NewPerson, { id: 5, name: 'Ada', nickname: 'the countess', balance: -3 });
    const back = s.decode(Person, buf);        // the OLD schema reads the NEW bytes
    if (back.id !== 5 || back.name !== 'Ada') return `known fields broke: ${JSON.stringify(back)}`;
    if (back.balance !== -3) return `a field AFTER the unknown one was lost: ${JSON.stringify(back)} — the skip did not consume the right number of bytes`;
    return true;
  });

  guard('an unknown LENGTH-DELIMITED field is skipped by its length', () => {
    const NewPerson = { ...Person, 12: { name: 'blob', type: 'message', message: Address } };
    const buf = s.encode(NewPerson, { id: 7, blob: { street: 'somewhere long enough to matter', zip: 'ZZ' }, balance: 4 });
    const back = s.decode(Person, buf);
    return (back.id === 7 && back.balance === 4) ? true : `${JSON.stringify(back)}`;
  });

  guard('a field REMOVED from the schema is skipped by the new reader', () => {
    const buf = s.encode(Person, { id: 3, name: 'kept', active: true, balance: 1 });
    const Trimmed = { 1: Person[1], 6: Person[6] };     // name and active deleted, numbers NOT reused
    const back = s.decode(Trimmed, buf);
    return (back.id === 3 && back.balance === 1) ? true : JSON.stringify(back);
  });

  guard('...but REUSING a field number silently corrupts the meaning', () => {
    const buf = s.encode(Person, { id: 3, name: 'kept' });
    // Someone deleted `name` and gave field 2 to a new int32. The bytes still parse.
    const Reused = { 1: Person[1], 2: { name: 'age', type: 'int32' } };
    let result;
    try { result = JSON.stringify(s.decode(Reused, buf)); } catch (e) { result = `threw ${e.message}`; }
    // Either outcome is acceptable behaviour; what matters is that it is NOT the original data.
    return !/kept/.test(result) ? true : `field 2 still decoded as "kept" — reuse a field number and the wire type is the only thing standing between you and garbage`;
  });

  guard('protobuf is much smaller than the equivalent JSON', () => {
    const person = { id: 42, name: 'Ada Lovelace', active: true, scores: [10, 20, 30], balance: -7,
      address: { street: '12 Main St', zip: 'EC1A' } };
    const proto = s.encode(Person, person).length;
    const json = Buffer.byteLength(JSON.stringify(person));
    return proto < json * 0.6 ? true : `protobuf ${proto}B vs JSON ${json}B — expected well under 60%`;
  });

  return out;
}
