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
  var photoStyle = function (props, key, data) {
    var photo = data.heroImage || {};
    var layout = MarviLayout.photo(photo);
    var image = photo.image ? assetUrl(props, photo.image) : pageMeta[key].image;
    return {
      backgroundImage: 'url("' + image + '")',
      backgroundPosition: layout.x + '% ' + layout.y + '%',
      backgroundSize: layout.fit,
      transform: 'scale(' + layout.scale + ')'
    };
  };
  var photoElementStyle = function (photo) {
    var layout = MarviLayout.photo(photo);
    return {
      objectPosition: layout.x + '% ' + layout.y + '%',
      objectFit: layout.fit,
      scale: layout.scale
    };
  };
  var photoElement = function (props, photo, className) {
    if (!photo || !photo.image) return null;
    return h('img', {
      className: className || '',
      src: assetUrl(props, photo.image),
      alt: '',
      style: photoElementStyle(photo)
    });
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
  var introContent = function (intro, titleBase, actions) {
    var layout = MarviLayout.text(intro);
    return h('div', {
      className: 'preview-intro',
      style: {
        alignItems: horizontal(intro.textAlign),
        textAlign: intro.textAlign || 'left',
        justifyContent: vertical(intro.textPosition),
        width: layout.width + '%',
        transform:
          'translate(' +
          layout.offsetX + '%, ' +
          layout.offsetY + '%)'
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
    }, text(intro.lede, 'Intro text')),
    actions);
  };

  var homeActions = function (key, data) {
    if (key !== 'home') return null;
    return h('div', { className: 'preview-actions' },
      h('span', { className: 'preview-button preview-button-primary' },
        text(data.primaryButtonLabel, 'Explore the approach'), ' ↗'),
      h('span', { className: 'preview-button' },
        text(data.secondaryButtonLabel, 'Discover MyWell'), ' ↗'));
  };
  var previewParagraphs = function (value) {
    return String(value || '').split(/\n\s*\n/).filter(Boolean).map(function (paragraph) {
      return h('p', null, paragraph.trim());
    });
  };
  var existingContent = function (props, key, data) {
    var children = [];
    if (data.images) {
      Object.keys(data.images).forEach(function (name) {
        var photo = data.images[name];
        children.push(h('figure', { className: 'preview-content-photo' },
          photoElement(props, photo),
          h('figcaption', null, name.replace(/([A-Z])/g, ' $1'))));
      });
    }
    if (key === 'media' || key === 'films') {
      (data.items || []).forEach(function (item) {
        children.push(h('article', { className: 'preview-content-card' },
          h('small', null, item.meta || ''),
          h('h3', null, item.title || 'Untitled item'),
          item.description ? h('p', null, item.description) : null));
      });
    }
    if (key === 'people') {
      (data.partners || []).forEach(function (item) {
        children.push(h('article', { className: 'preview-content-card' },
          h('small', null, item.meta || ''),
          h('h3', null, item.name || 'Unnamed partner')));
      });
      (data.portraits || []).forEach(function (photo) {
        children.push(h('figure', { className: 'preview-content-photo preview-content-portrait' },
          photoElement(props, photo)));
      });
    }
    if (key === 'archive') {
      (data.items || []).forEach(function (item) {
        children.push(h('figure', { className: 'preview-content-photo' },
          photoElement(props, item),
          h('figcaption', null, item.category || '', ' · ', item.title || '')));
      });
    }
    return h('section', { className: 'preview-body' },
      h('header', { className: 'preview-body-head' },
        h('p', { className: 'preview-eyebrow' }, 'Editable page content'),
        h('h2', null, children.length ? contentSummary(key, data) : 'Existing editorial content')),
      children.length
        ? h('div', { className: 'preview-content-grid' }, children)
        : h('p', { className: 'preview-empty-note' },
          'The existing designed page sections appear here on the published website.'));
  };
  var flexibleBlock = function (props, item) {
    if (!item || !item.type) return null;
    var heading = item.heading ? h('h2', null, item.heading) : null;
    var copy = h('div', {
      className: 'preview-block-copy',
      style: { textAlign: item.align || 'left' }
    },
    item.eyebrow ? h('p', { className: 'preview-eyebrow' }, item.eyebrow) : null,
    heading,
    previewParagraphs(item.body));
    if (item.type === 'text') {
      return h('section', { className: 'preview-block preview-block-text' }, copy);
    }
    if (item.type === 'imageText') {
      return h('section', {
        className: 'preview-block preview-block-image-text',
        'data-photo-side': item.photoSide || 'left'
      },
      h('div', { className: 'preview-block-photo' }, photoElement(props, item.photo || {})),
      copy);
    }
    if (item.type === 'gallery') {
      return h('section', { className: 'preview-block preview-block-gallery-wrap' },
        heading,
        h('div', { className: 'preview-block-gallery' },
          (item.photos || []).map(function (photo) {
            return h('figure', null, photoElement(props, photo));
          })));
    }
    if (item.type === 'callout') {
      return h('section', {
        className: 'preview-block preview-block-callout',
        'data-tone': item.tone || 'blue'
      }, heading, previewParagraphs(item.body));
    }
    if (item.type === 'button') {
      return h('section', { className: 'preview-block preview-block-button' },
        heading,
        h('span', { className: 'preview-button preview-button-primary' },
          text(item.label, 'Learn more'), ' ↗'));
    }
    return null;
  };
  var flexibleContent = function (props, data) {
    if (!Array.isArray(data.sections) || !data.sections.length) return null;
    return h('section', { className: 'preview-flexible-sections' },
      data.sections.map(function (item) { return flexibleBlock(props, item); }));
  };
  var createPagePreview = function (key) {
    return createClass({
      render: function () {
        var data = this.props.entry.get('data').toJS();
        var intro = data.intro || {};
        var meta = pageMeta[key];
        return h('main', { className: 'preview-page' },
          h('aside', { className: 'preview-sidebar' },
            h('strong', null, 'MARVI'),
            h('span', null, 'CMS preview'),
            h('small', null, meta.label)),
          h('section', {
            className: 'preview-hero preview-hero-' + key
          },
          h('div', { className: 'preview-hero-image', style: photoStyle(this.props, key, data) }),
          h('div', { className: 'preview-hero-shade' }),
          h('div', {
            className: 'preview-copy-stage',
            style: {
              alignItems: vertical(intro.textPosition),
              justifyContent: horizontal(intro.textAlign)
            }
          },
            introContent(intro, meta.titleBase, homeActions(key, data)))),
          existingContent(this.props, key, data),
          flexibleContent(this.props, data),
          h('p', { className: 'preview-note' }, 'End of full page preview')
        );
      }
    });
  };

  CMS.registerPreviewStyle('preview.css');
  Object.keys(pageMeta).forEach(function (key) {
    CMS.registerPreviewTemplate(key, createPagePreview(key));
  });
})();
