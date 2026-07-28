import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { validateEnv } from './common/validate-env';

async function bootstrap() {
  // Fail closed on insecure production config (e.g. missing JWT_SECRET) before
  // we wire up modules or accept any traffic.
  validateEnv();

  const app = await NestFactory.create(AppModule, {
    // Preserve the raw request body so Stripe webhook signature verification
    // (PaymentsController.handleWebhook → stripe.webhooks.constructEvent) can
    // hash the exact bytes. Without this, req.rawBody is undefined and every
    // webhook fails signature checks.
    rawBody: true,
    logger: process.env.NODE_ENV === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  app.use(helmet());
  app.enableShutdownHooks();

  // Rate limiting keys on the client IP. Behind a proxy/load balancer the real
  // client IP arrives in X-Forwarded-For, so tell Express how many proxy hops
  // to trust — `req.ip` then resolves to the actual client and per-IP throttles
  // (auth brute-force limits, global 120/min) work per-user instead of lumping
  // everyone under the proxy's IP. Trusting MORE hops than exist would let
  // clients spoof XFF to dodge throttling, so default to 1 in prod (single LB)
  // and 0 in dev; override TRUST_PROXY_HOPS to match your topology.
  const trustProxyHops = Number(
    process.env.TRUST_PROXY_HOPS ?? (process.env.NODE_ENV === 'production' ? 1 : 0),
  );
  if (trustProxyHops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
  }

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
    exposedHeaders: ['x-tenant-slug'],
  });

  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }));

  app.setGlobalPrefix('api', { exclude: ['/', 'health', 'version'] });

  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Speed Enterprises API')
      .setDescription('Multi-tenant trade-business operations API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'x-tenant-slug', in: 'header' }, 'tenant')
      .build();
    const doc = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, doc);
  }

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Speed Enterprises API listening on http://localhost:${port}`);
  if (process.env.NODE_ENV !== 'production') {
    new Logger('Bootstrap').log(`Swagger docs at http://localhost:${port}/docs`);
  }
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal: API failed to start', err);
  process.exit(1);
});
