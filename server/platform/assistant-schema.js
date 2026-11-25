// What an app tells Joules it can do, and the checks on what goes in and comes out (assistant.js serves it). Pure, so it is
// tested on its own.
//
// An app says it in an optional `assistant` export from server/app/index.js:
//   export const assistant = {
//     about: 'One or two sentences for Joules: what the app is for and what he can do here.',
//     actions: [
//       { name: 'my_tickets', kind: 'read', title: 'Your tickets', description: '...', input: { type: 'object', properties: {...} },
//         run: async ({ user, input, app, directory }) => anyJson },
//       { name: 'raise_ticket', kind: 'write', title: 'Raise a ticket', description: '...', input: {...},
//         preview: async (context) => ({ summary, fields: [{ label, value }] }),
//         run: async (context) => ({ summary, ref, path }) },
//     ],
//   };
// A read action only looks: Joules runs it when it helps. A write action changes something, so Joules first asks for its
// preview (what the app would do, worked out by the app, changing nothing), shows the person, and runs it only once the
// person has said yes. `input` is a small part of JSON Schema, below; anything else is refused at boot.
//
// From template 1.7.0 an app may also offer Joules a set of actions for each other way a person talks to him:
//     channels: { voice: [ ...actions ], sms: [ ...actions ] },
// `actions` stays the chat's. A token says which way it is for (assistant-token.js, `via`), and the door then offers and
// runs only that way's set, so an action an app keeps out of a phone call cannot be reached from one. The same action
// object may be in more than one set. An app with no set for a way simply offers nothing there.
//
// A write's preview may also answer `check` (from 1.7.0): a short text the app works out from exactly what it would do
// (a hash of its plan, say). The portal sends it back with the run, and the action finds it as `context.check`, so it can
// refuse (409) to do anything other than what the person was shown.

export const LIMITS = Object.freeze({ actions: 20, about: 800, title: 60, description: 800, properties: 12, enum: 50, text: 20000, items: 50, result: 64_000, summary: 600, fields: 12, label: 60, value: 2000, ref: 60, path: 300, check: 128 });
export const OTHER_CHANNELS = Object.freeze(['voice', 'sms']);
const CHECK = /^[\x21-\x7e]{1,128}$/;
const NAME = /^[a-z][a-z0-9_]{1,39}$/;
const PROPERTY = /^[a-z][a-zA-Z0-9_]{0,39}$/;
const KINDS = ['read', 'write'];

const isText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;

// Throws, naming every problem, when an app's `assistant` export is not something the platform can serve.
export function checkAssistant(assistant, appId) {
  if (assistant === undefined) return;
  const problems = [];
  if (!isObject(assistant)) problems.push('assistant must be an object');
  else {
    if (!isText(assistant.about, LIMITS.about)) problems.push(`assistant.about must be text of at most ${LIMITS.about} characters`);
    problems.push(...actionsProblems(assistant.actions, 'assistant.actions', 'assistant action'));
    if (assistant.channels !== undefined) {
      if (!isObject(assistant.channels)) problems.push('assistant.channels must be an object');
      else {
        for (const [channel, list] of Object.entries(assistant.channels)) {
          if (!OTHER_CHANNELS.includes(channel)) problems.push(`assistant.channels.${channel}: the ways are ${OTHER_CHANNELS.join(' and ')} (the chat's actions are assistant.actions)`);
          else problems.push(...actionsProblems(list, `assistant.channels.${channel}`, `assistant ${channel} action`));
        }
      }
    }
  }
  if (problems.length) throw new Error(`${appId} assistant cannot be served:\n${problems.map((line) => `  - ${line}`).join('\n')}`);
}

function actionsProblems(actions, listName, label) {
  if (!Array.isArray(actions)) return [`${listName} must be a list`];
  const problems = [];
  if (actions.length > LIMITS.actions) problems.push(`${listName} has more than ${LIMITS.actions} actions`);
  const names = new Set();
  for (const action of actions) {
    const where = `${label} ${isObject(action) && typeof action.name === 'string' ? action.name : '?'}`;
    if (!isObject(action)) {
      problems.push(`every ${label} must be an object`);
      continue;
    }
    if (!NAME.test(String(action.name))) problems.push(`${where}: name must be lower case letters, digits and _, 2 to 40 long`);
    else if (names.has(action.name)) problems.push(`${where}: the name is used twice`);
    names.add(action.name);
    if (!KINDS.includes(action.kind)) problems.push(`${where}: kind must be read or write`);
    if (!isText(action.title, LIMITS.title)) problems.push(`${where}: title must be text of at most ${LIMITS.title} characters`);
    if (!isText(action.description, LIMITS.description)) problems.push(`${where}: description must be text of at most ${LIMITS.description} characters`);
    if (typeof action.run !== 'function') problems.push(`${where}: run must be a function`);
    if (action.kind === 'write' && typeof action.preview !== 'function') problems.push(`${where}: a write action needs a preview function`);
    if (action.kind === 'read' && action.preview !== undefined) problems.push(`${where}: a read action has no preview`);
    problems.push(...schemaProblems(action.input).map((problem) => `${where}: ${problem}`));
  }
  return problems;
}

// The check the portal sends back with a run, or an error in words: text of printable characters, at most 128.
export function readCheck(value) {
  if (value === undefined || value === null) return { value: null };
  return typeof value === 'string' && CHECK.test(value) ? { value } : { error: `"check" must be the text the preview gave, at most ${LIMITS.check} characters.` };
}

function schemaProblems(schema) {
  if (!isObject(schema) || schema.type !== 'object' || !isObject(schema.properties)) return ['input must be { type: "object", properties: {...} }'];
  const problems = [];
  const names = Object.keys(schema.properties);
  if (names.length > LIMITS.properties) problems.push(`input has more than ${LIMITS.properties} properties`);
  for (const name of names) {
    if (!PROPERTY.test(name)) problems.push(`input property "${name}" must be a plain name`);
    problems.push(...propertyProblems(schema.properties[name], false).map((problem) => `input property "${name}": ${problem}`));
  }
  if (schema.required !== undefined && !(Array.isArray(schema.required) && schema.required.every((name) => names.includes(name)))) problems.push('input.required must list properties it has');
  for (const key of Object.keys(schema)) if (!['type', 'properties', 'required'].includes(key)) problems.push(`input has "${key}", which is not supported`);
  return problems;
}

const ALLOWED = {
  string: ['type', 'description', 'maxLength', 'minLength', 'enum'],
  integer: ['type', 'description', 'minimum', 'maximum'],
  number: ['type', 'description', 'minimum', 'maximum'],
  boolean: ['type', 'description'],
  array: ['type', 'description', 'items', 'maxItems'],
};

function propertyProblems(property, inArray) {
  if (!isObject(property) || !ALLOWED[property.type] || (inArray && property.type !== 'string')) return [inArray ? 'items must be { type: "string", ... }' : 'type must be string, integer, number, boolean or array'];
  const problems = [];
  for (const key of Object.keys(property)) if (!ALLOWED[property.type].includes(key)) problems.push(`"${key}" is not supported for a ${property.type}`);
  if (property.description !== undefined && !isText(property.description, LIMITS.description)) problems.push(`description must be text of at most ${LIMITS.description} characters`);
  if (property.type === 'string') {
    if (!isCount(property.maxLength, LIMITS.text) || property.maxLength < 1) problems.push(`maxLength is needed, from 1 to ${LIMITS.text}`);
    if (property.minLength !== undefined && !(isCount(property.minLength, LIMITS.text) && property.minLength <= property.maxLength)) problems.push('minLength must be a count no more than maxLength');
    if (property.enum !== undefined && !(Array.isArray(property.enum) && property.enum.length > 0 && property.enum.length <= LIMITS.enum && property.enum.every((value) => isText(value, property.maxLength)))) problems.push(`enum must be 1 to ${LIMITS.enum} texts`);
  }
  if (property.type === 'integer' || property.type === 'number') {
    for (const key of ['minimum', 'maximum']) if (property[key] !== undefined && !Number.isFinite(property[key])) problems.push(`${key} must be a number`);
    if (Number.isFinite(property.minimum) && Number.isFinite(property.maximum) && property.minimum > property.maximum) problems.push('minimum is more than maximum');
  }
  if (property.type === 'array') {
    if (!isCount(property.maxItems, LIMITS.items) || property.maxItems < 1) problems.push(`maxItems is needed, from 1 to ${LIMITS.items}`);
    problems.push(...propertyProblems(property.items, true).map((problem) => `items: ${problem}`));
  }
  return problems;
}

// Checks what Joules sent against an action's input, in words Joules can act on. Answers { value } or { error }.
export function readInput(schema, input) {
  const given = input === undefined || input === null ? {} : input;
  if (!isObject(given)) return { error: 'The input must be an object.' };
  const value = {};
  for (const name of Object.keys(given)) if (!Object.hasOwn(schema.properties, name)) return { error: `"${name}" is not something this action takes.` };
  for (const name of schema.required ?? []) if (given[name] === undefined || given[name] === null || given[name] === '') return { error: `"${name}" is needed.` };
  for (const [name, property] of Object.entries(schema.properties)) {
    if (given[name] === undefined || given[name] === null) continue;
    const problem = valueProblem(property, given[name]);
    if (problem) return { error: `"${name}" ${problem}` };
    value[name] = Array.isArray(given[name]) ? [...given[name]] : given[name];
  }
  return { value };
}

function valueProblem(property, value) {
  if (property.type === 'string') {
    if (typeof value !== 'string') return 'must be text.';
    if (value.length > property.maxLength) return `must be at most ${property.maxLength} characters.`;
    if (property.minLength !== undefined && value.length < property.minLength) return `must be at least ${property.minLength} characters.`;
    if (property.enum && !property.enum.includes(value)) return `must be one of: ${property.enum.join(', ')}.`;
    return null;
  }
  if (property.type === 'integer' && !Number.isInteger(value)) return 'must be a whole number.';
  if (property.type === 'number' && !Number.isFinite(value)) return 'must be a number.';
  if (property.type === 'integer' || property.type === 'number') {
    if (property.minimum !== undefined && value < property.minimum) return `must be at least ${property.minimum}.`;
    if (property.maximum !== undefined && value > property.maximum) return `must be at most ${property.maximum}.`;
    return null;
  }
  if (property.type === 'boolean') return typeof value === 'boolean' ? null : 'must be true or false.';
  if (!Array.isArray(value)) return 'must be a list.';
  if (value.length > property.maxItems) return `must have at most ${property.maxItems} entries.`;
  for (const item of value) {
    const problem = valueProblem(property.items, item);
    if (problem) return `entries: each ${problem}`;
  }
  return null;
}

// What a handler gave back, in the one shape Joules reads, or an Error (a bug in the app: the platform logs it and answers 500).
//   read  run      { result }                    any JSON, at most 64 KB
//   write preview  { preview: { summary, fields, check? } }   check from 1.7.0
//   write run      { done: { summary, ref, path } }   path is a page of this app, such as /tickets/42
export function shapeOutcome(kind, mode, outcome) {
  if (kind === 'read') {
    const text = JSON.stringify(outcome ?? null);
    if (text.length > LIMITS.result) throw new Error(`The result is ${text.length} characters, more than ${LIMITS.result}.`);
    return { result: JSON.parse(text) };
  }
  if (!isObject(outcome) || !isText(outcome.summary, LIMITS.summary)) throw new Error(`A ${mode} must answer { summary } of at most ${LIMITS.summary} characters.`);
  if (mode === 'preview') {
    const fields = outcome.fields ?? [];
    if (!Array.isArray(fields) || fields.length > LIMITS.fields || !fields.every((field) => isObject(field) && isText(field.label, LIMITS.label) && typeof field.value === 'string' && field.value.length <= LIMITS.value)) {
      throw new Error(`A preview's fields must be at most ${LIMITS.fields} of { label, value }.`);
    }
    const preview = { summary: outcome.summary, fields: fields.map(({ label, value }) => ({ label, value })) };
    if (outcome.check !== undefined) {
      if (typeof outcome.check !== 'string' || !CHECK.test(outcome.check)) throw new Error(`A preview's check must be printable text of at most ${LIMITS.check} characters, with no spaces.`);
      preview.check = outcome.check;
    }
    return { preview };
  }
  const done = { summary: outcome.summary };
  if (outcome.ref !== undefined) {
    if (!isText(outcome.ref, LIMITS.ref)) throw new Error(`ref must be text of at most ${LIMITS.ref} characters.`);
    done.ref = outcome.ref;
  }
  if (outcome.path !== undefined) {
    if (!isPagePath(outcome.path)) throw new Error('path must be a page of this app, starting with one /.');
    done.path = outcome.path;
  }
  return { done };
}

// A page on this site: one leading slash, not two, no backslash, no control characters, no more than 300 characters.
export function isPagePath(value) {
  return typeof value === 'string' && value.length <= LIMITS.path && value.startsWith('/') && !value.startsWith('//') && !/[\u0000-\u001f\u007f\\]/.test(value);
}
