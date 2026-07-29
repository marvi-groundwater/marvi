(function () {
  var pageMeta = {
    home: { label: 'Homepage', image: '/assets/marvi-originals/012-home.jpg', titleBase: 5 },
    approach: { label: 'The approach', image: '/assets/marvi-originals/008-home.jpg', titleBase: 3.4 },
    bjs: { label: 'Bhujal Jankaars', image: '/assets/marvi-originals/076-bhujal-jankaars-bjs.jpg', titleBase: 3.4 },
    groundwater: { label: 'Groundwater', image: '/assets/marvi-originals/005-home.jpg', titleBase: 3.4 },
    mywell: { label: 'MyWell app', image: '/assets/marvi-originals/079-about-mywell-app.jpg', titleBase: 3.4 },
    media: { label: 'In the media', image: '/assets/marvi-originals/020-welcome-to-marvi.jpg', titleBase: 3.4 },
    films: { label: 'Films', image: '/assets/marvi-originals/007-home.jpg', titleBase: 3.4 },
    game: { label: 'Groundwater game', image: '/assets/marvi-originals/002-home.jpg', titleBase: 3.4 },
    people: { label: 'People & partners', image: '/assets/marvi-originals/039-about-marvi.jpg', titleBase: 3.4 },
    archive: { label: 'Image archive', image: '/assets/marvi-originals/011-home.jpg', titleBase: 3.4 }
  };

  var clampPercent = function (value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return 100;
    return Math.min(200, Math.max(0, numeric));
  };
  var scaledRem = function (base, value) {
    return Number((base * clampPercent(value) / 100).toFixed(3)) + 'rem';
  };
  var horizontal = function (value) {
    return value === 'center' ? 'center' : value === 'right' ? 'flex-end' : 'flex-start';
  };
  var vertical = function (value) {
    return value === 'top' ? 'flex-start' : value === 'middle' ? 'center' : 'flex-end';
  };
  var text = function (value, fallback) {
    return value == null || value === '' ? fallback : value;
  };
  var assetUrl = function (props, value) {
    if (!value) return '';
    var asset = props.getAsset(value);
    return asset ? asset.toString() : value;
  };
  var pageImage = function (props, key, data) {
    if (key === 'home' && data.heroImage && data.heroImage.image) {
      return assetUrl(props, data.heroImage.image);
    }
    return pageMeta[key].image;
  };
  var contentSummary = function (key, data) {
    if (key === 'home') return '3 story-card images';
    if (key === 'media') return (data.items || []).length + ' media stories';
    if (key === 'films') return (data.items || []).length + ' videos';
    if (key === 'people') {
      return (data.partners || []).length + ' partners · ' + (data.portraits || []).length + ' portraits';
    }
    if (key === 'archive') return (data.items || []).length + ' archive images';
    if (data.images) return Object.keys(data.images).length + ' page images';
    return 'Page introduction and menu image';
  };
  var introContent = function (intro, titleBase) {
    return h('div', {
      className: 'preview-intro',
      style: {
        alignItems: horizontal(intro.textAlign),
        textAlign: intro.textAlign || 'left',
        justifyContent: vertical(intro.textPosition)
      }
    },
    h('p', {
      className: 'preview-eyebrow',
      style: { fontSize: scaledRem(.72, intro.eyebrowSize) }
    }, text(intro.eyebrow, 'Eyebrow text')),
    h('h1', {
      style: { fontSize: scaledRem(titleBase, intro.titleSize) }
    }, text(intro.title, 'Page title')),
    h('p', {
      className: 'preview-lede',
      style: { fontSize: scaledRem(1.15, intro.ledeSize) }
    }, text(intro.lede, 'Intro text')));
  };

  var createPagePreview = function (key) {
    return createClass({
      render: function () {
        var data = this.props.entry.get('data').toJS();
        var intro = data.intro || {};
        var meta = pageMeta[key];
        return h('main', { className: 'preview-page' },
          h('p', { className: 'preview-note' }, 'Live preview · ' + meta.label),
          h('section', {
            className: 'preview-hero',
            style: {
              backgroundImage: 'linear-gradient(180deg, rgba(8,18,15,.08), rgba(8,18,15,.86)), url("' +
                pageImage(this.props, key, data) + '")'
            }
          },
          h('span', { className: 'preview-label' }, meta.label),
          introContent(intro, meta.titleBase),
          h('span', { className: 'preview-content-count' }, contentSummary(key, data)))
        );
      }
    });
  };

  CMS.registerPreviewStyle('preview.css');
  Object.keys(pageMeta).forEach(function (key) {
    CMS.registerPreviewTemplate(key, createPagePreview(key));
  });
})();
