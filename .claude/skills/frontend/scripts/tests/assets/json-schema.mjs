// @ts-check
/**
 * Minimal JSON Schema 2020-12 validator for the asset tests (no dependency may be added).
 *
 * It implements the subset the schemas in assets/schemas use and asserts the formats date-time, date, uri and regex.
 * A keyword outside that subset throws, so a schema can never rely on a keyword this validator would skip.
 */

const APPLICATORS = new Set([
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'properties', 'patternProperties',
  'additionalProperties', 'propertyNames', 'items', 'prefixItems', 'contains', 'dependentSchemas',
]);
const VALIDATORS = new Set([
  'type', 'enum', 'const', 'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum',
  'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems', 'uniqueItems', 'maxContains', 'minContains',
  'maxProperties', 'minProperties', 'required', 'dependentRequired', 'format',
]);
const CORE = new Set(['$schema', '$id', '$ref', '$defs', '$comment', '$anchor']);
const ANNOTATIONS = new Set(['title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly']);
const KNOWN = new Set([...APPLICATORS, ...VALIDATORS, ...CORE, ...ANNOTATIONS]);

export const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/** @typedef {{path: string, message: string}} SchemaError */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const ao = /** @type {Record<string, unknown>} */ (a);
  const bo = /** @type {Record<string, unknown>} */ (b);
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  return ak.length === bk.length && ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/**
 * @param {unknown} value
 * @param {string} type
 * @returns {boolean}
 */
function hasType(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

/** @type {Record<string, (s: string) => boolean>} */
const FORMATS = {
  'date-time': (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)),
  date: (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  },
  uri: (s) => {
    try {
      return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(s) && Boolean(new URL(s));
    } catch {
      return false;
    }
  },
  regex: (s) => {
    try {
      new RegExp(s);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * @param {string} pointer
 * @returns {string[]}
 */
function pointerTokens(pointer) {
  if (pointer === '' || pointer === '/') return [];
  return pointer.replace(/^\//, '').split('/').map((t) => decodeURIComponent(t).replace(/~1/g, '/').replace(/~0/g, '~'));
}

export class SchemaRegistry {
  constructor() {
    /** @type {Map<string, Record<string, unknown>>} */
    this.schemas = new Map();
    /** @type {Map<string, RegExp>} */
    this.patternCache = new Map();
  }

  /**
   * Registers a schema resource by its $id after checking its keywords and references.
   * @param {unknown} schema
   * @returns {string} the $id
   */
  add(schema) {
    if (!isObject(schema)) throw new Error('a schema resource must be an object');
    const id = schema.$id;
    if (typeof id !== 'string' || id.length === 0) throw new Error('a schema resource needs a $id');
    if (schema.$schema !== DRAFT_2020_12) throw new Error(`${id}: $schema must be ${DRAFT_2020_12}`);
    if (this.schemas.has(id)) throw new Error(`${id}: registered twice`);
    this.schemas.set(id, schema);
    return id;
  }

  /**
   * Checks every registered schema: known keywords only, compiling patterns, resolvable references.
   * @returns {SchemaError[]}
   */
  lint() {
    /** @type {SchemaError[]} */
    const errors = [];
    for (const [id, root] of this.schemas) this.lintNode(root, id, '#', errors);
    return errors;
  }

  /**
   * @param {unknown} node
   * @param {string} base
   * @param {string} path
   * @param {SchemaError[]} errors
   */
  lintNode(node, base, path, errors) {
    if (typeof node === 'boolean') return;
    if (!isObject(node)) {
      errors.push({path: `${base}${path}`, message: 'schema must be an object or a boolean'});
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (!KNOWN.has(key)) errors.push({path: `${base}${path}`, message: `unsupported keyword "${key}"`});
      if (key === 'pattern' && typeof value === 'string') {
        try {
          new RegExp(value, 'u');
        } catch (err) {
          errors.push({path: `${base}${path}`, message: `pattern does not compile: ${String(err)}`});
        }
      }
      if (key === '$ref' && typeof value === 'string') {
        try {
          this.resolve(value, base);
        } catch (err) {
          errors.push({path: `${base}${path}`, message: `unresolvable $ref ${value}: ${String(err)}`});
        }
      }
      if (key === 'format' && typeof value === 'string' && !FORMATS[value]) {
        errors.push({path: `${base}${path}`, message: `unsupported format "${value}"`});
      }
      if (key === 'type') {
        const types = Array.isArray(value) ? value : [value];
        for (const t of types) {
          if (!['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'].includes(String(t))) {
            errors.push({path: `${base}${path}`, message: `unknown type "${String(t)}"`});
          }
        }
      }
    }
    /** @param {string} key */
    const sub = (key) => this.lintNode(node[key], base, `${path}/${key}`, errors);
    for (const key of ['not', 'if', 'then', 'else', 'additionalProperties', 'propertyNames', 'items', 'contains']) {
      if (key in node) sub(key);
    }
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
      const list = node[key];
      if (key in node && !Array.isArray(list)) errors.push({path: `${base}${path}`, message: `${key} must be an array`});
      if (Array.isArray(list)) list.forEach((s, i) => this.lintNode(s, base, `${path}/${key}/${i}`, errors));
    }
    for (const key of ['properties', 'patternProperties', '$defs', 'dependentSchemas']) {
      const map = node[key];
      if (isObject(map)) {
        for (const [name, s] of Object.entries(map)) {
          if (key === 'patternProperties') {
            try {
              new RegExp(name, 'u');
            } catch (err) {
              errors.push({path: `${base}${path}`, message: `patternProperties key does not compile: ${String(err)}`});
            }
          }
          this.lintNode(s, base, `${path}/${key}/${name}`, errors);
        }
      }
    }
  }

  /**
   * @param {string} ref
   * @param {string} base
   * @returns {{schema: unknown, base: string}}
   */
  resolve(ref, base) {
    const hash = ref.indexOf('#');
    const resource = hash === -1 ? ref : ref.slice(0, hash);
    const fragment = hash === -1 ? '' : ref.slice(hash + 1);
    const targetBase = resource === '' ? base : resource;
    const root = this.schemas.get(targetBase);
    if (!root) throw new Error(`unknown schema resource ${targetBase}`);
    /** @type {unknown} */
    let node = root;
    for (const token of pointerTokens(fragment)) {
      if (Array.isArray(node)) node = node[Number(token)];
      else if (isObject(node) && token in node) node = node[token];
      else throw new Error(`no ${fragment} in ${targetBase}`);
    }
    if (node === undefined) throw new Error(`no ${fragment} in ${targetBase}`);
    return {schema: node, base: targetBase};
  }

  /**
   * @param {string} source
   * @returns {RegExp}
   */
  regex(source) {
    let re = this.patternCache.get(source);
    if (!re) {
      re = new RegExp(source, 'u');
      this.patternCache.set(source, re);
    }
    return re;
  }

  /**
   * Validates data against a registered schema id (optionally with a #fragment).
   * @param {string} ref
   * @param {unknown} data
   * @returns {SchemaError[]}
   */
  validate(ref, data) {
    const {schema, base} = this.resolve(ref, ref.split('#')[0]);
    /** @type {SchemaError[]} */
    const errors = [];
    this.check(schema, base, data, '', errors);
    return errors;
  }

  /**
   * @param {unknown} schema
   * @param {string} base
   * @param {unknown} data
   * @param {string} path
   * @param {SchemaError[]} errors
   */
  check(schema, base, data, path, errors) {
    if (schema === true) return;
    if (schema === false) {
      errors.push({path, message: 'no value is allowed here'});
      return;
    }
    if (!isObject(schema)) throw new Error(`invalid schema at ${path}`);
    const s = schema;
    /** @param {string} message */
    const fail = (message) => errors.push({path: path || '/', message});
    /**
     * @param {unknown} sub
     * @param {unknown} value
     * @param {string} at
     * @returns {SchemaError[]}
     */
    const trial = (sub, value, at) => {
      /** @type {SchemaError[]} */
      const errs = [];
      this.check(sub, base, value, at, errs);
      return errs;
    };

    if (typeof s.$ref === 'string') {
      const target = this.resolve(s.$ref, base);
      this.check(target.schema, target.base, data, path, errors);
    }

    if ('type' in s) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => hasType(data, String(t)))) fail(`expected ${types.join(' or ')}, got ${typeOf(data)}`);
    }
    if (Array.isArray(s.enum) && !s.enum.some((v) => deepEqual(v, data))) {
      fail(`must be one of ${JSON.stringify(s.enum)}`);
    }
    if ('const' in s && !deepEqual(s.const, data)) fail(`must equal ${JSON.stringify(s.const)}`);

    if (typeof data === 'number') {
      if (typeof s.minimum === 'number' && data < s.minimum) fail(`must be >= ${s.minimum}`);
      if (typeof s.maximum === 'number' && data > s.maximum) fail(`must be <= ${s.maximum}`);
      if (typeof s.exclusiveMinimum === 'number' && data <= s.exclusiveMinimum) fail(`must be > ${s.exclusiveMinimum}`);
      if (typeof s.exclusiveMaximum === 'number' && data >= s.exclusiveMaximum) fail(`must be < ${s.exclusiveMaximum}`);
      if (typeof s.multipleOf === 'number' && !Number.isInteger(data / s.multipleOf)) fail(`must be a multiple of ${s.multipleOf}`);
    }

    if (typeof data === 'string') {
      const length = [...data].length;
      if (typeof s.minLength === 'number' && length < s.minLength) fail(`must have at least ${s.minLength} characters`);
      if (typeof s.maxLength === 'number' && length > s.maxLength) fail(`must have at most ${s.maxLength} characters`);
      if (typeof s.pattern === 'string' && !this.regex(s.pattern).test(data)) fail(`must match ${s.pattern}`);
      if (typeof s.format === 'string') {
        const ok = FORMATS[s.format];
        if (!ok) throw new Error(`unsupported format ${s.format}`);
        if (!ok(data)) fail(`must be a valid ${s.format}`);
      }
    }

    if (Array.isArray(data)) {
      if (typeof s.minItems === 'number' && data.length < s.minItems) fail(`must have at least ${s.minItems} items`);
      if (typeof s.maxItems === 'number' && data.length > s.maxItems) fail(`must have at most ${s.maxItems} items`);
      if (s.uniqueItems === true) {
        for (let i = 0; i < data.length; i += 1) {
          for (let j = i + 1; j < data.length; j += 1) {
            if (deepEqual(data[i], data[j])) fail(`items ${i} and ${j} are equal`);
          }
        }
      }
      const prefix = Array.isArray(s.prefixItems) ? s.prefixItems : [];
      prefix.forEach((sub, i) => {
        if (i < data.length) this.check(sub, base, data[i], `${path}/${i}`, errors);
      });
      if ('items' in s) {
        for (let i = prefix.length; i < data.length; i += 1) this.check(s.items, base, data[i], `${path}/${i}`, errors);
      }
      if ('contains' in s) {
        const matches = data.filter((item, i) => trial(s.contains, item, `${path}/${i}`).length === 0).length;
        const min = typeof s.minContains === 'number' ? s.minContains : 1;
        if (matches < min) fail(`must contain at least ${min} matching item(s)`);
        if (typeof s.maxContains === 'number' && matches > s.maxContains) fail(`must contain at most ${s.maxContains} matching item(s)`);
      }
    }

    if (isObject(data)) {
      const keys = Object.keys(data);
      if (typeof s.minProperties === 'number' && keys.length < s.minProperties) fail(`must have at least ${s.minProperties} properties`);
      if (typeof s.maxProperties === 'number' && keys.length > s.maxProperties) fail(`must have at most ${s.maxProperties} properties`);
      if (Array.isArray(s.required)) {
        for (const key of s.required) {
          if (!(String(key) in data)) fail(`missing required property "${String(key)}"`);
        }
      }
      if (isObject(s.dependentRequired)) {
        for (const [key, needs] of Object.entries(s.dependentRequired)) {
          if (key in data && Array.isArray(needs)) {
            for (const need of needs) if (!(String(need) in data)) fail(`"${key}" requires "${String(need)}"`);
          }
        }
      }
      const props = isObject(s.properties) ? s.properties : {};
      const patterns = isObject(s.patternProperties) ? s.patternProperties : {};
      for (const key of keys) {
        const at = `${path}/${key}`;
        let matched = false;
        if (key in props) {
          matched = true;
          this.check(props[key], base, data[key], at, errors);
        }
        for (const [source, sub] of Object.entries(patterns)) {
          if (this.regex(source).test(key)) {
            matched = true;
            this.check(sub, base, data[key], at, errors);
          }
        }
        if (!matched && 'additionalProperties' in s) {
          if (s.additionalProperties === false) fail(`unexpected property "${key}"`);
          else this.check(s.additionalProperties, base, data[key], at, errors);
        }
        if ('propertyNames' in s) this.check(s.propertyNames, base, key, `${at} (name)`, errors);
      }
      if (isObject(s.dependentSchemas)) {
        for (const [key, sub] of Object.entries(s.dependentSchemas)) {
          if (key in data) this.check(sub, base, data, path, errors);
        }
      }
    }

    if (Array.isArray(s.allOf)) s.allOf.forEach((sub) => this.check(sub, base, data, path, errors));
    if (Array.isArray(s.anyOf)) {
      const results = s.anyOf.map((sub) => trial(sub, data, path));
      if (!results.some((r) => r.length === 0)) {
        fail(`must match at least one schema of anyOf (${results.map((r) => r[0] && r[0].message).join(' | ')})`);
      }
    }
    if (Array.isArray(s.oneOf)) {
      const results = s.oneOf.map((sub) => trial(sub, data, path));
      const passing = results.filter((r) => r.length === 0).length;
      if (passing !== 1) {
        fail(`must match exactly one schema of oneOf, matched ${passing} (${results.map((r) => r[0] && r[0].message).join(' | ')})`);
      }
    }
    if ('not' in s && trial(s.not, data, path).length === 0) fail('must not match the "not" schema');
    if ('if' in s) {
      const holds = trial(s.if, data, path).length === 0;
      if (holds && 'then' in s) this.check(s.then, base, data, path, errors);
      if (!holds && 'else' in s) this.check(s.else, base, data, path, errors);
    }
  }
}

/**
 * Formats errors for an assertion message.
 * @param {SchemaError[]} errors
 * @returns {string}
 */
export function formatErrors(errors) {
  return errors.map((e) => `${e.path}: ${e.message}`).join('\n');
}
