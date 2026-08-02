// When bumping this version, also update all ?v= query strings in index.html to match
// (both the js/*.js scripts and the css/*.css stylesheets).
// This ensures browsers re-fetch all JS files and avoids "X is not a function" errors
// caused by a mix of cached old scripts and freshly served new ones.
const VERSION = 'v1.11.0';
