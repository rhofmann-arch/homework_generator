/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          500: '#3b5bc8',
          600: '#1e468c',
          700: '#163570',
          800: '#0f2554',
        },
        honors: {
          50:  '#f0fdf4',
          600: '#16a34a',
          700: '#14693c',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
