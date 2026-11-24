import { ApplicationError } from '../errors/application-error.js';

/** An operator-facing seed failure. Use a fixed action message without private data. */
export class SeedError extends ApplicationError {
  constructor(code: string, action: string) {
    super(code, 400, action);
  }
}
