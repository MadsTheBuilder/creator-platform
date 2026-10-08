import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// In dev, the editor and its API come from the app server (worker: `npm start`, port 8787).
export default defineConfig(({ mode }) => {
  const app = loadEnv(mode, '.', 'APP_SERVICE_URL').APP_SERVICE_URL ?? 'http://127.0.0.1:8787';
  return {plugins:[react()],server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':app,'/studio':app,'/assets':app,'/icons':app,'/favicon.svg':app}}};
});
