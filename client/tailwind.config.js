/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Professional dark trading palette.
        ink: {
          950: '#0a0e17',
          900: '#0e1420',
          850: '#131a28',
          800: '#1a2233',
          700: '#222c40',
          600: '#2e3a52',
        },
        accent: {
          DEFAULT: '#3b82f6',
          soft: '#60a5fa',
        },
        bull: '#22c55e',
        bear: '#ef4444',
        warn: '#f59e0b',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
