/**
 * Pure decision table for yarn start / yarn dev ensure.
 * Does not spawn processes.
 */

export function missingPieces(facts) {
  const missing = [];
  if (!facts.libreofficeBin) {
    missing.push('libreoffice');
  }
  if (!facts.chromiumBin) {
    missing.push('chromium');
  }
  if (!facts.fontsPresent) {
    missing.push('fonts');
  }
  return missing;
}

export function conversionReady(facts) {
  return Boolean(facts.libreofficeBin && facts.chromiumBin);
}

export const HOMEBREW_INSTALL =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

export const LINUX_PACKAGE_HINT =
  'Install LibreOffice writer/calc/impress, Chromium, fonts-noto-core, fonts-noto-ui-core, fonts-liberation, fonts-beng, and fonts-lohit-beng-bengali.';

/**
 * @param {object} facts
 * @returns {{ action: string, missing: string[], message?: string }}
 */
export function decideInfra(facts) {
  const missing = missingPieces(facts);
  const enginesOk = conversionReady(facts);

  if (missing.length === 0) {
    return { action: 'ready', missing };
  }

  const platform = facts.platform;

  if (platform === 'darwin') {
    if (!facts.brew) {
      if (enginesOk) {
        return {
          action: 'ready',
          missing,
          message: 'LibreOffice and Chrome are present. Homebrew is missing, so conversion fonts were not installed.',
        };
      }
      return {
        action: 'need-homebrew',
        missing,
        message: `Homebrew is required to install conversion engines. Install it with: ${HOMEBREW_INSTALL} then run yarn start again.`,
      };
    }
    return {
      action: 'brew-native',
      missing,
      message: 'Installing missing LibreOffice, Chrome, and conversion fonts with Homebrew.',
    };
  }

  if (platform === 'linux') {
    if (!facts.apt) {
      if (enginesOk) {
        return {
          action: 'ready',
          missing,
          message: `LibreOffice and Chromium are present. ${LINUX_PACKAGE_HINT}`,
        };
      }
      return {
        action: 'unsupported-linux',
        missing,
        message: `This Linux distribution is not Debian/Ubuntu. ${LINUX_PACKAGE_HINT}`,
      };
    }
    return {
      action: 'install-linux',
      missing,
      message: 'Installing missing LibreOffice, Chromium, and conversion fonts with sudo apt-get.',
    };
  }

  if (platform === 'win32') {
    return {
      action: 'install-windows',
      missing,
      message: 'Installing missing LibreOffice, Chrome, and fonts via winget (or choco / direct download).',
    };
  }

  if (enginesOk) {
    return { action: 'ready', missing };
  }

  return {
    action: 'unsupported',
    missing,
    message: `Unsupported platform '${platform}'. Use macOS, Linux, or Windows.`,
  };
}
