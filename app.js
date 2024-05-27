require('dotenv').config();
const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const supabase = require('./supabaseClient');

const app = express();

app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Mock data for Euro 2024 matches
const matches = [
  { id: 1, team1: 'Polska', team2: 'Niemcy', date: '2024-06-14', time: '18:00' },
  { id: 2, team1: 'Francja', team2: 'Włochy', date: '2024-06-15', time: '21:00' },
  // Add more matches here
];

// Passport configuration
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:3000/auth/google/callback"
  },
  async function(token, tokenSecret, profile, done) {
    try {
      let { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('google_id', profile.id)
        .single();

      if (error && error.details.includes('0 rows')) {
        let { data, error } = await supabase
          .from('users')
          .insert([
            { google_id: profile.id, display_name: profile.displayName }
          ])
          .single();
        
        if (error) {
          console.error('Error creating user:', error);
          return done(error, null);
        }

        user = data;
      } else if (error) {
        console.error('Error fetching user:', error);
        return done(error, null);
      }

      return done(null, user);
    } catch (err) {
      console.error('Unexpected error:', err);
      return done(err, null);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    let { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching user by ID:', error);
      return done(error, null);
    }

    done(null, user);
  } catch (err) {
    console.error('Unexpected error during deserialization:', err);
    done(err, null);
  }
});

app.get('/', (req, res) => {
  res.render('index', { user: req.user });
});

app.get('/auth/google',
  passport.authenticate('google', { scope: ['https://www.googleapis.com/auth/plus.login'] })
);

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/profile');
  }
);

app.get('/profile', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  try {
    let { data: predictions, error } = await supabase
      .from('predictions')
      .select('*')
      .eq('user_id', req.user.id);

    if (error) {
      console.error('Error fetching predictions:', error);
      return res.status(500).send('Error fetching predictions');
    }

    res.render('index', { user: req.user, matches, predictions });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).send('Unexpected error occurred');
  }
});

app.post('/submit-prediction', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  const { matchId, team1_score, team2_score } = req.body;

  try {
    let { data: userPrediction, error } = await supabase
      .from('predictions')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('match_id', matchId)
      .single();

    if (error && error.details.includes('0 rows')) {
      userPrediction = null; // No rows returned
    } else if (error) {
      console.error('Error fetching prediction:', error);
    }

    if (userPrediction) {
      let { data, error } = await supabase
        .from('predictions')
        .update({ team1_score, team2_score })
        .eq('id', userPrediction.id);

      if (error) {
        console.error('Error updating prediction:', error);
      }
    } else {
      let { data, error } = await supabase
        .from('predictions')
        .insert([
          { id: uuidv4(), user_id: req.user.id, match_id: matchId, team1_score, team2_score }
        ]);

      if (error) {
        console.error('Error inserting prediction:', error);
      }
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  }

  res.redirect('/profile');
});

app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

app.listen(3000, () => {
  console.log('Aplikacja działa na http://localhost:3000');
});
