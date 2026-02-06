
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    /**
     * This mapping ensures that the SDK's internal reference to process.env.API_KEY
     * is replaced with Vite's client-side environment variable at build time.
     * On Vercel, ensure you set an environment variable named VITE_API_KEY.
     */
    'process.env.API_KEY': 'import.meta.env.VITE_API_KEY',
  },
});
