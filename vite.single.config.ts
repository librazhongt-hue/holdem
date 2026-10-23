// 单文件构建：npm run build:single → dist-single/index.html（可直接双击打开）
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  define: { 'import.meta.env.VITE_SINGLE_FILE': JSON.stringify('1') },
  build: { outDir: 'dist-single', emptyOutDir: true },
});
