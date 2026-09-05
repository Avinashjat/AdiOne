module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './src',
            // The shared contract, mirrored from backend/src/shared. Same
            // enums, error codes and business helpers the server uses.
            // Points at the directory, not index.ts: bare `@shared` still
            // resolves via the directory's index, while `@shared/theme` and
            // friends resolve to the individual modules. Mapping this to the
            // file breaks every subpath import.
            '@shared': './src/shared',
          },
          extensions: ['.ts', '.tsx', '.js', '.json'],
        },
      ],
    ],
  };
};
