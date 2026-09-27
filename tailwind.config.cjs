module.exports = {
  presets: [require('./admin/workspace/theme/tailwind-preset.cjs')],
  content: ['./admin/**/*.{ts,tsx}', './app/**/*.{ts,tsx}', './sdk/**/*.{ts,tsx}', './extensions/**/*.{ts,tsx}',
    './application/**/*.{ts,tsx}', './tests/workspace/fixtures/**/*.{ts,tsx}'],
};
