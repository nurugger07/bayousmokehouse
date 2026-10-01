# bayousmokehouse

The website for Bayou Smokehouse food truck

## Development

```
npm install
npm start          # run the dev server
npm test           # run the test suite
npm run lint       # check for lint errors
npm run format     # auto-format with Prettier
npm run format:check
```

## Contributing

Changes land on `main` via pull request, not direct pushes. A PR must:

- Pass CI (lint + test)
- Have a title in [Conventional Commits](https://www.conventionalcommits.org/) style, e.g. `feat: add location address sync`, `fix: fixed a security issue`, `chore: updated dependency X`

Merging to `main` auto-deploys to Heroku once CI passes.
