import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 1. Load env variables based on the mode (development/production)
  // This grabs VITE_API_KEY from Vercel's system or your local .env file
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    // 2. The Magic Switch
    // This physically replaces "process.env.API_KEY" in your App.tsx
    // with the actual value of VITE_API_KEY during the build.
    define: {
      'process.env.API_KEY': JSON.stringify(env.VITE_API_KEY),
    },
  };
});