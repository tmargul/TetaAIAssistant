import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { resolveWebDistPath } from './config/web-dist';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const webDistPath = resolveWebDistPath();
  const defaultOrigin = webDistPath ? 'http://localhost:3000' : 'http://localhost:5173';
  const corsOrigin = process.env.CORS_ORIGIN ?? defaultOrigin;

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  if (webDistPath) {
    app.useStaticAssets(webDistPath, { index: ['index.html'] });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      if (req.path.includes('.')) {
        next();
        return;
      }
      res.sendFile(join(webDistPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api`);
  if (webDistPath) {
    console.log(`App UI: http://localhost:${port}/`);
  }
}
bootstrap();
