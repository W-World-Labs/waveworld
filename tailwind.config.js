/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#070912',
        panel: '#0e1322',
        edge: '#1c2438',
        wave: '#7c5cff',
        glow: '#3ad6ff',
        ember: '#ff8a4c',
        // 五域光谱配色（波长编码：紫→青→翠→琥珀→品红）
        'd-ontology': '#8b7bff',
        'd-field': '#3ad6ff',
        'd-matter': '#2dd4bf',
        'd-life': '#ff9a4c',
        'd-lab': '#ff5c9d',
      },
      fontFamily: {
        sans: [
          'Inter', 'system-ui', '-apple-system', 'Segoe UI',
          '"PingFang SC"', '"Microsoft YaHei"', '"Noto Sans SC"', '"Hiragino Sans GB"', 'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        display: ['Syne', '"PingFang SC"', '"Noto Sans SC"', '"Microsoft YaHei"', 'sans-serif'],
      },
      maxWidth: {
        prose: '68ch',
      },
    },
  },
  plugins: [],
}
