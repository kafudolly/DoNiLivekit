/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        doni: {
          bg0: '#0f1014',
          bg1: '#18191f',
          bg2: '#22242b',
          bg3: '#2b2e37',
          border: 'rgba(255, 255, 255, 0.075)',
          'border-strong': 'rgba(255, 255, 255, 0.13)',
          text0: '#f5f7fb',
          text1: '#d7dce5',
          text2: '#99a1ad',
          accent: '#5865f2',
          success: '#23a559',
          danger: '#f23f42',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ["'Segoe UI'", 'Tahoma', 'Geneva', 'Verdana', 'sans-serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
