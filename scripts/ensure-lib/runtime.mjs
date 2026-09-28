import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aptGetBin,
  brewBin,
  chocoBin,
  curlBin,
  debianLike,
  detectChromiumBin,
  detectLibreOfficeBin,
  fontsPresent,
  wgetBin,
  wingetBin,
} from './bins.mjs';
import {
  adminCommandForMsi,
  brewInstallArgs,
  chocoInstallPlan,
  copyFontsInto,
  downloadArgs,
  extractLiberationArgs,
  fetchLatestLibreOfficeVersion,
  isElevatedWindows,
  linuxPackages,
  msiexecSilentArgs,
  windowsDownloadPlan,
  windowsFontDest,
  wingetInstallPlan,
} from './install.mjs';
import { conversionReady, decideInfra } from './plan.mjs';
import { findFreePort, probeTcp } from './probes.mjs';

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
    if (value === undefined || value === '') {
      continue;
    }
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

export async function resolveApiPort(env) {
  const preferredApi = Number(env.PORT ?? 3050);
  const apiBusy = await probeTcp(LISTEN_HOST, preferredApi);
  const apiPort = apiBusy ? await findFreePort(LISTEN_HOST, preferredApi + 1) : preferredApi;
  return { port: String(apiPort), reason: apiBusy ? 'foreign' : 'free' };
}

export function collectFacts(env, exec = spawnSync) {
  const platform = process.platform;
  loadDotEnv(join(ROOT, '.env'), env);

  const libreofficeBin = detectLibreOfficeBin(env.LIBREOFFICE_BIN, exec);
  const chromiumBin = detectChromiumBin(env.CHROMIUM_BIN, exec);

  return {
    platform,
    libreofficeBin,
    chromiumBin,
    fontsPresent: fontsPresent(platform, exec),
    brew: platform === 'darwin' ? brewBin(exec) : undefined,
    apt: platform === 'linux' ? Boolean(aptGetBin(exec)) && debianLike((path, enc) => readFileSync(path, enc)) : false,
    wget: wgetBin(exec),
    curl: curlBin(exec),
    winget: platform === 'win32' ? wingetBin(exec) : undefined,
    choco: platform === 'win32' ? chocoBin(exec) : undefined,
  };
}

function downloadFile(url, dest, facts) {
  mkdirSync(dirname(dest), { recursive: true });
  if (facts.wget) {
    run(facts.wget, downloadArgs('wget', url, dest));
    return;
  }
  if (facts.curl) {
    run(facts.curl, downloadArgs('curl', url, dest));
    return;
  }
  throw new Error(`wget or curl.exe is required to download ${url}`);
}

function installBrew(missing, facts) {
  const args = brewInstallArgs(missing);
  if (args.length === 0) {
    return;
  }
  run(facts.brew || 'brew', args);
}

function installLinux(missing) {
  const packages = linuxPackages(missing);
  if (packages.length === 0) {
    return;
  }
  const apt = ['apt-get', 'install', '-y', '--no-install-recommends', ...packages];
  const update = ['apt-get', 'update', '-qq'];
  if (process.getuid && process.getuid() === 0) {
    run('apt-get', update.slice(1));
    run('apt-get', apt.slice(1));
  } else {
    run('sudo', update);
    run('sudo', apt);
  }
  try {
    run('fc-cache', ['-f']);
  } catch {
    // font cache refresh is best-effort
  }
}

function collectTtfFiles(rootDir) {
  const found = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) {
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.(ttf|otf)$/i.test(entry.name)) {
        found.push(full);
      }
    }
  }
  return found;
}

function runPackagePlan(command, plan) {
  for (const item of plan) {
    log(`Installing ${item.id} with ${command}...`);
    try {
      run(command, item.args);
    } catch (error) {
      if (item.required) {
        throw error;
      }
      log(`${item.id} package is optional and was skipped: ${error instanceof Error ? error.message : error}`);
    }
  }
}

async function installWindows(missing, facts) {
  if (facts.winget) {
    log('Using winget to install missing conversion engines.');
    runPackagePlan(facts.winget, wingetInstallPlan(missing));
    return;
  }
  if (facts.choco) {
    log('Using Chocolatey to install missing conversion engines.');
    runPackagePlan(facts.choco, chocoInstallPlan(missing));
    return;
  }

  const version = await fetchLatestLibreOfficeVersion();
  const downloads = windowsDownloadPlan(missing, version);
  if (downloads.length === 0) {
    return;
  }
  const work = join(tmpdir(), 'pdf-converter-install');
  mkdirSync(work, { recursive: true });
  const elevated = isElevatedWindows();
  const msiFiles = [];
  const fontFiles = [];

  for (const item of downloads) {
    const dest = join(work, item.filename);
    log(`Downloading ${item.id} with ${facts.wget ? 'wget' : facts.curl ? 'curl' : 'nothing'}...`);
    downloadFile(item.url, dest, facts);
    if (item.kind === 'msi') {
      msiFiles.push(dest);
    } else if (item.kind === 'font') {
      fontFiles.push(dest);
    } else if (item.kind === 'font-archive') {
      const unpacked = join(work, 'liberation');
      mkdirSync(unpacked, { recursive: true });
      run('tar', extractLiberationArgs(dest, unpacked));
      fontFiles.push(...collectTtfFiles(unpacked));
    }
  }

  if (msiFiles.length > 0 && !elevated) {
    const commands = msiFiles.map((file) => adminCommandForMsi(file)).join('\n  ');
    throw new Error(
      `LibreOffice/Chrome install needs an elevated Windows session. Run as Administrator:\n  ${commands}`,
    );
  }

  for (const msi of msiFiles) {
    run('msiexec', msiexecSilentArgs(msi));
  }

  if (fontFiles.length > 0) {
    const destDir = windowsFontDest(elevated);
    const copied = copyFontsInto(destDir, fontFiles);
    log(`Installed ${copied.length} font file(s) into ${destDir}`);
  }
}

export async function applyPlan(plan, facts, _env) {
  switch (plan.action) {
    case 'ready':
      log('LibreOffice and Chrome/Chromium are available.');
      return;
    case 'brew-native':
      log(plan.message ?? 'Installing missing engines with Homebrew.');
      installBrew(plan.missing, facts);
      return;
    case 'install-linux':
      log(plan.message ?? 'Installing missing engines with apt-get.');
      installLinux(plan.missing);
      return;
    case 'install-windows':
      log(plan.message ?? 'Installing missing engines with winget, Chocolatey, or a direct download.');
      await installWindows(plan.missing, facts);
      return;
    case 'need-homebrew':
    case 'unsupported-linux':
    case 'unsupported':
      throw new Error(plan.message ?? `Cannot install conversion engines on ${facts.platform}`);
    default:
      throw new Error(`Unknown ensure action '${plan.action}'`);
  }
}

function persistDetectedBins(envFile, facts, env) {
  const updates = {};
  if (facts.libreofficeBin) {
    updates.LIBREOFFICE_BIN = facts.libreofficeBin;
    env.LIBREOFFICE_BIN = facts.libreofficeBin;
  }
  if (facts.chromiumBin) {
    updates.CHROMIUM_BIN = facts.chromiumBin;
    env.CHROMIUM_BIN = facts.chromiumBin;
  }
  if (Object.keys(updates).length > 0) {
    upsertEnvFile(envFile, updates);
  }
}

export async function ensureRuntime(options = {}) {
  const env = options.env ?? process.env;
  const boot = options.boot ?? 'none';
  env.PDF_ENSURE_BOOT = boot;

  if (env.PDF_ENSURE_SKIP === '1') {
    log('PDF_ENSURE_SKIP=1; not probing conversion engines.');
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

  const urls = await resolveApiPort(env);
  upsertEnvFile(envFile, { PORT: urls.port });
  env.PORT = urls.port;
  if (urls.port !== '3050') {
    log(`API will listen on ${urls.port}`);
  }

  let facts = collectFacts(env);
  let plan = decideInfra(facts);
  log(
    `platform=${facts.platform} action=${plan.action} missing=${plan.missing.join(',') || 'none'}`,
  );

  if (plan.action !== 'ready') {
    await applyPlan(plan, facts, env);
    facts = collectFacts(env);
    plan = decideInfra(facts);
    log(
      `after-install action=${plan.action} missing=${plan.missing.join(',') || 'none'}`,
    );
  }

  persistDetectedBins(envFile, facts, env);

  if (!conversionReady(facts)) {
    throw new Error(
      plan.message ??
        'LibreOffice and Chrome/Chromium are still missing after install. Install them and run yarn start again.',
    );
  }

  if (plan.missing.includes('fonts')) {
    log('Conversion fonts are still missing. Office/HTML PDFs may substitute glyphs.');
  }
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

  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code && code !== 0) {
        process.exitCode = code;
      }
      resolvePromise();
    });
  });
}

export function cleanupInstallDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}
