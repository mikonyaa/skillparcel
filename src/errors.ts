export class ParcelError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ParcelError";
  }
}

export class BudgetError extends ParcelError {
  constructor(
    code: string,
    resource: string,
    public bytes: number,
    public limit: number,
  ) {
    super(code, `${resource} requires ${bytes} bytes; limit is ${limit} bytes`);
    this.name = "BudgetError";
  }
}
