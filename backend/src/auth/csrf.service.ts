import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { createCsrf } from './csrf';

/**
 * Wraps csrf-csrf so the controller can issue tokens and main.ts can mount the
 * protection middleware. Mutating requests must carry a valid X-CSRF-Token that
 * matches the issued csrf cookie (double-submit).
 */
@Injectable()
export class CsrfService {
  private readonly csrf: ReturnType<typeof createCsrf>;

  constructor(config: ConfigService) {
    const secret =
      config.get<string>('CSRF_SECRET') ??
      config.get<string>('JWT_SECRET') ??
      'dev-csrf-secret-change-me';
    this.csrf = createCsrf(secret);
  }

  /** Issues a token (and sets the csrf cookie on the response). */
  generateToken(req: Request, res: Response): string {
    return this.csrf.generateCsrfToken(req, res);
  }

  /** Express middleware enforcing CSRF on mutating methods. */
  protection(): (req: Request, res: Response, next: NextFunction) => void {
    return this.csrf.doubleCsrfProtection;
  }
}
