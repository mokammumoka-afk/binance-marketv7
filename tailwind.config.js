/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        base: {
          950: '#0A0D12',
          900: '#0E1218',
          850: '#121722',
          800: '#161C29',
          700: '#1F2733',
          600: '#2A3441',
          500: '#3D4A5C',
          400: '#5B6B80',
          300: '#8493A6',
          200: '#B7C2CF',
          100: '#E4E9EE',
        },
        long: {
          DEFAULT: '#3FB68B',
          dim: '#1E4536',
          bright: '#5FD6AB',
        },
        short: {
          DEFAULT: '#D65D6B',
          dim: '#4A2429',
          bright: '#F0808C',
        },
        warn: {
          DEFAULT: '#C9963A',
          dim: '#453820',
        },
        accent: {
          DEFAULT: '#4E8FD1',
          dim: '#1E3350',
        },
      },
      fontFamily: {
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
