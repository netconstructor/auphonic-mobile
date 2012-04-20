(function() {

var boot = function() {
  
  window.scrollTo(0, 1);
  (new ActiveState()).attach();
  
  var counter = 0;
  var isRecording = false;
  var button = document.getElementById('record');
  var play = document.getElementById('play');
  var timer, media, fs;
    
  var success = function() {
    play.style.display = 'block';
    console.log('success');
  };

  var error = function() {
    console.log('error');
  };

  var updateTime = function() {
    document.getElementById('counter').innerText = (++counter) + ' seconds';
  };
  
  var successFolderCreation = function(folder) {
    var file = folder.getFile('recording.mp3', {create: true, exclusive: true});

    media = new Media(file, success, error);
  
    if (isRecording) {
      record.innerText = 'record';
      media.stopRecord();
      isRecording = false;
      clearInterval(timer);
      document.getElementById('counter').innerText = '';
      return;
    }

    counter = 0;
    media.startRecord();
    isRecording = true;
    record.innerText = 'stop';
      
    timer = setInterval(updateTime, 1000);
  };
  
  var fn = function(fileSystem) {
    fs = fileSystem;
    fs.root.getDirectory('media', {create: true}, successFolderCreation);
  };

  play.addEventListener('click', function(event) {
    event.preventDefault();
    media.play();
  }, false);
  
  button.addEventListener('click', function(event) {
    event.preventDefault();
    
    if (fs) fn(fs);
    else window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, fn, null);
  }, false);
};

var fired;
var ready = function(){
  if (fired) return;
  fired = true;

  boot();
};


document.addEventListener('deviceready', ready, false);
window.addEventListener('DOMContentLoaded', ready, false);

})();
