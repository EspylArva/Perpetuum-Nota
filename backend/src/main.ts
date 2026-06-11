import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  ExpressAdapter,
  NestExpressApplication,
} from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { CsrfService } from './auth/csrf.service';

// Mutating requests to these paths run before any CSRF token can exist
// (login) or are the token issuer itself — exempt them.
const CSRF_EXEMPT = new Set(['/api/auth/login', '/api/auth/csrf']);

async function bootstrap() {
  // Fail fast on a missing signing secret: without it the app would boot fine
  // and then 500 on the first login (and CSRF would fall back to a known
  // literal). A misconfigured prod deployment should not come up at all.
  if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production');
    }
    console.warn('JWT_SECRET is not set — using insecure dev-only secrets');
  }

  // Pass the Express adapter explicitly. In this npm-workspaces layout
  // @nestjs/core hoists to the root while platform-express resolves from the
  // backend workspace, so NestFactory's auto HTTP-driver detection can miss it.
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(),
  );
  app.set('trust proxy', 1); // trust nginx for X-Forwarded-Proto (req.secure)
  app.setGlobalPrefix('api');

  // Security headers. CSP disabled here (the SPA/nginx layer owns it; enabling a
  // strict CSP without tuning would break the Angular bundle).
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );

  app.use(cookieParser());
  // Headroom for large note documents (ProseMirror JSON).
  app.useBodyParser('json', { limit: '5mb' });

  // CSRF (double-submit cookie). The library ignores safe methods
  // (GET/HEAD/OPTIONS); we additionally exempt login + the token issuer.
  const csrf = app.get(CsrfService);
  const csrfProtection = csrf.protection();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (CSRF_EXEMPT.has(req.path)) return next();
    return csrfProtection(req, res, next);
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
