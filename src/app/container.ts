import { createGotenbergClient, type GotenbergClient } from '../infrastructure/gotenberg/client.js';
import { createLogger, type AppLogger } from '../infrastructure/logging/logger.js';
import { createMetrics, type Metrics } from '../infrastructure/metrics/metrics.js';
import { ConverterResolver } from '../modules/pdf/converters/converter-resolver.js';
import { ChromiumConverter } from '../modules/pdf/converters/chromium.converter.js';
import { GotenbergConverter } from '../modules/pdf/converters/gotenberg.converter.js';
import { ImageConverter } from '../modules/pdf/converters/image.converter.js';
import { PdfService } from '../modules/pdf/pdf.service.js';
import { getConfig, type AppConfig } from './config.js';

export interface AppContainer {
  config: AppConfig;
  logger: AppLogger;
  gotenberg: GotenbergClient;
  resolver: ConverterResolver;
  pdfService: PdfService;
  metrics: Metrics;
}

export function createContainer(overrides: {
  config?: AppConfig;
  logger?: AppLogger;
  gotenberg?: GotenbergClient;
  metrics?: Metrics;
} = {}): AppContainer {
  const config = overrides.config ?? getConfig();
  const logger = overrides.logger ?? createLogger();
  const gotenberg = overrides.gotenberg ?? createGotenbergClient();
  const resolver = new ConverterResolver([
    new ImageConverter(),
    new ChromiumConverter(gotenberg),
    new GotenbergConverter(gotenberg),
  ]);
  const metrics = overrides.metrics ?? createMetrics();
  const pdfService = new PdfService(resolver, config, logger, metrics);

  return {
    config,
    logger,
    gotenberg,
    resolver,
    pdfService,
    metrics,
  };
}
