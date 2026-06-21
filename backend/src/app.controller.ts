import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  // Build/version metadata for the Settings "App info" panel. Public so it can
  // also surface on pre-login surfaces (e.g. a footer) without a session.
  @Public()
  @Get('info')
  info() {
    return this.appService.getInfo();
  }
}
