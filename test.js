var http = require('http');
var xml2js = require('xml2js');
var express = require('express');

var app = express.createServer();

var gaClient = null;


var cache = function () {
    var _cacheStore = new Object();

    var cacheAccessor = {
        isLogging: false,

        get: function (key) {
            var value = _cacheStore[key];

            if (value == undefined || value == null) { return null; }

            if (cacheAccessor.isLogging) { console.log('cache hit! key: ' + key); }

            return value;
        },

        set: function (key, value, timeout, callback) {
            _cacheStore[key] = value;

            if (cacheAccessor.isLogging) { console.log('cache set! key: ' + key); }

            if (timeout != undefined && timeout != null && !isNaN(timeout)) {
                setTimeout(function () {
                    var value = cacheAccessor.clear(key);

                    if (callback != undefined && callback != null && typeof (callback) == "function") {
                        callback(value);
                    }
                }, timeout);
            }
        },

        clear: function (key) {
            var value = _cacheStore[key];

            if (value != undefined && value != null) { _cacheStore[key] = null; }

            if (cacheAccessor.isLogging) { console.log('cache cleared! key: ' + key); }

            return value;
        }
    };

    return cacheAccessor;
} ();


var testSite = {
    configure: function () {
        this.enable('jsonp callback');
        this.set('views', __dirname + '/views');
        this.use(express.bodyDecoder());
        this.use(express.cookieDecoder());
        this.use(express.gzip());
        this.use(this.router);
        this.use(express.staticProvider(__dirname + '/static'));
    },

    registerRoutes: function (app) {
        app.get('/', function (req, res) {
            res.send('Hello World\n');
        });

        app.get('/walkthrough/:walkthroughId/:quality', function (req, res) {
            var walkthroughId = parseInt(req.params.walkthroughId);
            var quality = req.params.quality;

            switch (quality) {
                case '2':
                case 'med':
                case 'medium':
                    quality = 2;
                    break;

                case '3':
                case 'hi':
                case 'high':
                    quality = 3;
                    break;

                //case '1':           
                //case 'lo':           
                //case 'low':           
                default:
                    quality = 1;
            };

            testSite.fetchVideos(walkthroughId, quality, res);
        });

        app.get('/walkthrough/:walkthroughId', function (req, res) {
            var walkthroughId = parseInt(req.params.walkthroughId);
            var quality = 1;

            testSite.fetchVideos(walkthroughId, quality, res);
        });
    },

    fetchVideos: function (walkthroughId, quality, res) {
        // parameter checks
        if (walkthroughId == undefined || walkthroughId == null || isNaN(walkthroughId)) { res.send(); return; }
        if (quality == undefined || quality == null || isNaN(quality)) { quality = 1; return; }

        // cache hit, return it and dont bother processing more
        var cacheKey = 'vids:walkthroughid:' + walkthroughId + ':quality:' + quality;
        var videos = cache.get(cacheKey);
        if (videos != null) { res.send(videos); return; }

        // lazy init
        if (gaClient == null) { gaClient = http.createClient(80, 'www.gameanyone.com'); }

        // for a given series id, get the video ids
        var request = gaClient.request('GET', '/feeds/pid' + walkthroughId + '.rss', { host: 'www.gameanyone.com' });
        getJSON(request, function (json) {
            var items = json.channel.item;
            if (items != undefined && items.length > 0) {
                var videonumbers = function () {
                    var array = [];
                    for (var i in items) {
                        var tokens = items[i].link.split('/');
                        var videoId = parseInt(tokens[tokens.length - 1]);

                        // skip videos whose id does not parse into a number
                        if (!isNaN(videoId)) {
                            array.push(videoId);
                        }
                    }

                    return array;
                } ();

                // retrieve all the videos for that video id
                var remaining = videonumbers.length;
                var videos = [];

                for (var i in videonumbers) {
                    var id = videonumbers[i];
                    var vidRequest = gaClient.request('GET', '/gameanyone.xml?l=' + quality + '&id=' + id, { host: 'www.gameanyone.com' });
                    getJSON(vidRequest, function (json) {
                        var image = json.image;
                        if (image == undefined || image == null) { image = 'http://www.gameanyone.com/t/' + json['acudeojw.videoId'] + '.jpg'; }
                        var result = {
                            id: parseInt(json['acudeojw.videoId']),
                            image: image,
                            file: json.file,
                            title: json['acudeojw.title']
                        };

                        videos.push(result);
                        remaining--;

                        // last one to be retrieved, return the sorted result
                        if (remaining == 0) {
                            // older video ids first
                            videos.sort(function (a, b) {
                                return a.id > b.id;
                            });

                            cache.set(cacheKey, videos, 900000); // 15 minute cache
                            res.headers['Content-Type'] = 'text/javascript';
                            res.send(videos);
                        }
                    });
                }
            }
            else { res.send(); }
        });
    }
};

function getCompleteHttpBody(request, callback) {
    request.end();
    request.on('response', function (response) {
        var text = "";

        response.setEncoding('utf8');
        response.on('data', function (chunk) {
            text += chunk;
        });

        response.on('end', function () {
            callback(text);
        });
    });
}

function parseXmlToJSON(xml, callback) {
    var parser = new xml2js.Parser();

    parser.addListener('end', function (result) {
        callback(result);
    });

    parser.parseString(xml);
}

function getJSON(request, callback) {
    getCompleteHttpBody(request, function (text) {
        parseXmlToJSON(text, function (json) {
            callback(json);
        });
    });
}


app.configure(testSite.configure);
testSite.registerRoutes(app);

app.listen(3000);
