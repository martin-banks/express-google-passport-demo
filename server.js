require('dotenv').config()

const express = require('express')
const passport = require('passport')
const Strategy = require('passport-google-oauth20').Strategy
// const functions = require('firebase-functions')
const firebaseAdmin = require('firebase-admin')
const firebase = require('firebase')
const multer = require('multer')
const path = require('path')
const fs = require('fs')


// Configure the Google strategy for use by Passport.
//
// OAuth 2.0-based strategies require a `verify` function which receives the
// credential (`accessToken`) for accessing the Google API on the user's
// behalf, along with the user's profile.  The function must invoke `cb`
// with a user object, which will be set at `req.user` in route handlers after
// authentication.
passport.use(new Strategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: '/return'
  },
  function(accessToken, refreshToken, profile, cb) {
    // In this example, the user's Google profile is supplied as the user
    // record.  In a production-quality application, the Google profile should
    // be associated with a user record in the application's database, which
    // allows for account linking and authentication with other identity
    // providers.
    // return cb(null, false)
    return cb(null, profile)
  }))


// Configure Passport authenticated session persistence.
//
// In order to restore authentication state across HTTP requests, Passport needs
// to serialize users into and deserialize users out of the session.  In a
// production-quality application, this would typically be as simple as
// supplying the user ID when serializing, and querying the user record by ID
// from the database when deserializing. However, due to the fact that this
// example does not have a database, the complete Google profile is serialized
// and deserialized.
passport.serializeUser(function(user, cb) {
  cb(null, user)
})

passport.deserializeUser(function(obj, cb) {
  cb(null, obj)
})


// Create a new Express application.
var app = express()

// Configure view engine to render EJS templates.
app.set('views', __dirname + '/views')
app.set('view engine', 'ejs')

// Use application-level middleware for common functionality, including
// logging, parsing, and session handling.
app.use(require('morgan')('combined'))
app.use(require('cookie-parser')())
app.use(require('body-parser').urlencoded({
  extended: true,
  limit: (20 * 1024 * 1024)
}))


const multerOptions = {
  storage: multer.memoryStorage(),
  fileFilter(req, file, next) {
    const isPhoto = file.mimetype.startsWith('image/')
    if(isPhoto) {
      next(null, true)
    } else {
      next({ message: 'That filetype isn\'t allowed!' }, false)
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024,
  }
}

const upload = multer(multerOptions)



app.use(require('express-session')({ secret: 'keyboard cat', resave: true, saveUninitialized: true }))


// Initialize Passport and restore authentication state, if any, from the session.
app.use(passport.initialize())
app.use(passport.session())





const serviceAccount = require("./serviceAccountKey.json");

firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount),
  databaseURL: "https://martinbanks-sandbox.firebaseio.com"
});


// Define routes.
app.get('/',
  function(req, res) {
    res.render('home', { user: req.user })
  })

app.get('/login',
  function(req, res){
    res.render('login')
  })

app.get('/login/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
)

// Page to render after successful Google authentication
app.get('/return',
  passport.authenticate('google', { failureRedirect: '/login' }),
  function(req, res) {
    res.redirect('/profile')
  })


// TODO
 // Set the configuration for your app
const config = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  storageBucket: 'bucket.appspot.com'
};
firebase.initializeApp(config);

// Get a reference to the database service
const database = firebase.database();


function getNewUsers () {
  const ref = firebase.database().ref('new_users')

  return ref.once('value')
    .then(snap => snap.val())
    .catch(err => { throw err })
}

function getUserInfo ({ id }) {
  const ref = firebase.database().ref(`users/${id}`)
  return ref.once('value')
    .then(snap => snap.val())
    .catch(err => { throw err })
}

async function checkAuthorisedUser (req, res, next) {
  console.log('\n\n\req.user:\n', req.user, '\n\n')
  const email = req.user.emails[0].value

  // Now we have an aunthenticated user, we determine if they are authorised to access site
  // Two scenarios: Existing user and new user.
  // Existing users have a profile stored in a 'user' DB
  // This entry will also include a user level (admin, standard etc)
  // New users are listed in the a new_user DB entry with their access level
  // Once new user logs in a new account is created and the new user listing is removed

  // Query database for user list
  try {
    const newUsers = await getNewUsers()
    const userInfo = await getUserInfo({ id: req.user.id })

    if (userInfo) {
      // User already exists
      console.log({ userInfo })
      return next()

    } else if (newUsers) {
      console.log({ newUsers })
      newUsers.find((user, i) => {
        // TODO
        // first check if existing user
        if (user.email === email) {
          // * create new account
          // Add entry to user database
          // User id to store entry
          // Set role from entry in new_user db
          const { id, name, displayName } = req.user
          firebase.database().ref(`users/${id}`).set(({
            name,
            displayName,
            email,
            role: user.role,
          }))
            .catch(err => { throw err })

          // Remove renference from new_user db
          firebase.database().ref(`new_users/${i}`)
            .remove()
            .catch(err => { throw err })

          next()
          return

        } else {
          // User is not authorised to access site
          return res.send('You are not authorised')
        }
      })
    }
  } catch (err) {
    res.send(err)
  }

  // Is user on that list
  // If so; call next()
  // If not: redirect to unauthorised page
  // if (email === 'anotherbanksy@gmail.com') {
  //   next()
  // } else {
  //   res.send('Not authorised')
  // }
}

app.get('/profile',
  require('connect-ensure-login').ensureLoggedIn(),
  checkAuthorisedUser,
  function (req, res){
    res.render('profile', { user: req.user })
  })

app.get('/auth',
  require('connect-ensure-login').ensureLoggedIn(),
  (req, res) => {
    res.send(req.user)
  }
)

app.get('/upload',
  // require('connect-ensure-login').ensureLoggedIn(),
  // checkAuthorisedUser,
  function (req, res, next) {
    res.render('upload')
  }
)
const { Storage } = require('@google-cloud/storage')

function saveToFirstore (req) {
  const file = req.files[0]
  console.log({ file })
  const storage = new Storage({
    projectId: process.env.GCLOUD_PROJECT_ID,
    keyFilename: process.env.GCLOUD_APPLICATION_CREDENTIALS,
  })
  const bucket = storage.bucket(process.env.GCLOUD_STORAGE_BUCKET_URL)
  const blob = bucket.file(`uploads/${file.originalname}`)
  const blobStream = blob.createWriteStream({
    metadata: {
      contentType: file.mimetype,
    },
  })

  blobStream.on('error', err => {
    throw err
  })
  blobStream.on('finish', () => {
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURI(blob.name)}?alt=media`
    const altUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`
    console.log('\n\n', publicUrl, '\n\n', altUrl, '\n\n')

    blob.getSignedUrl({
      action: 'read',
      expires: '03-09-2491'
    }).then(signedUrls => {
      console.log({ signedUrls })
      // signedUrls[0] contains the file's public URL
    });
  })

  blobStream.end(req.files[0].buffer)
}

function saveUploadedFile (file) {
  const uploadDir = path.join(__dirname, `./uploads`)
  // Check if the upload folder exists
  fs.access(uploadDir, async function(err) {
    if (err && err.code === 'ENOENT') {
      // Create dir in case not found
      await fs.mkdirSync(uploadDir)
    }

    // Create new, unique file name
    const time = new Date().getTime()
    const cleanedName = file.originalname
      .trim()
      .toLowerCase()
      .replace(/\s+/gi, '-')

    const newName = `${time}-${cleanedName}`
    const uploadedFile = `${uploadDir}/${newName}`

    return new Promise((resolve, reject) => {
      fs.writeFile(uploadedFile, file.buffer, function (err, res) {
        if (err) {
          reject('\n--------\n', `-- ERROR WRITING FILE ${newName} --\n`, err, '\n--------\n')
          return
        }
        console.log('File written:', newName)
        resolve(uploadedFile)
      })
    })

  })
}


app.post('/upload',
  // The string in brackets is the name of the file input element
  upload.array('fileupload'),
  // require('connect-ensure-login').ensureLoggedIn(),
  // checkAuthorisedUser,
  async function (req, res, next) {
    try {
      try {
        saveToFirstore(req)
      } catch (err) {
        console.log('\n\nERROR UPLOADING FILE\n', err, '\n\n')
      }
      await saveUploadedFile(req.files[0])
    } catch (err) {
      res.send(err)
      return console.log(err)
    }
    res.json({ body: req.body, files: req.files || 'no file found' })
    // res.render('upload')
  }
)


// Start the server
app.listen(process.env.PORT || 500)
console.log(`
🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥

Server running: http://localhost:${process.env.PORT}

🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥

`)
