/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        theme: {
          bg: 'rgb(var(--bg-primary) / <alpha-value>)',
          surface: 'rgb(var(--bg-secondary) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
          text: 'rgb(var(--text-main) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
          border: 'rgb(var(--border-color) / <alpha-value>)',
          accent: 'rgb(var(--accent-color) / <alpha-value>)',
          accentContrast: 'rgb(var(--accent-contrast) / <alpha-value>)',
          sidebar: 'rgb(var(--sidebar-bg) / <alpha-value>)',
          sidebarText: 'rgb(var(--sidebar-text) / <alpha-value>)'
        }
      },
      borderRadius: {
        card: 'var(--radius-card)',
        soft: 'var(--radius-soft)'
      },
      boxShadow: {
        card: '0 10px 30px -20px rgb(var(--shadow-color) / 0.42)',
        cardStrong: '0 18px 45px -24px rgb(var(--shadow-color) / 0.55)'
      },
      keyframes: {
        'scale-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        }
      },
      animation: {
        'spin-slow': 'spin 8s linear infinite',
        'scale-in': 'scale-in 0.2s ease-out',
      }
    },
  },
  plugins: [],
}
