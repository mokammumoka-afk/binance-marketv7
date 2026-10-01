// Lets Node resolve the extension-less relative imports used by the Next.js
// sources (e.g. `from '../binance/rest'`) so the pure engines can be unit-tested
// without a bundler.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !/\.[cm]?jsx?$/.test(specifier)) {
      try {
        return await nextResolve(specifier + '.js', context);
      } catch {
        return await nextResolve(specifier + '/index.js', context);
      }
    }
    throw err;
  }
}
