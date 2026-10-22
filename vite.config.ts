import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works at https://<user>.github.io/<any-repo-name>/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // SheetJS (~500 kB) is lazy-loaded only for Excel import/export.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          calendar: ['@fullcalendar/core', '@fullcalendar/react', '@fullcalendar/daygrid', '@fullcalendar/timegrid', '@fullcalendar/interaction'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
