/** Normalise record/import failures into the list of messages shown in the UI. */
import { ApiError, errorMessage } from '@/api/client';

export function recordErrorList(error: unknown): string[] {
  if (error instanceof ApiError) {
    const payload = error.payload;
    if (payload && typeof payload === 'object' && Array.isArray(payload.errors) && payload.errors.length > 0) {
      return payload.errors;
    }
    return [error.message];
  }
  return [errorMessage(error)];
}