import { createLogger, type AppLogger } from '../infrastructure/logging/logger.js';
import { createMetrics, type Metrics } from '../infrastructure/metrics/metrics.js';
import { createNativeEngines, type NativeEngines } from '../infrastructure/engines/native.js';
import { ConverterResolver } from '../modules/pdf/converters/converter-resolver.js';
import { ChromiumConverter } from '../modules/pdf/converters/chromium.converter.js';
import { ImageConverter } from '../modules/pdf/converters/image.converter.js';
import { LibreOfficeConverter } from '../modules/pdf/converters/libreoffice.converter.js';
import { PdfService } from '../modules/pdf/pdf.service.js';
import { getConfig, type AppConfig } from './config.js';

export interface AppContainer {
  config: AppConfig;
  logger: AppLogger;
  engines: NativeEngines;
  resolver: ConverterResolver;
  pdfService: PdfService;
  metrics: Metrics;
}

export function createContainer(
  overrides: {
    config?: AppConfig;
    logger?: AppLogger;
    engines?: NativeEngines;
    metrics?: Metrics;
  } = {},
): AppContainer {
  const config = overrides.config ?? getConfig();
  const logger = overrides.logger ?? createLogger();
  const engines =
    overrides.engines ??
    createNativeEngines({
      libreofficeBin: config.LIBREOFFICE_BIN,
      chromiumBin: config.CHROMIUM_BIN,
    });
  const resolver = new ConverterResolver([
    new ImageConverter(),
    new ChromiumConverter(engines),
    new LibreOfficeConverter(engines),
  ]);
  const metrics = overrides.metrics ?? createMetrics();
  const pdfService = new PdfService(resolver, config, logger, metrics);

  return {
    config,
    logger,
    engines,
    resolver,
    pdfService,
    metrics,
  };
}
