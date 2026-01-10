
import { z } from 'zod';
import { insertDesignSchema, designs } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  designs: {
    create: {
      method: 'POST' as const,
      path: '/api/designs',
      input: insertDesignSchema, // Expects { originalImageUrl: string, prompt?: string }
      responses: {
        201: z.custom<typeof designs.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/designs/:id',
      responses: {
        200: z.custom<typeof designs.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/designs',
      responses: {
        200: z.array(z.custom<typeof designs.$inferSelect>()),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
