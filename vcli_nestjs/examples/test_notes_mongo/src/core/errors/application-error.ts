export class ApplicationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number = 400,
    message: string = code,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
