(function () {
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
  var contentStyle = function (data) {
    return {
      alignItems: horizontal(data.textAlign),
      textAlign: data.textAlign || 'left',
      justifyContent: vertical(data.textPosition)
    };
  };
  var introContent = function (data, titleKey, titleBase) {
    return h('div', { className: 'preview-intro', style: contentStyle(data) },
      h('p', {
        className: 'preview-eyebrow',
        style: { fontSize: scaledRem(.72, data.eyebrowSize) }
      }, text(data.eyebrow, 'Eyebrow text')),
      h('h1', {
        style: { fontSize: scaledRem(titleBase, data.titleSize) }
      }, text(data[titleKey], 'Page title')),
      h('p', {
        className: 'preview-lede',
        style: { fontSize: scaledRem(1.15, data.ledeSize) }
      }, text(data.lede || data.heroBody, 'Intro text'))
    );
  };

  var HomepagePreview = createClass({
    render: function () {
      var data = this.props.entry.get('data').toJS();
      var image = assetUrl(this.props, data.heroImage);
      return h('main', { className: 'preview-page' },
        h('section', {
          className: 'preview-hero',
          style: {
            backgroundImage: 'linear-gradient(180deg, rgba(8,18,15,.08), rgba(8,18,15,.86)), url("' + image + '")'
          }
        }, introContent(data, 'heroTitle', 5))
      );
    }
  });

  var sectionImages = {
    approach: '/assets/marvi-originals/008-home.jpg',
    bjs: '/assets/marvi-originals/076-bhujal-jankaars-bjs.jpg',
    groundwater: '/assets/marvi-originals/005-home.jpg',
    mywell: '/assets/marvi-originals/079-about-mywell-app.jpg',
    media: '/assets/marvi-originals/020-welcome-to-marvi.jpg',
    films: '/assets/marvi-originals/007-home.jpg',
    game: '/assets/marvi-originals/002-home.jpg',
    people: '/assets/marvi-originals/039-about-marvi.jpg',
    archive: '/assets/marvi-originals/011-home.jpg'
  };
  var sectionLabels = {
    approach: 'The approach',
    bjs: 'Bhujal Jankaars',
    groundwater: 'Groundwater',
    mywell: 'MyWell app',
    media: 'In the media',
    films: 'Films',
    game: 'Groundwater game',
    people: 'People & partners',
    archive: 'Image archive'
  };

  var SectionsPreview = createClass({
    render: function () {
      var data = this.props.entry.get('data').toJS();
      return h('main', { className: 'preview-page' },
        h('p', { className: 'preview-note' }, 'Live section-intro preview · each card updates as you type'),
        h('div', { className: 'preview-sections' },
          Object.keys(sectionImages).map(function (key) {
            var section = data[key] || {};
            return h('section', {
              className: 'preview-section',
              key: key,
              style: {
                backgroundImage: 'linear-gradient(180deg, rgba(8,18,15,.06), rgba(8,18,15,.88)), url("' + sectionImages[key] + '")'
              }
            },
            h('span', { className: 'preview-label' }, sectionLabels[key]),
            introContent(section, 'title', 3.4));
          })
        )
      );
    }
  });

  CMS.registerPreviewStyle('preview.css');
  CMS.registerPreviewTemplate('homepage', HomepagePreview);
  CMS.registerPreviewTemplate('sections', SectionsPreview);
})();
