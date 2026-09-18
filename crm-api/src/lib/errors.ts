export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Recurso') => new HttpError(404, `${what} não encontrado`);
export const forbidden = () => new HttpError(403, 'Acesso negado');
export const badRequest = (msg: string) => new HttpError(400, msg);
