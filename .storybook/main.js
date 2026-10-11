export default {
  stories: ['../stories/**/*.stories.js'],
  framework: '@storybook/html-vite',
  core: {
    disableTelemetry: true,
    disableWhatsNewNotifications: true
  },
  // Import the screen and styles explicitly; do not copy the production app entry.
  viteFinal: (config) => ({
    ...config,
    publicDir: false,
    server: {
      ...config.server,
      watch: {
        ...config.server?.watch,
        ignored: ['**/storybook-static/**', '**/output/**']
      }
    }
  })
};
