import { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Bungkus route handler async supaya reject-nya otomatis diteruskan ke errorHandler (tanpa try/catch berulang di tiap route). */
export function asyncRoute<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ success: false, message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : "Terjadi kesalahan pada server.";
  console.error(err);
  res.status(500).json({ success: false, message: `Error : ${message}` });
}
