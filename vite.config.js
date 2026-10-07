import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          visualization: ['chart.js', 'react-chartjs-2', 'leaflet'],
          astronomy: ['luxon', 'suncalc'],
          cloud: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
