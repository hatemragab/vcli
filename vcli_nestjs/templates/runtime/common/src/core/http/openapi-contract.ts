import type {
  HeadersObject,
  OpenAPIObject,
  OperationObject,
  ResponseObject,
  SchemaObject,
} from '@nestjs/swagger';

const methods = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
] as const;
const mutation = new Set<string>(['post', 'put', 'patch', 'delete']);
const requestId: HeadersObject = {
  'X-Request-Id': {
    description: 'Request correlation ID. Include it when reporting a failure.',
    schema: { type: 'string', format: 'uuid' },
  },
};
const operationId: HeadersObject = {
  'X-Operation-Id': {
    description: 'Mutation correlation ID.',
    schema: { type: 'string', format: 'uuid' },
  },
};
const failure: ResponseObject = {
  description: 'Request rejected or unavailable.',
  headers: {
    ...requestId,
    'Retry-After': {
      description:
        'Retry delay in seconds or HTTP date, when the server sends one.',
      schema: { type: 'string' },
    },
  },
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/VcliHttpError' },
    },
  },
};
const errorSchema: SchemaObject = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code'],
      properties: {
        code: { type: 'string', pattern: '^[A-Z_][A-Z0-9_]{0,95}$' },
        fields: {
          description:
            'Field names from server-side input validation, when supplied.',
          type: 'array',
          maxItems: 8,
          items: { type: 'string' },
        },
      },
    },
  },
};

/** Preserve the published controller/method naming convention across exports. */
export function openApiOperationId(
  controller: string,
  method: string,
  version?: string,
): string {
  return [controller, method, version].filter(Boolean).join('_');
}

function success(
  operation: OperationObject | undefined,
  code: string,
  description: string,
  properties: Record<string, SchemaObject>,
): void {
  if (!operation) return;
  const response = operation.responses[code];
  if (response && ('$ref' in response || response.content)) return;
  operation.responses[code] = {
    ...response,
    description: response?.description || description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: Object.keys(properties),
          properties,
        },
      },
    },
  };
}

export function applyOpenApiContract(
  document: OpenAPIObject,
  profile: 'basic' | 'full' | 'firebase',
): void {
  const components = (document.components ??= {});
  (components.schemas ??= {}).VcliHttpError = errorSchema;
  (components.responses ??= {}).VcliHttpError = failure;
  const paths = document.paths;
  const expiresAt: SchemaObject = {
    type: 'integer',
    description: 'Unix time in milliseconds.',
  };
  const uuid: SchemaObject = { type: 'string', format: 'uuid' };
  const installation = {
    sessionId: uuid,
    installationId: uuid,
    installationGeneration: {
      type: 'integer',
      minimum: 1,
    } satisfies SchemaObject,
  };
  success(paths['/health/live']?.get, '200', 'Process is alive.', {
    status: { type: 'string', enum: ['alive'] },
  });
  if (profile === 'firebase') {
    success(
      paths['/api/identity/firebase/bootstrap']?.post,
      '200',
      'App session enrolled.',
      {
        ...installation,
        expiresAt,
      },
    );
  } else {
    success(
      paths['/api/identity/local/register']?.post,
      '202',
      'Registration accepted.',
      {
        status: { type: 'string', enum: ['accepted'] },
      },
    );
    const credentials = {
      accessToken: { type: 'string' } satisfies SchemaObject,
      tokenType: { type: 'string', enum: ['Bearer'] } satisfies SchemaObject,
      expiresAt,
      ...(profile === 'full'
        ? {
            refreshToken: { type: 'string' } satisfies SchemaObject,
            ...installation,
            sessionExpiresAt: expiresAt,
          }
        : {}),
    };
    success(
      paths['/api/identity/local/login']?.post,
      '200',
      'Signed in.',
      credentials,
    );
    success(
      paths['/api/identity/local/refresh']?.post,
      '200',
      'Session credentials refreshed.',
      credentials,
    );
  }
  for (const item of Object.values(paths)) {
    for (const method of methods) {
      const operation = item?.[method];
      if (!operation) continue;
      operation.responses.default ??= {
        $ref: '#/components/responses/VcliHttpError',
      };
      for (const [code, response] of Object.entries(operation.responses)) {
        if (!response || '$ref' in response) continue;
        const failed = /^(?:default|[45](?:\d\d|XX))$/.test(code);
        response.headers = {
          ...requestId,
          ...(mutation.has(method) ? operationId : {}),
          ...(failed ? failure.headers : {}),
          ...response.headers,
        };
        if (failed) response.content ??= failure.content;
      }
    }
  }
}
