import type { AppEnvBridge, AppShellBridge } from '../../preload/index';

declare global {
  interface Window {
    appEnv?: AppEnvBridge;
    appShell?: AppShellBridge;
  }
}
