/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Variable highlight colors (12 color cycle)
        'var-1': '#3b82f6',
        'var-2': '#22c55e',
        'var-3': '#a855f7',
        'var-4': '#f59e0b',
        'var-5': '#ef4444',
        'var-6': '#06b6d4',
        'var-7': '#ec4899',
        'var-8': '#84cc16',
        'var-9': '#6366f1',
        'var-10': '#14b8a6',
        'var-11': '#f97316',
        'var-12': '#8b5cf6',
      }
    },
  },
  plugins: [],
}
