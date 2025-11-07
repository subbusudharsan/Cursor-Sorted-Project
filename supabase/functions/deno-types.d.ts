declare namespace Deno {
  export const env: {
    get(key: string): string | undefined;
  };

  export function serve(handler: (req: Request) => Response | Promise<Response>): void;
}

declare const Request: {
  prototype: Request;
  new(input: RequestInfo | URL, init?: RequestInit): Request;
};

declare const Response: {
  prototype: Response;
  new(body?: BodyInit | null, init?: ResponseInit): Response;
  json(data: any, init?: ResponseInit): Response;
};
