import * as os from 'os';

/**
 * Gets the platform identifier for downloading the correct binary.
 * @returns Platform string compatible with api-linter releases
 * @throws Error if the platform is not supported
 */
export const getPlatform = (): string => {
  const platform = os.platform();
  switch (platform) {
    case 'darwin': return 'darwin';
    case 'linux': return 'linux';
    case 'win32': return 'windows';
    default: throw new Error(`Unsupported platform: ${platform}`);
  }
};

/**
 * Gets the architecture identifier for downloading the correct binary.
 * @returns Architecture string compatible with api-linter releases
 * @throws Error if the architecture is not supported
 */
export const getArch = (): string => {
  const arch = os.arch();
  switch (arch) {
    case 'x64': return 'amd64';
    case 'arm64': return 'arm64';
    default: throw new Error(`Unsupported architecture: ${arch}`);
  }
};
