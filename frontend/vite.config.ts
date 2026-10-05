import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// In dev, the editor and its API come from the app server (worker: `npm start`, port 8787).
const app = 'http://127.0.0.1:8787';
export default defineConfig({plugins:[react()],server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':app,'/studio':app,'/assets':app,'/icons':app,'/favicon.svg':app}}});
