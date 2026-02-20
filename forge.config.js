const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'AutoScribe',
    executableName: 'autoscribe',
    icon: './src/assets/icon',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'AutoScribe',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'autoscribe',
          productName: 'AutoScribe',
          description: 'AI-enhanced transcription tool for churches',
          categories: ['Accessibility', 'Audio'],
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          name: 'autoscribe',
          productName: 'AutoScribe',
          description: 'AI-enhanced transcription tool for churches',
          categories: ['Accessibility', 'AudioVideo'],
          license: 'MIT',
        },
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html: './src/renderer/control/index.html',
              js: './src/renderer/control/index.tsx',
              name: 'control_window',
              preload: {
                js: './src/preload/control.ts',
              },
            },
            {
              html: './src/renderer/display/index.html',
              js: './src/renderer/display/index.tsx',
              name: 'display_window',
              preload: {
                js: './src/preload/display.ts',
              },
            },
          ],
        },
      },
    },
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
