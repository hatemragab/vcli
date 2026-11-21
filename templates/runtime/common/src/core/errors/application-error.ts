export class ApplicationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number = 400,
    message: string = code,
    readonly fields?: readonly string[],
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
