import type { ExampleVariant } from '../types.js';

function maskValue(raw: string): string {
  let next = raw;
  next = next.replace(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, 'masked@example.com');
  next = next.replace(/01[0-9]-?\d{3,4}-?\d{4}/g, '010-****-****');
  next = next.replace(/\b\d{10,16}\b/g, (value) => `${value.slice(0, 2)}********${value.slice(-2)}`);
  next = next.replace(/Bearer\s+[A-Za-z0-9._-]{12,}/g, 'Bearer ***MASKED***');
  next = next.replace(/("(?:accessToken|refreshToken|token|authorization)"\s*:\s*")([^"]+)(")/gi, '$1***MASKED***$3');
  return next;
}

export function maskSensitiveText(raw: string): string {
  return maskValue(raw);
}

export function maskVariants(variants: ExampleVariant[]): ExampleVariant[] {
  return variants.map((variant) => ({
    ...variant,
    raw: maskValue(variant.raw),
  }));
}
