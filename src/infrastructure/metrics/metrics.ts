import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'pdf_service_' });

  const conversionTotal = new Counter({
    name: 'conversion_total',
    help: 'Total conversion attempts',
    labelNames: ['engine', 'status'] as const,
    registers: [registry],
  });

  const conversionDuration = new Histogram({
    name: 'conversion_duration_seconds',
    help: 'Conversion duration in seconds',
    labelNames: ['engine'] as const,
    buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120],
    registers: [registry],
  });

  const conversionInputBytes = new Counter({
    name: 'conversion_input_bytes',
    help: 'Ingested conversion bytes',
    registers: [registry],
  });

  const conversionOutputBytes = new Counter({
    name: 'conversion_output_bytes',
    help: 'Produced conversion bytes',
    registers: [registry],
  });

  const activeJobs = new Gauge({
    name: 'conversion_active_jobs',
    help: 'In-flight conversions',
    registers: [registry],
  });

  return {
    registry,
    conversionTotal,
    conversionDuration,
    conversionInputBytes,
    conversionOutputBytes,
    activeJobs,
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
