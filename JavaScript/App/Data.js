require('Core');

var API = require('API');
var OutputFiles = require('./OutputFiles');
var Source = require('./Source');

var CurrentUpload = require('Store/CurrentUpload');
var User = require('Store/User');

var Auphonic = require('Auphonic');
var Platform = require('Platform');

var length = function(object) {
  return object && object.length;
};

var preferredFormats = {
  mp3: 1,
  'mp3-vbr': 3, // Variable Bitrate mp3's sometime cause issues
  aac: 2,
  alac: 3,
  dflt: 4
};

if (!Platform.isIOS()) {
  preferredFormats.vorbis = 2;
  preferredFormats.flac = 3;
}

var fields = ['output_files', 'outgoing_services', 'chapters'];
var singular = ['file', 'service', 'chapter'];
var format = function(production) {
  production.short_status_string = Auphonic.getStatusString(production.status);

  var short_info = [];
  fields.each(function(field, index) {
    var data = length(production[field]);
    if (data) short_info.push(data + ' ' + singular[index] + (data == '1' ? '' : 's'));
  });

  var hasIntro = false;
  var hasOutro = false;
  Array.forEach(production.multi_input_files, function(inputFile) {
    if (inputFile.type == 'intro') hasIntro = true;
    else if (inputFile.type == 'outro') hasOutro = true;
  });
  if (hasIntro) short_info.push('intro');
  if (hasOutro) short_info.push('outro');

  var last = (short_info.length > 1) ? short_info.pop() : null;
  production.short_info = short_info.join(', ') + (last ? ' and ' + last : '');
  return production;
};

var formatService = function(service) {
  var type = API.getInfo('service_types')[service.type];
  service.display_type = type && type.display_name;
  return service;
};

var createFormatter = function(fn) {
  return function(response) {
    // Detect whether a list of objects or a single object was returned
    response.data = Array.isArray(response.data) ? response.data.map(fn) : fn(response.data);
    return response;
  };
};

API.on('productions', {formatter: createFormatter(format)});
API.on('presets', {formatter: createFormatter(format)});
API.on('services', {formatter: createFormatter(formatService)});

exports.formatInfos = function(response) {
  // Process Algorithms into a usable format
  var algorithms = response.data.algorithms;
  response.data.algorithms_array = Object.values(Object.map(algorithms, function(item, algorithm) {
    var object = Object.clone(item);
    object.key = algorithm;
    object[object.type] = true;
    object[algorithm] = true;

    // Sort according to Auphonic.AlgorithmOrder or otherwise alphabetically
    // at the end (belonging algorithms last)
    if (Auphonic.AlgorithmOrder[object.key])
      object.order = Auphonic.AlgorithmOrder[object.key];
    else
      object.order = String(((algorithms[object.belongs_to] || object).display_name) + (object.belongs_to ? 2 : 1));

    object.short_display_name = Auphonic.getAlgorithmShortString(object);

    if (object.type == 'select') object.options.each(function(option) {
      if (option.value == object.default_value)
        option.selected = true;

      var substring = null;
      if (Auphonic.AlgorithmFilters.contains(algorithm)) substring = option.display_name.match(Auphonic.AlgorithmDisplayFilter);
      option.short_display_name = (substring && substring[0]) || option.display_name;
    });

    return object;
  })).sortByKey('order');

  return response;
};

exports.formatDuration = function(from, separator, pad, durations, names) {
  if (!durations) durations = [60, 60, 24, 365, 0];
  if (!names) names = ['s', 'm', 'h', 'd', 'y'];

  var delta = Math.abs(Math.floor(from));

  var vals = [];
  var value;
  var duration;

  for (var item = 0; item < durations.length; item++) {
    if (item && !delta) break;
    value = delta;
    if ((duration = durations[item])) {
      value = (delta % duration);
      delta = Math.floor(delta / duration);
    }
    if (pad) value = String(Array(String(duration).length + 1).join('0') + value).slice(-String(duration).length);
    vals.unshift(value + (names[item] || ''));
  }

  return vals.join(separator || ':');
};

var formatMetadata = function(object, type) {
  var metadata = object.metadata;
  if (type == 'preset' && !metadata.title) metadata.title = object.preset_name;
  metadata.hasLicense = !!(metadata.license || metadata.license_url);
  object.hasDetails =
    object.image ||
    metadata.summary ||
    metadata.publisher ||
    metadata.url ||
    metadata.hasLicense ||
    length(metadata.tags && metadata.tags.erase('')); // The API returns an array with one empty string

  metadata.hasDescription = !!(metadata.album || metadata.artist);
  if (length(metadata.tags)) metadata.tags = metadata.tags.join(', ');
};

var formatAlgorithms = function(object) {
  object.algorithms = Object.values(Object.map(API.getInfo('algorithms_array'), function(algorithm) {
    var value = object.algorithms[algorithm.key];
    if (!value) return null;
    algorithm = Object.clone(algorithm);
    algorithm.value = value;

    if (algorithm.belongs_to && !object.algorithms[algorithm.belongs_to]) return null;

    if (algorithm.type == 'select') {
      // Search for the correct value string in options
      for (var i = 0; i < algorithm.options.length; i++) {
        var option = algorithm.options[i];
        if (option.value == value) {
          algorithm.value_string = option.short_display_name;
          break;
        }
      }
    }

    return algorithm;
  })).clean();

  object.hasAlgorithms = !!length(object.algorithms);
};

var formatOutgoingServices = function(object) {
  // Remove duplicates. The API allows to add the same service more than once
  var uuids = {};
  object.outgoing_services = length(object.outgoing_services) ? object.outgoing_services.map(formatService).filter(function(service) {
    if (uuids[service.uuid]) return false;
    uuids[service.uuid] = true;
    return true;
  }) : null;
};

var getAndFormatMediaFiles = function(object) {
  var token = User.getToken('?bearer_token=');
  var media_files = [];
  if (object.output_files) object.output_files.each(function(file) {
    if (!file.download_url) return;

    if (file.format == 'video') {
      object.hasVideo = true;
      object.videoPath = file.download_url + token;
      return;
    }

    media_files.push({
      format: parseFloat((preferredFormats[file.format] || preferredFormats.dflt) + '.' + String('000' + (file.bitrate || 0)).slice(-3)),
      url: file.download_url
    });
  });

  return media_files.sortByKey('format').map(function(file) {
    return encodeURI(file.url + token);
  });
};

var formatMultiInputFiles = function(object) {
  if (object.multi_input_files) Array.forEach(object.multi_input_files, function(file) {
    if (file.type == 'intro') object.intro = file;
    if (file.type == 'outro') object.outro = file;
    if (file.input_file.charAt(0) == '/') file.input_file = file.input_file.substr(1);
  });
};

exports.prepare = function(object, type, callback) {
  // We need to create a new object that can be transformed for viewing
  object = Object.clone(object);

  object[type] = true;
  object.baseURL = type;

  formatMetadata(object, type);
  formatOutgoingServices(object);
  formatAlgorithms(object);
  formatMultiInputFiles(object);

  object.is_uploading = CurrentUpload.has(object.uuid);
  object.is_stopping = (object.status == 13);

  object.hasChapters = length(object.chapters);
  if (object.hasChapters) object.chapters.sortByKey('start');

  var duration_string = exports.formatDuration(object.length, ' ');
  if (duration_string != '0s') object.duration_string = duration_string;
  object.duration = object.length;

  var media_files = getAndFormatMediaFiles(object);
  object.media_files = length(media_files) ? JSON.stringify(media_files) : null;
  object.player_chapters = length(object.chapters) ? JSON.stringify(object.chapters) : null;
  object.output_files = length(object.output_files) ? object.output_files.map(OutputFiles.createUIData) : null;

  Source.fetch(function(list) {
    var sources = {};
    list.forEach(function(source) {
      sources[source.uuid] = source;
    });

    var setSourceInfo = function(obj, source) {
      if (source) {
        obj.service_display_type = source.display_type;
        obj.service_display_name = source.display_name;
      }
    };

    if (object.service) setSourceInfo(object, sources[object.service]);
    if (object.multi_input_files) Array.forEach(object.multi_input_files, function(file) {
      setSourceInfo(file, sources[file.service]);
    });

    callback(object);
  });
};
