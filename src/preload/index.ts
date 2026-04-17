import { contextBridge } from 'electron';
import { exposeElectronTRPC } from 'trpc-electron/main';

exposeElectronTRPC();

contextBridge.exposeInMainWorld('appEnv', {
  platform: process.platform,
  isDev: !process.env.APP_PACKAGED,
});

export type AppEnvBridge = {
  platform: NodeJS.Platform;
  isDev: boolean;
};
