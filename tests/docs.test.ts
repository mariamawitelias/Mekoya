import { describe, expect, it } from 'vitest';
import { openApiDocument } from '../src/docs/openapi.js';
import { http } from './helpers.js';

interface DocOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  responses?: Record<string, unknown>;
  security?: unknown[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const paths = openApiDocument.paths as Record<string, Partial<Record<(typeof METHODS)[number], DocOperation>>>;

const operations = Object.entries(paths).flatMap(([path, item]) =>
  METHODS.flatMap((method) => {
    const operation = item[method];
    return operation ? [{ method, path, operation }] : [];
  }),
);

describe('OpenAPI document', () => {
  it('describes the whole API', () => {
    expect(openApiDocument.openapi).toBe('3.1.0');
    expect(operations.length).toBeGreaterThanOrEqual(45);
  });

  it('gives every operation a tag, a summary, a description and an error response', () => {
    for (const { method, path, operation } of operations) {
      const label = `${method.toUpperCase()} ${path}`;
      expect(operation.tags?.length, label).toBe(1);
      expect(operation.summary, label).toBeTruthy();
      expect(operation.description, label).toBeTruthy();
      expect(operation.responses?.['500'], label).toBeDefined();
    }
  });

  it('marks every non-public operation as requiring a token', () => {
    const protectedOps = operations.filter(({ operation }) => operation.description?.startsWith('**Requires**'));
    expect(protectedOps.length).toBeGreaterThan(30);
    for (const { method, path, operation } of protectedOps) {
      expect(operation.security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
      expect(operation.responses?.['401'], `${method} ${path}`).toBeDefined();
    }
  });

  it('has no unresolved references', () => {
    const json = JSON.stringify(openApiDocument);
    expect(json).not.toContain('"$ref":"#/$defs'); // schemas must be inlined

    const components = openApiDocument.components as Record<string, Record<string, unknown>>;
    for (const match of json.matchAll(/"\$ref":"#\/components\/([^/"]+)\/([^"]+)"/g)) {
      expect(components[match[1]!]?.[match[2]!], match[0]).toBeDefined();
    }
  });

  it('only documents routes that really exist', async () => {
    for (const { method, path } of operations) {
      const url = `/api/v1${path.replace(/\{[^}]+\}/g, 'x')}`;
      const res = await http()[method](url);

      const message = (res.body as { error?: { message?: string } }).error?.message ?? '';
      expect(message.startsWith('Route '), `${method.toUpperCase()} ${path} is documented but not implemented`).toBe(false);
    }
  });

  it('serves the spec and the interactive UI', async () => {
    const spec = await http().get('/api/docs.json');
    expect(spec.status).toBe(200);
    expect(spec.body.info.title).toBe('Mekoya API');

    const ui = await http().get('/api/docs/');
    expect(ui.status).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    expect(ui.headers['content-security-policy']).toBeUndefined();
  });
});