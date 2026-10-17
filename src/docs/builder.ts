import { z } from 'zod';

export type Json = Record<string, unknown>;
export type Paths = Record<string, Record<string, Json>>;
export type Access = 'public' | 'authenticated' | `${string}:${string}`;
export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
export function toSchema(schema: z.ZodType): Json {
  const json = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
    override: (ctx) => {
      if (ctx.zodSchema._zod.def.type === 'date') {
        ctx.jsonSchema.type = 'string';
        ctx.jsonSchema.format = 'date-time';
      }
    },
  }) as Json;
  delete json.$schema;
  return json;
}

export function toParameters(schema: z.ZodType, location: 'query' | 'path'): Json[] {
  const json = toSchema(schema) as { properties?: Record<string, Json>; required?: string[] };
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, property]) => ({
    name,
    in: location,
    required: location === 'path' || required.has(name),
    schema: property,
  }));
}

const ERROR_RESPONSES: Record<number, string> = {
  400: 'ValidationError',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'NotFound',
  409: 'Conflict',
  413: 'PayloadTooLarge',
  415: 'UnsupportedMediaType',
  429: 'TooManyRequests',
};

export const envelope = (data: unknown, meta?: unknown): Json => ({
  success: true,
  data,
  ...(meta === undefined ? {} : { meta }),
});

export interface OperationInput {
  tag: string;
  summary: string;
  description?: string;
  access: Access;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  bodyExample?: unknown;
  requestBody?: Json;
  localized?: boolean;
  headers?: Json[];
  success: {
    status?: number;
    description: string;
    example?: unknown;
    meta?: unknown;
    content?: Json;
    setsCookie?: boolean;
  };
  errors?: number[];
}

export function operation(input: OperationInput): Json {
  const isPermission = input.access.includes(':');
  const accessLine =
    input.access === 'public'
      ? '**Public.** No token needed.'
      : isPermission
        ? `**Requires** a valid access token with the \`${input.access}\` permission.`
        : '**Requires** a valid access token.';

  const parameters = [
    ...(input.params ? toParameters(input.params, 'path') : []),
    ...(input.query ? toParameters(input.query, 'query') : []),
    ...(input.localized ? [{ $ref: '#/components/parameters/AcceptLanguage' }] : []),
    ...(input.headers ?? []),
  ];

  const errorStatuses = new Set<number>(input.errors ?? []);
  if (input.params || input.query || input.body || input.requestBody) errorStatuses.add(400);
  if (input.access !== 'public') errorStatuses.add(401);
  if (isPermission) errorStatuses.add(403);

  const successContent =
    input.success.content ??
    ({
      'application/json': {
        schema: { $ref: '#/components/schemas/SuccessResponse' },
        ...(input.success.example === undefined ? {} : { example: envelope(input.success.example, input.success.meta) }),
      },
    } satisfies Json);

  const responses: Json = {
    [String(input.success.status ?? 200)]: {
      description: input.success.description,
      ...(input.success.setsCookie
        ? { headers: { 'Set-Cookie': { description: 'The refresh token, as an httpOnly SameSite=Strict cookie', schema: { type: 'string' } } } }
        : {}),
      content: successContent,
    },
  };
  for (const status of [...errorStatuses].sort((a, b) => a - b)) {
    const name = ERROR_RESPONSES[status];
    if (!name) throw new Error(`No shared error response is defined for status ${status}`);
    responses[String(status)] = { $ref: `#/components/responses/${name}` };
  }
  responses['500'] = { $ref: '#/components/responses/ServerError' };

  const requestBody =
    input.requestBody ??
    (input.body
      ? {
          required: true,
          content: {
            'application/json': {
              schema: toSchema(input.body),
              ...(input.bodyExample === undefined ? {} : { example: input.bodyExample }),
            },
          },
        }
      : undefined);

  return {
    tags: [input.tag],
    summary: input.summary,
    description: input.description ? `${accessLine}\n\n${input.description}` : accessLine,
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses,
    security: input.access === 'public' ? [] : [{ bearerAuth: [] }],
  };
}

export function addPath(paths: Paths, method: Method, path: string, op: Json): void {
  (paths[path] ??= {})[method] = op;
}