#!/usr/bin/env node
import { bootProcess, ensureRuntime, parseBootArg } from './ensure-lib/runtime.mjs';

const boot = parseBootArg(process.argv);

try {
  await ensureRuntime({ boot, env: process.env });
  await bootProcess(boot);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ensure] ${message}`);
  process.exit(1);
}
