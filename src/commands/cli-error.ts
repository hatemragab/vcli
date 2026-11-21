export class CliError extends Error {
  constructor(
    readonly code: string,
    readonly action: string,
  ) {
    super(code);
    this.name = 'CliError';
  }
}
