(function () {
  var pageMeta = {
    home: 'Homepage',
    approach: 'The approach',
    bjs: 'Bhujal Jankaars',
    groundwater: 'Groundwater',
    mywell: 'MyWell app',
    media: 'In the media',
    films: 'Films',
    game: 'Groundwater game',
    people: 'People & partners',
    archive: 'Image archive',
    publications: 'Publications',
    tools: 'Tools'
  };

  var assetUrl = function (props, value) {
    if (!value) return value;
    var asset = props.getAsset(value);
    return asset ? asset.toString() : value;
  };

  // Decap can represent a newly selected image as a blob-backed asset that is
  // not yet available at its eventual repository path. Resolve every nested
  // `image` field before sending the unsaved entry into the real site frame.
  var resolveAssets = function (props, value, fieldName) {
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return resolveAssets(props, item);
      });
    }
    if (!value || typeof value !== 'object') {
      return fieldName === 'image' && typeof value === 'string'
        ? assetUrl(props, value)
        : value;
    }
    return Object.keys(value).reduce(function (copy, key) {
      copy[key] = resolveAssets(props, value[key], key);
      return copy;
    }, {});
  };

  var createPagePreview = function (key) {
    return createClass({
      componentDidMount: function () {
        var self = this;
        this.handlePreviewReady = function (event) {
          if (
            event.origin === window.location.origin &&
            self.previewFrame &&
            event.source === self.previewFrame.contentWindow &&
            event.data &&
            event.data.type === 'marvi:cms-preview-ready'
          ) {
            self.sendPreviewData();
          }
        };
        window.addEventListener('message', this.handlePreviewReady);
      },

      componentWillUnmount: function () {
        if (this.handlePreviewReady) {
          window.removeEventListener('message', this.handlePreviewReady);
        }
      },

      sendPreviewData: function () {
        if (!this.previewFrame || !this.previewFrame.contentWindow) return;
        var data = this.props.entry.get('data').toJS();
        this.previewFrame.contentWindow.postMessage({
          type: 'marvi:cms-preview',
          key: key,
          data: resolveAssets(this.props, data)
        }, window.location.origin);
      },

      componentDidUpdate: function () {
        this.sendPreviewData();
      },

      render: function () {
        var self = this;
        return h('main', { className: 'preview-live-shell' },
          h('iframe', {
            className: 'preview-live-frame',
            src: '../?cms-preview=1#' + key,
            title: pageMeta[key] + ' — live website preview',
            ref: function (frame) {
              self.previewFrame = frame;
            },
            onLoad: function () {
              self.sendPreviewData();
            }
          }));
      }
    });
  };

  CMS.registerPreviewStyle('preview.css');
  Object.keys(pageMeta).forEach(function (key) {
    CMS.registerPreviewTemplate(key, createPagePreview(key));
  });
})();
