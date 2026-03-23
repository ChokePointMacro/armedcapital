/**
 * Lightweight request body validation.
 * Use until Zod can be added as a dependency.
 * Returns { data, error } — if error is set, return it as a 400 response.
 */

import { NextResponse } from 'next/server';

interface FieldRule {
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  minLength?: number;
  maxLength?: number;
  oneOf?: readonly string[];
  min?: number;
  max?: number;
}

type Schema = Record<string, FieldRule>;

interface ValidationResult<T> {
  data: T;
  error: null;
}

interface ValidationError {
  data: null;
  error: NextResponse;
}

export function validate<T extends Record<string, unknown>>(
  body: unknown,
  schema: Schema
): ValidationResult<T> | ValidationError {
  if (!body || typeof body !== 'object') {
    return {
      data: null,
      error: NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 }),
    };
  }

  const data = body as Record<string, unknown>;
  const errors: string[] = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field} is required`);
      continue;
    }

    if (value === undefined || value === null) continue;

    if (rules.type && typeof value !== rules.type && !(rules.type === 'array' && Array.isArray(value))) {
      errors.push(`${field} must be a ${rules.type}`);
      continue;
    }

    if (rules.type === 'string' || typeof value === 'string') {
      const str = value as string;
      if (rules.minLength && str.length < rules.minLength) {
        errors.push(`${field} must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength && str.length > rules.maxLength) {
        errors.push(`${field} must be at most ${rules.maxLength} characters`);
      }
      if (rules.oneOf && !rules.oneOf.includes(str)) {
        errors.push(`${field} must be one of: ${rules.oneOf.join(', ')}`);
      }
    }

    if (rules.type === 'number' || typeof value === 'number') {
      const num = value as number;
      if (rules.min !== undefined && num < rules.min) {
        errors.push(`${field} must be at least ${rules.min}`);
      }
      if (rules.max !== undefined && num > rules.max) {
        errors.push(`${field} must be at most ${rules.max}`);
      }
    }
  }

  if (errors.length > 0) {
    return {
      data: null,
      error: NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 }),
    };
  }

  return { data: data as T, error: null };
}

// ── Preset schemas ───────────────────────────────────────────────────────────

export const REPORT_SCHEMA = {
  type: { required: true, type: 'string' as const, oneOf: ['global', 'crypto', 'equities', 'nasdaq', 'conspiracies', 'custom', 'forecast', 'china', 'speculation'] },
  customTopic: { type: 'string' as const, maxLength: 500 },
};

export const SCHEDULED_POST_SCHEMA = {
  content: { required: true, type: 'string' as const, minLength: 1, maxLength: 280 },
  scheduledAt: { required: true, type: 'string' as const },
};
