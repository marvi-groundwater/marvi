(function (root) {
  var clamp = function (value, min, max, fallback) {
    var numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
  };

  var photo = function (data) {
    data = data || {};
    var zoom = clamp(data.zoom, 50, 200, 100);
    return Object.freeze({
      x: clamp(data.positionX, 0, 100, 50),
      y: clamp(data.positionY, 0, 100, 50),
      zoom: zoom,
      scale: zoom / 100,
      fit: data.fit && data.fit !== 'auto' ? data.fit : 'cover'
    });
  };

  var text = function (data) {
    data = data || {};
    return Object.freeze({
      width: clamp(data.textWidth, 30, 100, 100),
      offsetX: clamp(data.textOffsetX, -100, 100, 0),
      offsetY: clamp(data.textOffsetY, -100, 100, 0)
    });
  };

  root.MarviLayout = Object.freeze({
    clamp: clamp,
    photo: photo,
    text: text
  });
})(globalThis);
