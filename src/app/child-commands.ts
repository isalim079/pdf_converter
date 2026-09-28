import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ChildCommand {
  command: string;
  args: string[];
}

export function resolveChildCommand(input: {
  watch: boolean;
  entryDir: string;
  projectRoot: string;
  execPath: string;
}): ChildCommand {
  if (input.watch) {
    const tsxCli = join(input.projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (!existsSync(tsxCli)) {
      throw new Error(`tsx is required for watch mode but was not found at ${tsxCli}`);
    }

    return {
      command: input.execPath,
      args: [tsxCli, 'watch', '--clear-screen=false', join(input.entryDir, 'main.ts')],
    };
  }

  return {
    command: input.execPath,
    args: [join(input.entryDir, 'main.js')],
  };
}
