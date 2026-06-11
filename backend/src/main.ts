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
