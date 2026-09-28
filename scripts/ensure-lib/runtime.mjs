import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeUpArgs, decideInfra } from './plan.mjs';
import {
  COMPOSE_PROJECT,
  dockerDaemonUp,
  findFreePort,
  gotenbergTarget,
  isDestructiveInfraCommand,
  isOurGotenberg,
  isOurPostgres,
  isOurPublishedService,
  isOurRedis,
  isWsl,
  pickPort,
  postgresTarget,
  probeTcp,
  readProcVersion,
  redisTarget,
  toWslPath,
  wslInstallable,
  wslUbuntuAvailable,
} from './probes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LISTEN_HOST = '127.0.0.1';

export function parseBootArg(argv) {
  const flag = argv.find((arg) => arg.startsWith('--boot='));
  if (flag) {
    return flag.slice('--boot='.length);
  }
  const index = argv.indexOf('--boot');
  if (index >= 0 && argv[index + 1]) {
    return argv[index + 1];
  }
  return 'none';
}

export function loadDotEnv(filePath, env) {
  if (!existsSync(filePath)) {
    return;
  }
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
}

export function upsertEnvFile(filePath, updates) {
  let text = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  if (text && !text.endsWith('\n')) {
    text += '\n';
  }
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) {
      text = text.replace(re, line);
    } else {
      text += `${line}\n`;
    }
  }
  writeFileSync(filePath, text);
  return text;
}

function log(message) {
  console.log(`[ensure] ${message}`);
}

function run(command, args, options = {}) {
  if (isDestructiveInfraCommand(args)) {
    throw new Error(`Refusing to run destructive infra command: ${command} ${args.join(' ')}`);
  }
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status ?? 'unknown'}`);
  }
  return result;
}

function yarnCmd() {
  return process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
}

async function waitFor(label, probe, timeoutMs = 60_000, intervalMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`${label} did not become ready in ${timeoutMs / 1000}s`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function choosePort(host, preferred, ours) {
  const busy = await probeTcp(host, preferred);
  if (!busy) {
    return pickPort(preferred, { busy: false, ours: false, nextFree: preferred });
  }
  if (ours) {
    return pickPort(preferred, { busy: true, ours: true, nextFree: preferred });
  }
  const nextFree = await findFreePort(host, preferred + 1);
  return pickPort(preferred, { busy: true, ours: false, nextFree });
}

export async function resolveServiceUrls(env, exec = spawnSync) {
  const databaseUrl = env.DATABASE_URL ?? `postgresql://pdf:pdf@${LISTEN_HOST}:5432/pdf_service`;
  const redisUrl = env.REDIS_URL ?? `redis://${LISTEN_HOST}:6379`;
  const gotenbergUrl = env.GOTENBERG_URL ?? `http://${LISTEN_HOST}:3000`;
  const preferredApi = Number(env.PORT ?? 3050);

  const pg = postgresTarget(databaseUrl);
  const redis = redisTarget(redisUrl);
  const gotenberg = gotenbergTarget(gotenbergUrl);

  const pgOurs =
    (await probeTcp(pg.host, pg.port)) &&
    (isOurPostgres(databaseUrl, exec) || isOurPublishedService(exec, 'postgres', pg.port, 5432));
  const redisOurs =
    (await probeTcp(redis.host, redis.port)) &&
    (isOurRedis(redisUrl, env) || isOurPublishedService(exec, 'redis', redis.port, 6379));
  const gotenbergOurs =
    (await isOurGotenberg(gotenberg.origin)) ||
    isOurPublishedService(exec, 'gotenberg', gotenberg.port, 3000);

  const pgPick = await choosePort(LISTEN_HOST, pg.port, pgOurs);
  const redisPick = await choosePort(LISTEN_HOST, redis.port, redisOurs);
  const gotenbergPick = await choosePort(LISTEN_HOST, gotenberg.port, gotenbergOurs);

  const apiBusy = await probeTcp(LISTEN_HOST, preferredApi);
  const apiPort = apiBusy ? await findFreePort(LISTEN_HOST, preferredApi + 1) : preferredApi;

  const nextDatabaseUrl =
    pgPick.reason === 'ours'
      ? databaseUrl
      : `postgresql://pdf:pdf@${LISTEN_HOST}:${pgPick.port}/pdf_service`;
  const nextRedisUrl =
    redisPick.reason === 'ours' ? redisUrl : `redis://${LISTEN_HOST}:${redisPick.port}`;
  const nextGotenbergUrl =
    gotenbergPick.reason === 'ours' ? gotenbergUrl : `http://${LISTEN_HOST}:${gotenbergPick.port}`;

  const defaultPgBusy = await probeTcp(LISTEN_HOST, 5432);
  const defaultRedisBusy = await probeTcp(LISTEN_HOST, 6379);
  const defaultPgOurs =
    isOurPostgres(`postgresql://pdf:pdf@${LISTEN_HOST}:5432/pdf_service`, exec) ||
    isOurPublishedService(exec, 'postgres', 5432, 5432);
  const defaultRedisOurs =
    isOurRedis(`redis://${LISTEN_HOST}:6379`, env) || isOurPublishedService(exec, 'redis', 6379, 6379);

  return {
    databaseUrl: nextDatabaseUrl,
    redisUrl: nextRedisUrl,
    gotenbergUrl: nextGotenbergUrl,
    port: String(apiPort),
    publicUrl: `http://${LISTEN_HOST}:${apiPort}`,
    PDF_POSTGRES_PORT: String(pgPick.port),
    PDF_REDIS_PORT: String(redisPick.port),
    PDF_GOTENBERG_PORT: String(gotenbergPick.port),
    hostPostgresBusyForeign: defaultPgBusy && !defaultPgOurs,
    hostRedisBusyForeign: defaultRedisBusy && !defaultRedisOurs,
    pgReason: pgPick.reason,
    redisReason: redisPick.reason,
    gotenbergReason: gotenbergPick.reason,
  };
}

export async function collectFacts(env, exec = spawnSync) {
  const platform = process.platform;
  const inWsl = isWsl(env, platform === 'linux' ? readProcVersion() : '');
  loadDotEnv(join(ROOT, '.env'), env);

  const databaseUrl = env.DATABASE_URL ?? `postgresql://pdf:pdf@${LISTEN_HOST}:5432/pdf_service`;
  const redisUrl = env.REDIS_URL ?? `redis://${LISTEN_HOST}:6379`;
  const gotenbergUrl = env.GOTENBERG_URL ?? `http://${LISTEN_HOST}:3000`;
  const pg = postgresTarget(databaseUrl);
  const redis = redisTarget(redisUrl);
  const gotenberg = gotenbergTarget(gotenbergUrl);
  const bin = env.GOTENBERG_BIN?.trim();

  const pgTcp = await probeTcp(pg.host, pg.port);
  const redisTcp = await probeTcp(redis.host, redis.port);
  const postgresUp =
    pgTcp && (isOurPostgres(databaseUrl, exec) || isOurPublishedService(exec, 'postgres', pg.port, 5432));
  const redisUp =
    redisTcp && (isOurRedis(redisUrl, env) || isOurPublishedService(exec, 'redis', redis.port, 6379));
  const gotenbergUp =
    (await isOurGotenberg(gotenberg.origin)) || isOurPublishedService(exec, 'gotenberg', gotenberg.port, 3000);

  const defaultPgBusy = await probeTcp(LISTEN_HOST, 5432);
  const defaultRedisBusy = await probeTcp(LISTEN_HOST, 6379);

  return {
    platform,
    inWsl,
    dockerUp: dockerDaemonUp(exec),
    postgresUp,
    redisUp,
    gotenbergUp,
    gotenbergBin: Boolean(bin && existsSync(bin)),
    wslUbuntu: platform === 'win32' ? wslUbuntuAvailable(exec) : false,
    wslInstallable: wslInstallable(exec, platform),
    hostPostgresBusyForeign: env.PDF_HOST_PG_FOREIGN === '1' || (defaultPgBusy && !postgresUp && pg.port === 5432),
    hostRedisBusyForeign: env.PDF_HOST_REDIS_FOREIGN === '1' || (defaultRedisBusy && !redisUp && redis.port === 6379),
    databaseUrl,
    redisUrl,
    gotenbergUrl,
  };
}

export async function applyPlan(plan, facts, env) {
  switch (plan.action) {
    case 'ready':
      log('Postgres, Redis, and Gotenberg are reachable (this project).');
      return;
    case 'ready-images-only':
      log(plan.message ?? 'Images can convert; Office conversion needs Gotenberg.');
      return;
    case 'blocked-ports':
      throw new Error(plan.message);
    case 'compose': {
      const services = plan.services ?? [];
      const args = composeUpArgs(services);
      log(`Docker is up. Starting missing ${COMPOSE_PROJECT} services: ${services.join(', ')}`);
      run('docker', args, {
        env: {
          ...process.env,
          ...env,
          PDF_POSTGRES_PORT: env.PDF_POSTGRES_PORT ?? '5432',
          PDF_REDIS_PORT: env.PDF_REDIS_PORT ?? '6379',
          PDF_GOTENBERG_PORT: env.PDF_GOTENBERG_PORT ?? '3000',
        },
      });
      if (services.includes('redis')) {
        env.PDF_ENSURE_REDIS_CLAIMED = '1';
      }
      await waitFor('compose services', async () => {
        const next = await collectFacts(env);
        return services.every((service) => {
          if (service === 'postgres') return next.postgresUp;
          if (service === 'redis') return next.redisUp;
          if (service === 'gotenberg') return next.gotenbergUp;
          return true;
        });
      });
      return;
    }
    case 'install-linux': {
      log(plan.message ?? 'Installing Linux host dependencies.');
      const script = join(ROOT, 'scripts', 'install-linux.sh');
      if (process.getuid && process.getuid() === 0) {
        run('bash', [script]);
      } else {
        run('sudo', ['bash', script]);
      }
      env.PDF_ENSURE_REDIS_CLAIMED = '1';
      return;
    }
    case 'brew-infra': {
      log(plan.message ?? 'Starting macOS Homebrew Postgres and Redis.');
      run('bash', [join(ROOT, 'scripts', 'infra.sh')]);
      env.PDF_ENSURE_REDIS_CLAIMED = '1';
      await waitFor('Postgres and Redis', async () => {
        const next = await collectFacts(env);
        return next.postgresUp && next.redisUp;
      });
      return;
    }
    case 'reexec-wsl': {
      log(plan.message ?? 'Re-running inside WSL Ubuntu.');
      const wslDir = toWslPath(ROOT);
      const boot = env.PDF_ENSURE_BOOT === 'dev' ? 'dev' : 'start';
      const inner = `cd '${wslDir}' && export PDF_ENSURE_INNER=1 && yarn ${boot}`;
      const result = spawnSync('wsl', ['-d', 'Ubuntu', '-e', 'bash', '-lc', inner], {
        cwd: ROOT,
        stdio: 'inherit',
        env,
      });
      process.exit(result.status ?? 1);
      return;
    }
    case 'install-wsl': {
      log(plan.message ?? 'Installing WSL Ubuntu.');
      const result = spawnSync('wsl', ['--install', '-d', 'Ubuntu'], {
        cwd: ROOT,
        stdio: 'inherit',
        env,
      });
      console.error(
        '\nWSL Ubuntu install was started. Reboot if Windows asks, then run yarn start again from this repo.\n',
      );
      process.exit(result.status === 0 ? 1 : result.status ?? 1);
      return;
    }
    case 'hyperv': {
      const script = join(ROOT, 'scripts', 'windows', 'setup-hyperv-ubuntu.ps1');
      log(plan.message ?? 'Hyper-V Ubuntu is required.');
      console.error(`\nRun in an elevated PowerShell:\n  powershell -ExecutionPolicy Bypass -File "${script}"\n`);
      const result = spawnSync(
        'powershell',
        ['-ExecutionPolicy', 'Bypass', '-File', script],
        { cwd: ROOT, stdio: 'inherit', env },
      );
      process.exit(result.status === 0 ? 1 : result.status ?? 1);
      return;
    }
    case 'unsupported':
      throw new Error(plan.message ?? `Unsupported platform ${facts.platform}`);
    default:
      throw new Error(`Unknown ensure action '${plan.action}'`);
  }
}

export async function ensureRuntime(options = {}) {
  const env = options.env ?? process.env;
  const boot = options.boot ?? 'none';
  env.PDF_ENSURE_BOOT = boot;

  if (env.PDF_ENSURE_SKIP === '1') {
    log('PDF_ENSURE_SKIP=1; not probing infrastructure.');
    return;
  }

  const envExample = join(ROOT, '.env.example');
  const envFile = join(ROOT, '.env');
  if (!existsSync(envFile)) {
    if (!existsSync(envExample)) {
      throw new Error('.env is missing and .env.example was not found.');
    }
    copyFileSync(envExample, envFile);
    log('Wrote .env from .env.example');
  }
  loadDotEnv(envFile, env);

  if (!existsSync(join(ROOT, 'node_modules'))) {
    log('Installing npm dependencies...');
    run(yarnCmd(), ['install']);
  }

  if (boot === 'start' && !existsSync(join(ROOT, 'dist', 'start.js'))) {
    log('dist/start.js is missing; building...');
    run(yarnCmd(), ['build']);
  }

  const urls = await resolveServiceUrls(env);
  const updates = {
    DATABASE_URL: urls.databaseUrl,
    REDIS_URL: urls.redisUrl,
    GOTENBERG_URL: urls.gotenbergUrl,
    PORT: urls.port,
    PUBLIC_URL: urls.publicUrl,
    PDF_POSTGRES_PORT: urls.PDF_POSTGRES_PORT,
    PDF_REDIS_PORT: urls.PDF_REDIS_PORT,
    PDF_GOTENBERG_PORT: urls.PDF_GOTENBERG_PORT,
  };
  upsertEnvFile(envFile, updates);
  Object.assign(env, updates);
  env.PDF_HOST_PG_FOREIGN = urls.hostPostgresBusyForeign ? '1' : '0';
  env.PDF_HOST_REDIS_FOREIGN = urls.hostRedisBusyForeign ? '1' : '0';
  if (urls.pgReason === 'foreign') {
    log(`Another process is using the default Postgres port; this app will use ${urls.PDF_POSTGRES_PORT}`);
  }
  if (urls.redisReason === 'foreign') {
    log(`Another process is using the default Redis port; this app will use ${urls.PDF_REDIS_PORT}`);
  }
  if (urls.gotenbergReason === 'foreign') {
    log(`Another process is using port 3000; Gotenberg will use ${urls.PDF_GOTENBERG_PORT}`);
  }
  if (urls.port !== '3050') {
    log(`API will listen on ${urls.port}`);
  }

  const facts = await collectFacts(env);
  facts.hostPostgresBusyForeign = urls.hostPostgresBusyForeign;
  facts.hostRedisBusyForeign = urls.hostRedisBusyForeign;
  const plan = decideInfra(facts);
  log(`platform=${facts.platform} docker=${facts.dockerUp} action=${plan.action} project=${COMPOSE_PROJECT}`);
  await applyPlan(plan, facts, env);

  if (plan.action === 'compose' && (plan.services ?? []).includes('redis')) {
    upsertEnvFile(envFile, { PDF_ENSURE_REDIS_CLAIMED: '1' });
    env.PDF_ENSURE_REDIS_CLAIMED = '1';
  }

  if (plan.action === 'reexec-wsl' || plan.action === 'install-wsl' || plan.action === 'hyperv') {
    return;
  }

  log('Running Prisma generate and migrate deploy...');
  run(yarnCmd(), ['prisma:generate']);
  run(yarnCmd(), ['prisma:migrate']);
}

export function bootProcess(boot) {
  if (boot === 'none') {
    return Promise.resolve();
  }

  let command = process.execPath;
  let args = [];
  if (boot === 'start') {
    args = [join(ROOT, 'dist', 'start.js')];
  } else if (boot === 'dev') {
    args = [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(ROOT, 'src', 'start.ts'), '--watch'];
  } else {
    throw new Error(`Unknown boot mode '${boot}'`);
  }

  const child = spawn(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code && code !== 0) {
        process.exitCode = code;
      }
      resolve();
    });
  });
}
