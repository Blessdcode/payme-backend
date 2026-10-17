import { z } from 'zod';

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    EMAIL_PROVIDER: z.enum(['disabled', 'smtp']).default('disabled'),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform(value => value === 'true'),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    EMAIL_FROM: z.email().optional(),
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'Must contain at least 32 characters'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, 'Must contain at least 32 characters'),
    DATABASE_URL: z.url().refine(value => /^postgres(ql)?:\/\//.test(value), {
      message: 'Must be a PostgreSQL connection URL',
    }),
    FRONTEND_URL: z.url().refine(value => {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
    }, 'Must be an HTTP(S) origin without a path or trailing slash'),
  })
  .superRefine((value, ctx) => {
    if (value.EMAIL_PROVIDER === 'smtp') {
      for (const key of [
        'SMTP_HOST',
        'SMTP_USER',
        'SMTP_PASSWORD',
        'EMAIL_FROM',
      ] as const) {
        if (!value[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Required when EMAIL_PROVIDER=smtp',
          });
      }
      if (value.SMTP_PORT === 465 && !value.SMTP_SECURE) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_SECURE'],
          message: 'Must be true for SMTP port 465',
        });
      }
      if (value.SMTP_PORT === 587 && value.SMTP_SECURE) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_SECURE'],
          message: 'Must be false for SMTP port 587 (STARTTLS is required)',
        });
      }
    }
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'Must differ from JWT_ACCESS_SECRET',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      !value.FRONTEND_URL.startsWith('https://')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['FRONTEND_URL'],
        message: 'HTTPS is required in production',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    // Report keys and validation rules, never environment values or secrets.
    const issues = result.error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}
