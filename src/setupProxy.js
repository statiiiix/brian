// CRA dev-server proxy: /api/* goes to the HOSTED Brian backend (Supabase
// Edge Function) by default, so local development needs no `npm run api`.
// Point REACT_APP_BRIAN_API at http://localhost:3001 to develop against a
// local backend instead. Production uses vercel.json rewrites, not this file.
const { createProxyMiddleware } = require('http-proxy-middleware');

const target =
  process.env.REACT_APP_BRIAN_API ||
  'https://foydcrwyakpkisxtvzgr.supabase.co/functions/v1/brian';

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target,
      changeOrigin: true,
    })
  );
};
