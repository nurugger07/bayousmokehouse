const CSRF_TOKEN_RE = /name="_csrf" value="([^"]+)"/;

// The CSRF token is per-session, not per-form (see app.js), so fetching
// it once via a GET to any page that renders a form is enough — the
// same value stays valid for every subsequent POST made by that same
// agent (same session cookie) for the rest of the test.
async function getCsrfToken(agent, path) {
  const res = await agent.get(path);
  const match = res.text.match(CSRF_TOKEN_RE);
  if (!match) {
    throw new Error(`No CSRF token found in response for GET ${path}`);
  }
  return match[1];
}

module.exports = { getCsrfToken };
