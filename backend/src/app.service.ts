import { Injectable } from '@nestjs/common';
import type { AppInfoDto } from '@perpetuum-nota/shared';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  /**
   * Build/version metadata for the "App info" panel. Values are baked into the
   * api image at build time as env vars (see scripts/deploy-to-zot.sh →
   * backend/Dockerfile). Running unbuilt (e.g. `npm run dev:api`) falls back to
   * the npm package version and "dev"/"unknown" markers.
   */
  getInfo(): AppInfoDto {
    const commit = process.env.GIT_COMMIT || 'unknown';
    return {
      name: 'Perpetuum Nota',
      version:
        process.env.APP_VERSION || process.env.npm_package_version || 'dev',
      commit,
      commitFull: process.env.GIT_COMMIT_FULL || commit,
      branch: process.env.GIT_BRANCH || 'unknown',
      buildTime: process.env.BUILD_TIME || 'unknown',
      author: process.env.APP_AUTHOR || 'unknown',
      environment: process.env.NODE_ENV || 'development',
    };
  }
}
