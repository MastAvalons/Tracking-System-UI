var express = require('express');
var passport = require('passport')
  , local = require('passport-local').Strategy
  , token = require('passport-http-bearer').Strategy;
var db = require('./db');
var mongodb = require('mongodb');
var MongoClient = mongodb.MongoClient;

var url = process.env.MONGODB_URI; //DB URL, see documentaion.txt 

// Create a new Express application.
var app = express();

app.use(express.static('public'));
//enable cors - disble after testing 
/*app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});*/

// Configure the local strategy for use by Passport.
//
// The local strategy require a `verify` function which receives the credentials
// (`username` and `password`) submitted by the user.  The function must verify
// that the password is correct and then invoke `cb` with a user object, which
// will be set at `req.user` in route handlers after authentication.
passport.use(new local(
  function (username, password, cb) {
    db.users.findByUsername(username, function (err, user) {
      if (err) { return cb(err); }
      if (!user) { return cb(null, false); }
      if (user.password != password) { return cb(null, false); }
      return cb(null, user);
    });
  }));

passport.use(new token(
  function(token, cb) {
    db.users.findByToken(token, function(err, user) {
      if (err) { return cb(err); }
      if (!user) { return cb(null, false); }
      return cb(null, user);
    });
}));

// Configure Passport authenticated session persistence.
//
// In order to restore authentication state across HTTP requests, Passport needs
// to serialize users into and deserialize users out of the session.  The
// typical implementation of this is as simple as supplying the user ID when
// serializing, and querying the user record by ID from the database when
// deserializing.
passport.serializeUser(function (user, cb) {
  cb(null, user.id);
});

passport.deserializeUser(function (id, cb) {
  db.users.findById(id, function (err, user) {
    if (err) { return cb(err); }
    cb(null, user);
  });
});

// Configure view engine to render EJS templates from /views folder
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

// Use application-level middleware for common functionality, including
// logging, parsing, and session handling.
app.use(require('morgan')('combined'));
app.use(require('cookie-parser')());
app.use(require('body-parser').urlencoded({ extended: true }));
app.use(require('express-session')({ secret: 'keyboard cat', resave: false, saveUninitialized: false }));

// Initialize Passport and restore authentication state, if any, from the
// session.
app.use(passport.initialize());
app.use(passport.session());

// Define routes.
app.get('/',
  function (req, res) {
    res.redirect('/offers');
  });

app.get('/login',
  function (req, res) {
    res.render('login');
  });

//authenticate and redirect in case of success
app.post('/login',
  passport.authenticate('local', { failureRedirect: '/' }),
  function (req, res) {
    res.redirect('/offers');
  });

app.get('/logout',
  function (req, res) {
    req.logout();
    res.redirect('/login');
  });

//after login process, req.user set by passport usind the users DB and sent to html

app.get('/settings',
  require('connect-ensure-login').ensureLoggedIn(),
  function (req, res) {
    res.render('settings', { user: req.user });
  });

app.get('/offers', require('connect-ensure-login').ensureLoggedIn(), function (req, res) {
  res.render('offers', { user: req.user });
});

//create api feed for user using token (passport bearer method), /feed?access_token={} , access tokens are in the users database users.js

app.get('/feed', passport.authenticate('bearer', { session: false }), function (req, res) {

  console.log('received request for feed with access_token ' + req.query.access_token);
  MongoClient.connect(url, function (err, db) {
    if (err) {
      console.log('Unable to connect to the mongoDB server. Error:', err);
    } else {
      console.log('Connection established to', url);
      db.collection('offers').find({}, { 'their': 0, 'merchant': 0, 'rate': 0, 'tracking': 0, '_id': 0 }).toArray(function (e, response) {
        if (e) {
          console.log(e);
        }
        else if (response.length) {
          //console.log(res);                       
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.write(JSON.stringify(response));
          res.end();
        }
        else {
          console.log('No document(s) found with defined "find" criteria!');
        }
        db.close();
      });
    }
  });



});

app.get('/report', require('connect-ensure-login').ensureLoggedIn(), function (req, res) {
  res.render('reports', { user: req.user });
});

app.get('/reportFeed', passport.authenticate('bearer', { session: false }), function (req, res) {

  console.log('received request for reports with key ' + req.query.access_token); 
  MongoClient.connect(url, addData, function (err, db) {
    if (err) {
      console.log('Unable to connect to the mongoDB server. Error:', err);
    } else {
      console.log('Connection established to', url);
      db.collection('clicks').aggregate([
        { $match: { pub: parseInt(req.query.user) } },
        { $match: { clicktime: { $gte: new Date(req.query.start + 'T00:00:00.000Z'), $lt: new Date(req.query.end + 'T24:00:00.000Z') } } },
        { $group: { _id: "$offer", rev: { $sum: "$rate" }, clicks: { $sum: 1 }, leads: { $sum: "$status" } } }        
      ]).toArray(function (e1, res1) {
        if (e1) {
          console.log(e1);
        }
        else if (res1.length) {
          //console.log(res1);
          addData(res1, db);
        }
         else {
          var noData = {
            _id : "Clicks not found for the specified dates"
          }
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.write(JSON.stringify(noData));
          res.end();
        }
        db.close();
      });

    }
  });

  function addData(data, db) {
    var j = 0;
    for (i = 0; i < data.length; i++) {
      data[i].cr = (data[i].leads/ data[i].clicks)*100;
      db.collection('offers').findOne({ number: data[i]["_id"] }, { _id: 0, name: 1 }, function (err, result) {
        data[j].name = result.name;
        j = j + 1;
        if (Object.keys(data[data.length - 1]).length == 6) {
          //console.log(data);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.write(JSON.stringify(data));
          res.end();
        }
      });
    }
  }

});

app.listen(process.env.PORT || 3000, function () {
  console.log('App listening on port 3000!')
});