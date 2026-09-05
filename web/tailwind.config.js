/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Mirrors packages tokens in src/shared/theme.ts so the admin pill and
        // the customer badge are the same green.
        brand: {
          50: '#F1F9F3',
          100: '#DCF0E1',
          200: '#B6E1C1',
          400: '#4FB06C',
          500: '#1E8E3E',
          600: '#17762F',
          700: '#125C25',
          800: '#0E441C',
        },
        danger: { 50: '#FEF2F2', 500: '#E5484D', 600: '#C93B40' },
        warn: { 50: '#FFF8EB', 500: '#F59E0B' },
        info: { 50: '#EFF6FF', 500: '#3B82F6' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
