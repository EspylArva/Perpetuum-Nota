import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('info', () => {
    it('returns build/version metadata with sane fallbacks', () => {
      const info = appController.info();
      expect(info.name).toBe('Perpetuum Nota');
      expect(typeof info.version).toBe('string');
      expect(info.version.length).toBeGreaterThan(0);
      expect(info).toHaveProperty('commit');
      expect(info).toHaveProperty('buildTime');
      expect(info).toHaveProperty('author');
      expect(info).toHaveProperty('environment');
    });

    it('reflects baked-in env metadata when present', () => {
      const prev = process.env.APP_VERSION;
      process.env.APP_VERSION = '9.9.9';
      try {
        expect(appController.info().version).toBe('9.9.9');
      } finally {
        if (prev === undefined) delete process.env.APP_VERSION;
        else process.env.APP_VERSION = prev;
      }
    });
  });
});
