// @ts-check
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DRAFT_2020_12, SchemaRegistry, deepEqual, formatErrors } from './json-schema.mjs';

/**
 * @param {Record<string, unknown>} schema
 * @param {unknown} data
 * @returns {string}
 */
function check(schema, data) {
  const reg = new SchemaRegistry();
  reg.add({ $schema: DRAFT_2020_12, $id: 'urn:test:a', ...schema });
  return formatErrors(reg.validate('urn:test:a', data));
}

describe('tests/assets/json-schema.mjs (the validator the asset tests rely on)', () => {
  test('lint rejects unknown keywords, unresolvable references, bad patterns and unknown formats', () => {
    const reg = new SchemaRegistry();
    reg.add({ $schema: DRAFT_2020_12, $id: 'urn:test:lint', type: 'object', unevaluatedProperties: false, properties: { a: { $ref: '#/$defs/missing' }, b: { pattern: '(' }, c: { format: 'email' } } });
    const text = formatErrors(reg.lint());
    assert.match(text, /unsupported keyword "unevaluatedProperties"/);
    assert.match(text, /unresolvable \$ref #\/\$defs\/missing/);
    assert.match(text, /pattern does not compile/);
    assert.match(text, /unsupported format "email"/);
    assert.throws(() => reg.add({ $schema: DRAFT_2020_12, $id: 'urn:test:lint' }), /registered twice/);
    assert.throws(() => new SchemaRegistry().add({ $id: 'urn:x' }), /\$schema must be/);
  });

  test('types: integer is a number, number is not an integer, arrays and null are distinct', () => {
    assert.equal(check({ type: 'number' }, 3), '');
    assert.match(check({ type: 'integer' }, 3.5), /expected integer, got number/);
    assert.equal(check({ type: ['string', 'null'] }, null), '');
    assert.match(check({ type: 'object' }, []), /expected object, got array/);
  });

  test('enum and const compare deeply; uniqueItems too', () => {
    assert.equal(check({ enum: [{ a: [1, 2] }] }, { a: [1, 2] }), '');
    assert.match(check({ const: { a: 1 } }, { a: 2 }), /must equal/);
    assert.match(check({ uniqueItems: true }, [{ a: 1 }, { a: 1 }]), /items 0 and 1 are equal/);
    assert.equal(deepEqual({ a: 1, b: [1] }, { b: [1], a: 1 }), true);
    assert.equal(deepEqual([1, 2], [2, 1]), false);
  });

  test('objects: required, additionalProperties, patternProperties and propertyNames', () => {
    const schema = { type: 'object', required: ['a'], properties: { a: { type: 'string' } }, patternProperties: { '^x-': { type: 'number' } }, additionalProperties: false, propertyNames: { pattern: '^[a-z-]+$' } };
    assert.equal(check(schema, { a: 's', 'x-n': 2 }), '');
    assert.match(check(schema, {}), /missing required property "a"/);
    assert.match(check(schema, { a: 's', b: 1 }), /unexpected property "b"/);
    assert.match(check(schema, { a: 's', 'x-n': 'two' }), /expected number/);
    assert.match(check({ propertyNames: { pattern: '^[a-z]+$' } }, { Bad: 1 }), /must match/);
  });

  test('arrays: items, prefixItems, contains with min and max', () => {
    assert.match(check({ prefixItems: [{ type: 'string' }], items: { type: 'number' } }, ['a', 'b']), /\/1: expected number/);
    const one = { contains: { const: true }, minContains: 0, maxContains: 1 };
    assert.equal(check(one, [false, false]), '');
    assert.match(check(one, [true, true]), /at most 1 matching/);
    assert.match(check({ contains: { const: 1 } }, [2]), /at least 1 matching/);
  });

  test('combinators: oneOf exactly one, anyOf at least one, not, if/then/else', () => {
    assert.match(check({ oneOf: [{ type: 'number' }, { type: 'integer' }] }, 1), /exactly one schema of oneOf, matched 2/);
    assert.equal(check({ oneOf: [{ type: 'string' }, { type: 'integer' }] }, 1), '');
    assert.match(check({ anyOf: [{ type: 'string' }, { type: 'boolean' }] }, 1), /at least one schema of anyOf/);
    assert.match(check({ not: { type: 'null' } }, null), /must not match/);
    const cond = { if: { properties: { k: { const: 'a' } } }, then: { required: ['x'] }, else: { required: ['y'] } };
    assert.match(check(cond, { k: 'a' }), /missing required property "x"/);
    assert.match(check(cond, { k: 'b' }), /missing required property "y"/);
  });

  test('references: local, to the root, and across schema resources', () => {
    const reg = new SchemaRegistry();
    reg.add({ $schema: DRAFT_2020_12, $id: 'urn:test:b', $defs: { name: { type: 'string', minLength: 2 } } });
    reg.add({ $schema: DRAFT_2020_12, $id: 'urn:test:c', type: 'object', properties: { n: { $ref: 'urn:test:b#/$defs/name' }, self: { $ref: '#' } } });
    assert.deepEqual(reg.lint(), []);
    assert.equal(formatErrors(reg.validate('urn:test:c', { n: 'ab', self: { n: 'cd' } })), '');
    assert.match(formatErrors(reg.validate('urn:test:c', { self: { n: 'x' } })), /\/self\/n: must have at least 2 characters/);
  });

  test('formats are asserted: date-time, date, uri and regex', () => {
    assert.equal(check({ format: 'date-time' }, '2026-10-01T10:00:00Z'), '');
    assert.match(check({ format: 'date-time' }, '2026-10-01 10:00'), /valid date-time/);
    assert.match(check({ format: 'date' }, '2026-02-30'), /valid date/);
    assert.match(check({ format: 'uri' }, 'aave.com'), /valid uri/);
    assert.match(check({ format: 'regex' }, '(open'), /valid regex/);
  });

  test('string lengths count code points, and patterns are Unicode-aware', () => {
    const astral = String.fromCodePoint(0x1f600);
    assert.equal(check({ maxLength: 1 }, astral), '');
    assert.match(check({ minLength: 2 }, astral), /at least 2 characters/);
    assert.match(check({ pattern: '\\S' }, '   '), /must match/);
  });
});
