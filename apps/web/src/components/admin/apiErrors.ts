/** Turn an API failure into the list of field/message errors the admin UI shows. */
import { ApiError, errorMessage } from '@/api/client';

export function apiErrorList(error: unknown): string[] {
  if (error instanceof ApiError) {
    const payload = error.payload;
    if (payload && typeof payload === 'object' && Array.isArray(payload.errors) && payload.errors.length > 0) {
      return payload.errors;
    }
    return [error.message];
  }
  return [errorMessage(error)];
}

/** Conflict payload (`409 {conflict, records}`) from a course delete. */
export function conflictRecordCount(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const payload = error.payload;
  if (!payload || typeof payload !== 'object') return null;
  const records = (payload as { records?: unknown }).records;
  return typeof records === 'number' && Number.isFinite(records) ? records : null;
}