module.exports = {
  entry: './src/main/index.ts',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: { transpileOnly: true },
        },
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.ts', '.json'],
  },
  externals: {
    'better-sqlite3': 'commonjs better-sqlite3',
    vosk: 'commonjs vosk',
    'node-record-lpcm16': 'commonjs node-record-lpcm16',
    '@huggingface/transformers': 'commonjs @huggingface/transformers',
    express: 'commonjs express',
    ws: 'commonjs ws',
    qrcode: 'commonjs qrcode',
  },
};
