// Adapt the engine's public palette hook without changing its pinned source.
(function (A) {
  const nativeHues = A.hues;
  A.hues = function (settings, random) {
    return Array.isArray(settings.inkColors) && settings.inkColors.length
      ? settings.inkColors.slice() : nativeHues(settings, random);
  };
})(globalThis.AlgoArt);
